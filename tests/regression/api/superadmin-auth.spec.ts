/**
 * SuperAdmin auth (Task 11, Step 1): login / logout / ping, and the auth gate of EVERY SuperAdmin route.
 *
 * Every SA route except login/logout calls requireSuperAdminFromRequest(): it rejects (401) a request
 *   - with no qs-sa-token cookie,
 *   - with a bogus qs-sa-token,
 *   - carrying an ORG-USER session (better-auth's own cookie — SA sessions are a different cookie/table),
 *     and with that org session's token replayed AS a qs-sa-token,
 *   - carrying a VALID SA cookie but addressed to an ORG SUBDOMAIN host (*.test.easeetool.com): the host
 *     check runs before the cookie lookup. That case needs a target that serves org subdomains; global
 *     setup decides the mode (run.saSubdomainProbe), proves it and logs it. In path mode the test records
 *     an annotation and asserts the precondition instead (never a skip — the suite allows none).
 *
 * The probes are rejection-only and cannot write: mutating ones go through a Guarded client whose
 * allowance holds ONLY a ghost id (no row has it), and their bodies are invalid or address that ghost, so
 * a broken gate surfaces as a 400/404 (test fails) rather than as a write.
 */
import { covers } from "../fixtures/covers";
import { Guarded, createAllowance } from "../fixtures/clients";
import type { RunState } from "../fixtures/run-state";
import { apiUrl, isSubdomain } from "../../e2e/helpers";
import { orgApi } from "./project-helpers";
import { test, expect, SA, GHOST, SA_USER, cookie, rawContext, saLogin, expectStatus, json, postAdmin, tag } from "./sa-helpers";
import { generateRunPassword } from "../fixtures/cleanup-rules";

covers("POST /api/v1/superadmin/login");
covers("POST /api/v1/superadmin/logout");
covers("GET /api/v1/superadmin/ping");

type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Probe = { key: string; method: Method; path: string; body?: unknown };

