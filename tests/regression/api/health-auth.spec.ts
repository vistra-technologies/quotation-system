/**
 * Health + better-auth surface (/api/auth/[...all]): sign-in, sign-up lock, get-session, sign-out,
 * session cookie flags, forged cookies and instant deactivation.
 *
 * Sign-in is rate-limited (better-auth special rule: 3 per 10 s per IP on /sign-in and /sign-up), so
 * this file keeps sign-ins few and retries only on 429 (same shape as tests/e2e/helpers.ts apiSignIn).
 */
import { test, expect } from "../fixtures/test";
import { covers } from "../fixtures/covers";
import { apiUrl, isSubdomain } from "../../e2e/helpers";
import { toAuthEmail } from "@/lib/auth-utils";
import { authPost, bypass, runPassword, sessionCookieLine, signIn } from "./sign-in";

covers("GET /api/health");
covers("GET /api/auth/[...all]");
covers("POST /api/auth/[...all]");

const COOKIE = "__Secure-qs.session_token";

test("GET /api/health → 200 {status: ok, database: connected}", async ({ anon }) => {
  const r = await anon.get("/api/health");
  expect(r.status()).toBe(200);
  const b = (await r.json()) as Record<string, unknown>;
  expect(b).toMatchObject({ status: "ok", database: "connected" });
  expect(typeof b.timestamp).toBe("string");
});