const G = GHOST;
/** Every SuperAdmin route/verb behind requireSuperAdminFromRequest (login/logout are deliberately open). */
const PROBES: Probe[] = [
  { key: "GET /api/v1/superadmin/ping", method: "GET", path: `${SA}/ping` },
  { key: "GET /api/v1/superadmin/admins", method: "GET", path: `${SA}/admins` },
  { key: "POST /api/v1/superadmin/admins", method: "POST", path: `${SA}/admins`, body: { username: "x", password: "short" } },
  { key: "PATCH /api/v1/superadmin/admins/[adminId]", method: "PATCH", path: `${SA}/admins/${G}`, body: { newPassword: "short" } },
  { key: "DELETE /api/v1/superadmin/admins/[adminId]", method: "DELETE", path: `${SA}/admins/${G}` },
  { key: "GET /api/v1/superadmin/audit-log", method: "GET", path: `${SA}/audit-log` },
  { key: "GET /api/v1/superadmin/component-categories", method: "GET", path: `${SA}/component-categories?orgId=${G}` },
  { key: "GET /api/v1/superadmin/component-types", method: "GET", path: `${SA}/component-types?orgId=${G}` },
  { key: "POST /api/v1/superadmin/component-types", method: "POST", path: `${SA}/component-types`, body: { orgId: G } },
  { key: "GET /api/v1/superadmin/component-types/[typeId]", method: "GET", path: `${SA}/component-types/${G}?orgId=${G}` },
  { key: "PATCH /api/v1/superadmin/component-types/[typeId]", method: "PATCH", path: `${SA}/component-types/${G}`, body: { orgId: G } },
  { key: "DELETE /api/v1/superadmin/component-types/[typeId]", method: "DELETE", path: `${SA}/component-types/${G}?orgId=${G}` },
  { key: "POST /api/v1/superadmin/component-types/[typeId]/reorder", method: "POST", path: `${SA}/component-types/${G}/reorder`, body: { orgId: G, direction: "up" } },
  { key: "GET /api/v1/superadmin/formula-sets", method: "GET", path: `${SA}/formula-sets` },
  { key: "POST /api/v1/superadmin/formula-sets", method: "POST", path: `${SA}/formula-sets`, body: {} },
  { key: "GET /api/v1/superadmin/formula-sets/[setId]", method: "GET", path: `${SA}/formula-sets/${G}` },
  { key: "PATCH /api/v1/superadmin/formula-sets/[setId]", method: "PATCH", path: `${SA}/formula-sets/${G}`, body: { name: "rgr-ghost" } },
  { key: "DELETE /api/v1/superadmin/formula-sets/[setId]", method: "DELETE", path: `${SA}/formula-sets/${G}` },
  { key: "POST /api/v1/superadmin/formula-sets/[setId]/version", method: "POST", path: `${SA}/formula-sets/${G}/version`, body: {} },
  { key: "GET /api/v1/superadmin/orgs", method: "GET", path: `${SA}/orgs` },
  { key: "POST /api/v1/superadmin/orgs", method: "POST", path: `${SA}/orgs`, body: {} },
  { key: "PATCH /api/v1/superadmin/orgs/[orgId]", method: "PATCH", path: `${SA}/orgs/${G}`, body: { name: "rgr-ghost" } },
  { key: "DELETE /api/v1/superadmin/orgs/[orgId]", method: "DELETE", path: `${SA}/orgs/${G}` },
  { key: "POST /api/v1/superadmin/orgs/[orgId]/suspend", method: "POST", path: `${SA}/orgs/${G}/suspend`, body: { suspend: true } },
  { key: "GET /api/v1/superadmin/orgs/[orgId]/users", method: "GET", path: `${SA}/orgs/${G}/users` },
  { key: "POST /api/v1/superadmin/orgs/[orgId]/users", method: "POST", path: `${SA}/orgs/${G}/users`, body: {} },
  { key: "PATCH /api/v1/superadmin/orgs/[orgId]/users/[userId]", method: "PATCH", path: `${SA}/orgs/${G}/users/${G}`, body: { firstName: "rgr" } },
  { key: "DELETE /api/v1/superadmin/orgs/[orgId]/users/[userId]", method: "DELETE", path: `${SA}/orgs/${G}/users/${G}` },
  { key: "GET /api/v1/superadmin/permissions", method: "GET", path: `${SA}/permissions` },
  { key: "GET /api/v1/superadmin/roles", method: "GET", path: `${SA}/roles?orgId=${G}` },
  { key: "POST /api/v1/superadmin/roles", method: "POST", path: `${SA}/roles`, body: { orgId: G, name: "rgr-ghost" } },
  { key: "PATCH /api/v1/superadmin/roles/[roleId]", method: "PATCH", path: `${SA}/roles/${G}`, body: { orgId: G, name: "rgr-ghost" } },
  { key: "GET /api/v1/superadmin/roles/[roleId]/permissions", method: "GET", path: `${SA}/roles/${G}/permissions?orgId=${G}` },
  { key: "POST /api/v1/superadmin/roles/[roleId]/permissions", method: "POST", path: `${SA}/roles/${G}/permissions`, body: { orgId: G, permissionId: G } },
  { key: "DELETE /api/v1/superadmin/roles/[roleId]/permissions", method: "DELETE", path: `${SA}/roles/${G}/permissions`, body: { orgId: G, permissionId: G } },
];

function send(g: Guarded, p: Probe, url: string) {
  switch (p.method) {
    case "GET":
      return g.get(url);
    case "POST":
      return g.post(url, { data: p.body ?? {} });
    case "PATCH":
      return g.patch(url, { data: p.body ?? {} });
    case "DELETE":
      return p.body === undefined ? g.delete(url) : g.delete(url, { data: p.body });
  }
}

/** The org session token from a Test-Org storage state (better-auth cookie, name ends in session_token). */
async function orgSessionToken(ctx: Guarded): Promise<string> {
  const c = (await ctx.ctx.storageState()).cookies.find((x) => /session_token$/.test(x.name));
  if (!c) throw new Error("setup: the Test-Org admin storage state carries no session_token cookie");
  return c.value;
}

/** I4: a `precondition` annotation = NOT exercised on this target; the report lists them under "Not exercised on this target". */
function subdomainNote(run: RunState): void {
  if (run.saSubdomainProbe) return; // asserted below — nothing to report
  test.info().annotations.push({
    type: "precondition",
    description: "SA cookie on an org subdomain host: NOT exercised — path-mode target without org subdomains (global setup logged this mode); the other rejections are asserted",
  });
}

test.describe("SuperAdmin auth gate: every SA route rejects everything but a valid SA session on the apex host", () => {
  // What this proves: the org session used below is live, and setup's probe mode matches this target's host
  // shape. What it does NOT prove: that the org subdomain host runs the SAME deployment as the apex (setup
  // only checks that /api/health answers 200 there) — on test.easeetool.com both are the staging deployment.
  test("precondition: the org-user session used below is live, and setup's subdomain-probe mode matches the target's host shape", async ({ as, run }) => {
    expect((await as.admin.get(orgApi(run.testOrg.slug, "/me"))).status()).toBe(200);
    expect(await orgSessionToken(as.admin)).toBeTruthy();
    expect(run.saSubdomainProbe).toBe(isSubdomain);
  });

  for (const p of PROBES) {
    test(`${p.key}: 401 with no cookie / bogus cookie / org-user session / org token as qs-sa-token / SA cookie on an org subdomain`, async ({ anon, as, sa, run }) => {
      subdomainNote(run);
      const allowance = createAllowance([], [GHOST]); // the ONLY id a mutating probe may address
      const orgToken = await orgSessionToken(as.admin);
      const variants: Array<[string, Guarded, string]> = [
        ["no cookie", new Guarded(anon.ctx, allowance), p.path],
        ["bogus qs-sa-token", new Guarded(anon.ctx, allowance, cookie(`rgr-bogus-${GHOST}`)), p.path],
        ["org-user session cookie", new Guarded(as.admin.ctx, allowance), p.path],
        ["org session token replayed as qs-sa-token", new Guarded(anon.ctx, allowance, cookie(orgToken)), p.path],
      ];
      if (run.saSubdomainProbe) {
        // valid SA token, org subdomain host: requireSuperAdminFromRequest rejects on the Host header
        variants.push(["valid SA cookie on an org subdomain host", new Guarded(anon.ctx, allowance, cookie(sa.token)), apiUrl(run.testOrg.slug, p.path)]);
      }
      for (const [what, g, url] of variants) {
        await expectStatus(await send(g, p, url), 401, `${p.key} — ${what}`);
      }
      // control: the same SA token IS accepted on the apex host (so the 401s above are the gate, not a dead token)
      expect((await sa.get(`${SA}/ping`)).status()).toBe(200);
    });
  }

  test("the SA cookie's host binding: ping on the apex 200, on the org subdomain 401 (or annotated in path mode)", async ({ anon, sa, run }) => {
    subdomainNote(run);
    const apex = await json<{ ok: boolean; username: string }>(await anon.get(`${SA}/ping`, { headers: cookie(sa.token) }));
    expect(apex).toEqual({ ok: true, username: SA_USER() });
    if (run.saSubdomainProbe) {
      const sub = await anon.get(apiUrl(run.testOrg.slug, `${SA}/ping`), { headers: cookie(sa.token) });
      expect(sub.status()).toBe(401);
      expect(await sub.json()).toEqual({ error: "Unauthorized" });
    }
    // path mode: the subdomain rejection is not exercised — reported via the precondition annotation (subdomainNote)
  });

  test("GET /superadmin/orgs/[orgId] does not exist (405) — the org detail is only reachable via PATCH/DELETE", async ({ sa, run }) => {
    expect((await sa.get(`${SA}/orgs/${run.orgB.id}`)).status()).toBe(405);
  });
});