test.describe("/api/auth/[...all]", () => {
  test("GET get-session: anonymous → null; a session → its own user, never a password/hash", async ({ anon, as, run }) => {
    const u = apiUrl(run.testOrg.slug, "/api/auth/get-session");
    const a = await anon.get(u);
    expect(a.status()).toBe(200);
    expect(await a.json()).toBeNull();

    const s = await as.distributor.get(u);
    expect(s.status()).toBe(200);
    const text = await s.text();
    expect(text).not.toMatch(/"password|hash"/i);
    const body = JSON.parse(text) as { user: Record<string, unknown>; session: Record<string, unknown> };
    expect(body.user.id).toBe(run.users.distributor.id);
    expect(body.user.username).toBe(run.users.distributor.username);
    expect(body.user.organizationId).toBe(run.testOrg.id);
    expect(body.user.active).toBe(true);
  });

  test("sign-in: wrong password and unknown user get the same 401 + body (no user enumeration)", async ({ playwright, baseURL, run }) => {
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: bypass() });
    try {
      const slug = run.testOrg.slug;
      const wrong = await signIn(ctx, slug, run.users.architect.username, "wrong-password-rgr");
      const ghost = await signIn(ctx, slug, `${run.prefix}ghost`, "wrong-password-rgr");
      expect(wrong.status(), await wrong.text()).toBe(401);
      expect(ghost.status()).toBe(401);
      expect(await ghost.json()).toEqual(await wrong.json());
      expect(sessionCookieLine(wrong)).toBeUndefined();
      expect(sessionCookieLine(ghost)).toBeUndefined();
    } finally {
      await ctx.dispose();
    }
  });

  test("sign-up is disabled (users are provisioned server-side only)", async ({ playwright, baseURL, run }) => {
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: bypass() });
    try {
      // Should this ever succeed it would create a Test-Org user under the run prefix (the sweep removes it).
      const username = `${run.prefix}signup`;
      const r = await authPost(ctx, run.testOrg.slug, "sign-up/email", {
        email: toAuthEmail(username, run.testOrg.slug), password: runPassword(), name: "RGR Signup",
        username, organizationId: run.testOrg.id, roleId: "x",
      });
      expect(r.status(), await r.text()).toBe(400);
      expect(sessionCookieLine(r)).toBeUndefined();
    } finally {
      await ctx.dispose();
    }
  });

  test("a forged session cookie is rejected (401)", async ({ playwright, baseURL, run }) => {
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { ...bypass(), Cookie: `${COOKIE}=forged.rgr-not-a-token` } });
    try {
      const r = await ctx.get(apiUrl(run.testOrg.slug, `/api/v1/orgs/${run.testOrg.slug}/me`));
      expect(r.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  // Preconditions: the `__Secure-` name and the Secure flag are asserted only when the target is https
  // (better-auth adds both only over https); `Domain=.easeetool.com` only when the target is an
  // *.easeetool.com host (subdomain mode — staging/production set CROSS_SUBDOMAIN_COOKIES_ENABLED; ad-hoc
  // *.vercel.app previews do not, and get a host-only cookie). HttpOnly and SameSite=Lax hold everywhere.
  test("sign-in sets an HttpOnly, Secure, SameSite=Lax session cookie; sign-out needs a trusted Origin and revokes that session", async ({ playwright, baseURL, run }) => {
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: bypass() });
    try {
      const slug = run.testOrg.slug;
      const r = await signIn(ctx, slug, run.users.member.username, runPassword());
      expect(r.status(), await r.text()).toBe(200);
      const line = sessionCookieLine(r);
      expect(line, "sign-in sets a session cookie").toBeTruthy();
      const attrs = line!.split(";").map((s) => s.trim().toLowerCase());
      expect(attrs).toContain("httponly");
      expect(attrs).toContain("samesite=lax");
      if (new URL(baseURL!).protocol === "https:") {
        expect(line!.startsWith(`${COOKIE}=`), line).toBe(true);
        expect(attrs).toContain("secure");
      }
      // staging/production share the session across org subdomains (crossSubDomainCookies)
      if (isSubdomain) expect(attrs).toContain("domain=.easeetool.com");

      const me = apiUrl(slug, `/api/v1/orgs/${slug}/me`);
      expect((await ctx.get(me)).status()).toBe(200);
      // CSRF: a cookie-bearing auth POST needs a trusted Origin — none / a foreign one is refused (403)
      const signOut = apiUrl(slug, "/api/auth/sign-out");
      const noOrigin = await ctx.post(signOut, { data: {} });
      expect(noOrigin.status(), await noOrigin.text()).toBe(403);
      expect(((await noOrigin.json()) as { code?: string }).code).toBe("MISSING_OR_NULL_ORIGIN");
      const evil = await ctx.post(signOut, { data: {}, headers: { Origin: "https://evil.example" } });
      expect(evil.status(), await evil.text()).toBe(403);
      expect((await ctx.get(me)).status()).toBe(200); // still signed in
      const out = await ctx.post(signOut, { data: {}, headers: { Origin: new URL(signOut, baseURL).origin } });
      expect(out.status(), await out.text()).toBe(200);
      expect((await ctx.get(me)).status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test("deactivation is instant: an existing session gets 401 and the user can no longer sign in", async ({ as, f, url, run, playwright, baseURL }) => {
    const u = await f.user("member"); // ledgered; teardown deletes it
    const slug = run.testOrg.slug;
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: bypass() });
    const again = await playwright.request.newContext({ baseURL, extraHTTPHeaders: bypass() });
    try {
      const login = await signIn(ctx, slug, u.username, runPassword());
      expect(login.status(), await login.text()).toBe(200);
      expect((await ctx.get(url("/me"))).status()).toBe(200);

      const d = await as.admin.post(url(`/users/${u.id}/deactivate`));
      expect(d.status(), await d.text()).toBe(200);

      // the very next request on the still-held cookie is refused
      expect((await ctx.get(url("/me"))).status()).toBe(401);
      expect((await ctx.get(url("/stats"))).status()).toBe(401);
      expect((await ctx.get(apiUrl(slug, "/api/v1/permissions"))).status()).toBe(401);

      const relogin = await signIn(again, slug, u.username, runPassword());
      expect(relogin.status(), await relogin.text()).toBe(401);
      expect(sessionCookieLine(relogin)).toBeUndefined();
    } finally {
      await ctx.dispose();
      await again.dispose();
    }
  });
});