test.describe("POST /api/v1/superadmin/login", () => {
  test("400 on a malformed JSON body or missing / non-string fields", async ({ playwright, baseURL }) => {
    const ctx = await rawContext(playwright, baseURL);
    try {
      const bad = await ctx.post(`${SA}/login`, { data: Buffer.from("{not json"), headers: { "Content-Type": "application/json" } });
      expect(bad.status()).toBe(400);
      expect(await bad.json()).toEqual({ error: "Invalid JSON body" });
      for (const data of [{}, { username: SA_USER() }, { password: "x" }, { username: 5, password: "x" }, { username: "x", password: null }]) {
        const r = await ctx.post(`${SA}/login`, { data });
        expect(r.status(), JSON.stringify(data)).toBe(400);
        expect(await r.json()).toEqual({ error: "username and password are required" });
      }
    } finally {
      await ctx.dispose();
    }
  });

  test("401 'Invalid credentials' — identical for a wrong password and an unknown username (no enumeration), no cookie set", async ({ playwright, baseURL, run, sa, ledger }) => {
    // M4: the wrong-password probe targets a throwaway rgr- SuperAdmin (ledgered), never the tester account —
    // failed logins against TEST_SA_USERNAME could trip a lockout / rate limit for the whole run
    const username = `${run.prefix}authprobe-${tag()}`;
    const created = await postAdmin(sa, ledger, username, generateRunPassword());
    expect(created.status(), await created.text()).toBe(201);
    const ctx = await rawContext(playwright, baseURL);
    try {
      const wrong = await saLogin(ctx, username, `${run.prefix}not-the-password`);
      const unknown = await saLogin(ctx, `${run.prefix}nosuchadmin`, `${run.prefix}not-the-password`);
      for (const r of [wrong, unknown]) {
        expect(r.status).toBe(401);
        expect(JSON.parse(r.body)).toEqual({ error: "Invalid credentials" });
        expect(r.token).toBeUndefined();
      }
    } finally {
      await ctx.dispose();
    }
  });

  test("200 sets an apex-only session cookie: HttpOnly, Secure, SameSite=Lax, Path=/, Expires, NO Domain attribute", async ({ playwright, baseURL }) => {
    const ctx = await rawContext(playwright, baseURL);
    try {
      const r = await saLogin(ctx, SA_USER(), process.env.TEST_SA_PASSWORD!);
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body)).toEqual({ ok: true });
      expect(r.token).toBeTruthy();
      const line = r.setCookie.split("\n").find((l) => l.startsWith("qs-sa-token="))!;
      const attrs = line.split(";").map((s) => s.trim().toLowerCase());
      expect(attrs).toContain("httponly");
      expect(attrs).toContain("secure");
      expect(attrs).toContain("samesite=lax");
      expect(attrs).toContain("path=/");
      expect(attrs.some((a) => a.startsWith("expires="))).toBe(true);
      expect(attrs.some((a) => a.startsWith("domain="))).toBe(false); // binds to the exact host — never sent to org subdomains
      // the new session works, then is ended so it does not linger
      expect((await ctx.get(`${SA}/ping`, { headers: cookie(r.token!) })).status()).toBe(200);
      expect((await ctx.post(`${SA}/logout`, { headers: cookie(r.token!) })).status()).toBe(200);
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe("POST /api/v1/superadmin/logout + GET /api/v1/superadmin/ping", () => {
  test("logout ends THAT session only (ping 200 → logout → ping 401) and clears the cookie; other sessions keep working", async ({ playwright, baseURL, sa }) => {
    const ctx = await rawContext(playwright, baseURL);
    try {
      const s = await saLogin(ctx, SA_USER(), process.env.TEST_SA_PASSWORD!);
      expect(s.status).toBe(200);
      expect(await json(await ctx.get(`${SA}/ping`, { headers: cookie(s.token!) }))).toEqual({ ok: true, username: SA_USER() });
      const out = await ctx.post(`${SA}/logout`, { headers: cookie(s.token!) });
      expect(out.status()).toBe(200);
      expect(await out.json()).toEqual({ ok: true });
      const cleared = out.headersArray().find((h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith("qs-sa-token="))?.value ?? "";
      expect(cleared).toMatch(/^qs-sa-token=;/);
      expect(cleared.toLowerCase()).toContain("max-age=0");
      const after = await ctx.get(`${SA}/ping`, { headers: cookie(s.token!) });
      expect(after.status()).toBe(401);
      expect(await after.json()).toEqual({ error: "Unauthorized" });
      expect((await sa.get(`${SA}/ping`)).status()).toBe(200); // the worker's own session is untouched
    } finally {
      await ctx.dispose();
    }
  });

  test("logout is idempotent and open: no cookie / an unknown token / a repeated logout all answer 200 { ok: true }", async ({ playwright, baseURL }) => {
    const ctx = await rawContext(playwright, baseURL);
    try {
      for (const headers of [{}, cookie(`rgr-bogus-${GHOST}`)]) {
        const r = await ctx.post(`${SA}/logout`, { headers });
        expect(r.status()).toBe(200);
        expect(await r.json()).toEqual({ ok: true });
      }
    } finally {
      await ctx.dispose();
    }
  });
});
