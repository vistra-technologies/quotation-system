/**
 * Org listing, /me, /stats and the global permission catalog.
 * Negatives come from the matrix; happy paths and leak checks are explicit below.
 */
import { test, expect } from "../fixtures/test";
import { covers } from "../fixtures/covers";
import { registerNegatives } from "./api-matrix";
import { PERMISSION_CODES, ROLES, ROLE_NAME, ROLE_PERMISSIONS } from "./permissions";
import { apiUrl } from "../../e2e/helpers";
import { createLedgered, tag } from "./project-helpers";
import { authPost, bypass, runPassword, signIn, trustedOrigin } from "./sign-in";
import type { APIRequestContext, APIResponse } from "@playwright/test";

covers("GET /api/v1/orgs");
covers("GET /api/v1/orgs/[orgSlug]/me");
covers("PATCH /api/v1/orgs/[orgSlug]/me");
covers("GET /api/v1/orgs/[orgSlug]/stats");
covers("GET /api/v1/permissions");

registerNegatives([
  // any authenticated org member — no permission gate
  { key: "GET /api/v1/orgs/[orgSlug]/me", method: "GET", path: () => "/me" },
  // own profile: any authenticated org member; the invalid-body (400) cases run as a throwaway user in the describe below
  {
    key: "PATCH /api/v1/orgs/[orgSlug]/me",
    method: "PATCH",
    path: () => "/me",
    body: (c) => ({ firstName: `${c.run.prefix}neg` }),
  },
  { key: "GET /api/v1/orgs/[orgSlug]/stats", method: "GET", path: () => "/stats" },
  // global catalog: session + MANAGE_FEATURES, no org slug
  { key: "GET /api/v1/permissions", method: "GET", orgScoped: false, path: () => "/api/v1/permissions", permission: "MANAGE_FEATURES" },
]);

const SECRET_FIELD = /password|hash|secret|token/i;

test.describe("GET /api/v1/orgs/[orgSlug]/me", () => {
  for (const role of ROLES) {
    test(`${role}: returns the signed-in user, its role and exactly its role's permissions`, async ({ as, url, run }) => {
      const r = await as[role].get(url("/me"));
      expect(r.status(), await r.text()).toBe(200);
      const me = (await r.json()) as Record<string, unknown>;
      expect(Object.keys(me).sort()).toEqual(
        [
          "adminPermissions", "externalCompanyId", "externalCompanyName", "firstName", "lastName", "mobile", "name", "orgName",
          "permissionCodes", "profileEmail", "roleName", "userId", "username",
        ].sort(),
      );
      expect(typeof me.firstName).toBe("string");
      expect(typeof me.lastName).toBe("string");
      expect(me.mobile === null || typeof me.mobile === "string").toBe(true);
      expect(me.profileEmail === null || typeof me.profileEmail === "string").toBe(true);
      expect(Object.keys(me).filter((k) => SECRET_FIELD.test(k))).toEqual([]);
      expect(me.userId).toBe(run.users[role].id);
      expect(me.username).toBe(run.users[role].username);
      expect(me.roleName).toBe(ROLE_NAME[role]);
      expect([...(me.permissionCodes as string[])].sort()).toEqual([...ROLE_PERMISSIONS[role]].sort());
      const adminish = ["MANAGE_USERS", "MANAGE_FEATURES", "MANAGE_PRICING"];
      expect([...(me.adminPermissions as string[])].sort()).toEqual(ROLE_PERMISSIONS[role].filter((p) => adminish.includes(p)).sort());
      if (role === "admin" || role === "member") expect(me.externalCompanyId).toBeNull();
      else expect(me.externalCompanyId).toEqual(expect.any(String));
    });
  }

  test("org B's admin sees org B's identity on org B's slug (no Test-Org data)", async ({ orgB, run }) => {
    const r = await orgB.get(apiUrl(run.orgB.slug, `/api/v1/orgs/${run.orgB.slug}/me`));
    expect(r.status(), await r.text()).toBe(200);
    const me = (await r.json()) as { username: string; userId: string };
    expect(me.username).toBe(run.orgB.adminUser);
    expect(Object.values(run.users).map((u) => u.id)).not.toContain(me.userId);
  });
});

/**
 * PATCH /me and the password change (Hotfix 2026-10-10, My Account popup). Every mutation targets a
 * THROWAWAY user made by f.user (ledgered), signed in on its own cookie jar; the shared Test-Org
 * users are only read. Sign-ins are rate-limited (3/10 s/IP), so each test signs in only a few times.
 */
test.describe("PATCH /api/v1/orgs/[orgSlug]/me (own profile)", () => {
  const contexts: APIRequestContext[] = [];
  test.afterEach(async () => {
    while (contexts.length) await contexts.pop()!.dispose();
  });
  type Pw = { request: { newContext: (o: { baseURL?: string; extraHTTPHeaders: Record<string, string> }) => Promise<APIRequestContext> } };
  const jar = async (playwright: Pw, baseURL: string | undefined) => {
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: bypass() });
    contexts.push(ctx);
    return ctx;
  };
  const signedIn = async (playwright: Pw, baseURL: string | undefined, slug: string, username: string, password = runPassword()) => {
    const ctx = await jar(playwright, baseURL);
    const login = await signIn(ctx, slug, username, password);
    expect(login.status(), await login.text()).toBe(200);
    return ctx;
  };
  type Me = { firstName: string; lastName: string; mobile: string | null; profileEmail: string | null; name: string; username: string };
  const readMe = async (ctx: { get(u: string): Promise<APIResponse> }, url: (p: string) => string) => {
    const r = await ctx.get(url("/me"));
    expect(r.status(), await r.text()).toBe(200);
    return (await r.json()) as Me;
  };

  test("happy path: edits the four fields, recomputes name, GET /me reflects it, mobile and email can be cleared", async ({ f, url, run, playwright, baseURL }) => {
    const u = await f.user("member");
    const ctx = await signedIn(playwright, baseURL, run.testOrg.slug, u.username);
    expect(await readMe(ctx, url)).toMatchObject({ firstName: "RGR", lastName: "User", mobile: null, profileEmail: null, name: "RGR User" });

    const r = await ctx.patch(url("/me"), {
      data: { firstName: "  Ada ", lastName: "Lovelace", mobile: "+1 555 0100", profileEmail: "ada@example.com" },
    });
    expect(r.status(), await r.text()).toBe(200);
    expect(await r.json()).toEqual({
      ok: true, firstName: "Ada", lastName: "Lovelace", mobile: "+1 555 0100", profileEmail: "ada@example.com", name: "Ada Lovelace",
    });
    expect(await readMe(ctx, url)).toMatchObject({ firstName: "Ada", lastName: "Lovelace", name: "Ada Lovelace", username: u.username });

    // a partial update keeps the other fields; clearing mobile/email stores null
    const p = await ctx.patch(url("/me"), { data: { mobile: "", profileEmail: "" } });
    expect(p.status(), await p.text()).toBe(200);
    expect(await readMe(ctx, url)).toMatchObject({ firstName: "Ada", lastName: "Lovelace", mobile: null, profileEmail: null });
  });

  test("rejects identity and privilege keys (400) and changes nothing; a save touches only the caller's row", async ({ as, f, url, run, playwright, baseURL }) => {
    const u = await f.user("member");
    const ctx = await signedIn(playwright, baseURL, run.testOrg.slug, u.username);
    const before = await readMe(ctx, url);
    const roles = ((await (await as.admin.get(url("/roles"))).json()) as { roles: { id: string; name: string }[] }).roles;
    const adminRoleId = roles.find((x) => x.name === ROLE_NAME.admin)?.id;
    expect(adminRoleId).toBeTruthy();
    const otherBefore = await readMe(as.member, url);

    const attempts: Record<string, unknown>[] = [
      { username: "rgr-hijack" },
      { roleId: adminRoleId },
      { organizationId: run.orgB.id },
      { externalCompanyId: "00000000-0000-4000-8000-000000000000" },
      { active: false },
      { email: "x@y.internal" },
      { id: run.users.admin.id },
      { userId: run.users.admin.id },
      { firstName: "Ok", roleId: adminRoleId }, // a valid field next to a forbidden one is refused whole
    ];
    for (const data of attempts) {
      const r = await ctx.patch(url("/me"), { data });
      expect(r.status(), JSON.stringify(data)).toBe(400);
    }
    expect(await readMe(ctx, url)).toEqual(before);
    const row = await as.admin.get(url(`/users/${u.id}`));
    expect(((await row.json()) as { user: { username: string; active: boolean; role: { name: string } } }).user).toMatchObject({
      username: u.username, active: true, role: { name: ROLE_NAME.member },
    });

    const ok = await ctx.patch(url("/me"), { data: { firstName: "Solo" } });
    expect(ok.status(), await ok.text()).toBe(200);
    expect(await readMe(as.member, url)).toEqual(otherBefore);
  });

  // Every rejected body is refused (400) before any write. Run as a throwaway user (not the shared admin) so a
  // validator regression would only dirty a ledgered row.
  test("invalid bodies are refused (400) and nothing is written", async ({ f, url, run, playwright, baseURL }) => {
    const u = await f.user("member");
    const ctx = await signedIn(playwright, baseURL, run.testOrg.slug, u.username);
    const before = await readMe(ctx, url);
    const invalid: { name: string; body: unknown }[] = [
      { name: "{} (no editable field)", body: {} },
      { name: "array body", body: [] },
      { name: "empty firstName", body: { firstName: "" } },
      { name: "blank lastName", body: { lastName: "   " } },
      { name: "firstName over 100 chars", body: { firstName: "a".repeat(101) } },
      { name: "mobile over 30 chars", body: { mobile: "1".repeat(31) } },
      { name: "malformed profileEmail", body: { profileEmail: "not-an-email" } },
      { name: "unknown key", body: { firstName: "RGR", nickname: "x" } },
    ];
    for (const c of invalid) {
      const r = await ctx.patch(url("/me"), { data: c.body });
      expect(r.status(), c.name).toBe(400);
    }
    expect(await readMe(ctx, url)).toEqual(before);
  });

  // better-auth's own POST /api/auth/update-user is exposed by the catch-all route; the privilege fields are
  // input:false in lib/auth.ts, so better-auth answers 400 FIELD_NOT_ALLOWED for a truthy value (verified in
  // node_modules/better-auth/dist/db/schema.mjs parseInputData) and nothing changes.
  test("better-auth update-user cannot write role/company/org/username/email/active", async ({ as, f, url, run, playwright, baseURL }) => {
    const u = await f.user("member");
    const slug = run.testOrg.slug;
    const ctx = await signedIn(playwright, baseURL, slug, u.username);
    const before = await readMe(ctx, url);
    const roles = ((await (await as.admin.get(url("/roles"))).json()) as { roles: { id: string; name: string }[] }).roles;
    const adminRoleId = roles.find((x) => x.name === ROLE_NAME.admin)?.id;
    expect(adminRoleId).toBeTruthy();
    const origin = { Origin: trustedOrigin(slug, baseURL) };
    const attempts: Record<string, unknown>[] = [
      { roleId: adminRoleId },
      { organizationId: run.orgB.id },
      { externalCompanyId: "00000000-0000-4000-8000-000000000000" },
      { username: "rgr-hijack" },
      { profileEmail: "x@example.com" },
      { active: true },
    ];
    for (const data of attempts) {
      const r = await authPost(ctx, slug, "update-user", data, origin);
      expect(r.status(), JSON.stringify(data) + " " + (await r.text())).toBe(400);
    }
    expect(await readMe(ctx, url)).toEqual(before);
    const row = await as.admin.get(url(`/users/${u.id}`));
    expect(((await row.json()) as { user: { username: string; active: boolean; role: { name: string } } }).user).toMatchObject({
      username: u.username, active: true, role: { name: ROLE_NAME.member },
    });
  });

  test("password change: a wrong current password is refused; the right one rotates it (old rejected, new accepted)", async ({ f, url, run, playwright, baseURL }) => {
    const u = await f.user("member");
    const slug = run.testOrg.slug;
    const ctx = await signedIn(playwright, baseURL, slug, u.username);
    const newPw = `${runPassword()}-Rotated9`;

    const origin = { Origin: trustedOrigin(slug, baseURL) }; // cookie-bearing auth POST: better-auth CSRF check
    const wrong = await authPost(ctx, slug, "change-password", { currentPassword: "definitely-not-it-1", newPassword: newPw, revokeOtherSessions: true }, origin);
    expect(wrong.status(), await wrong.text()).toBe(400);
    expect(((await wrong.json()) as { code?: string }).code).toBe("INVALID_PASSWORD");

    const ok = await authPost(ctx, slug, "change-password", { currentPassword: runPassword(), newPassword: newPw, revokeOtherSessions: true }, origin);
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await ctx.get(url("/me"))).status()).toBe(200); // the changing session itself stays valid

    const old = await signIn(await jar(playwright, baseURL), slug, u.username, runPassword());
    expect(old.status()).toBe(401);
    const fresh = await signedIn(playwright, baseURL, slug, u.username, newPw);
    expect((await fresh.get(url("/me"))).status()).toBe(200);
  });
});

test.describe("GET /api/v1/orgs/[orgSlug]/stats", () => {
  const KEYS = ["inquiriesNew", "inquiriesTotal", "ordersTotal", "projectsInProgress", "projectsTotal"];

  test("returns exactly the numeric KPI counters (ordersTotal is 0 until Orders exist)", async ({ as, url }) => {
    for (const role of ROLES) {
      const r = await as[role].get(url("/stats"));
      expect(r.status(), await r.text()).toBe(200);
      const s = (await r.json()) as Record<string, unknown>;
      expect(Object.keys(s).sort()).toEqual(KEYS);
      for (const k of KEYS) expect(Number.isInteger(s[k]) && (s[k] as number) >= 0, `${role} ${k}=${String(s[k])}`).toBe(true);
      expect(s.ordersTotal).toBe(0);
    }
  });

  // Isolation proof that never compares org B's counters at all: other specs may create AND delete
  // org-B rows in parallel workers, so only "the new row is absent from org B" is asserted on that side.
  // The before/after delta is measured on the DISTRIBUTOR's company-scoped stats: org-wide Test-Org
  // totals also DROP while projects.spec deletes/converts projects in parallel (Task 8 fix round 1),
  // whereas nothing deletes a project of the run distributor's company during the run.
  test("a new Test-Org project is counted (company-scoped stats) and is invisible to org B", async ({ as, url, orgB, run, ledger }) => {
    const stats = async (g: typeof orgB, u: string) => {
      const r = await g.get(u);
      expect(r.status(), await r.text()).toBe(200);
      return (await r.json()) as { projectsTotal: number; projectsInProgress: number };
    };
    const orgBApi = (p: string) => apiUrl(run.orgB.slug, `/api/v1/orgs/${run.orgB.slug}${p}`);
    const before = await stats(as.distributor, url("/stats"));
    expect((await orgB.get(orgBApi("/stats"))).status()).toBe(200);
    const { res, id, body } = await createLedgered(as.distributor, { run, ledger }, "project", {
      name: `${run.prefix}stats-${tag()}`, currency: "AED",
    });
    expect(res.status(), JSON.stringify(body)).toBe(201);
    const proj = { id: id!, name: (body.project as { name: string }).name };
    const after = await stats(as.distributor, url("/stats"));
    expect(after.projectsTotal).toBeGreaterThanOrEqual(before.projectsTotal + 1);
    expect(after.projectsInProgress).toBeGreaterThanOrEqual(before.projectsInProgress + 1); // new projects are DRAFT
    expect((await stats(as.admin, url("/stats"))).projectsTotal).toBeGreaterThanOrEqual(after.projectsTotal); // org-wide ⊇ company

    // org B: the new project is not listed (searched by its unique name, and by id)
    for (const q of [`?pageSize=100&search=${encodeURIComponent(proj.name)}`, "?pageSize=100"]) {
      const l = await orgB.get(orgBApi(`/projects${q}`));
      expect(l.status(), await l.text()).toBe(200);
      const ids = ((await l.json()) as { projects: { id: string }[] }).projects.map((p) => p.id);
      expect(ids).not.toContain(proj.id);
    }
  });
});

test.describe("GET /api/v1/orgs (public org selector)", () => {
  test("anonymous 200: every org as exactly {id, slug, name} — no other fields", async ({ anon, run }) => {
    // Intentionally public (route doc: the apex org-selector and login page fetch it without a session).
    const r = await anon.get(apiUrl(run.testOrg.slug, "/api/v1/orgs"));
    expect(r.status(), await r.text()).toBe(200);
    const { orgs } = (await r.json()) as { orgs: Record<string, unknown>[] };
    expect(Array.isArray(orgs)).toBe(true);
    for (const o of orgs) expect(Object.keys(o).sort()).toEqual(["id", "name", "slug"]);
    expect(orgs.map((o) => o.slug)).toEqual(expect.arrayContaining([run.testOrg.slug, run.orgB.slug]));
  });

  test("an org session sees the same public list (the session grants nothing extra)", async ({ anon, as, run }) => {
    const u = apiUrl(run.testOrg.slug, "/api/v1/orgs");
    const [a, s] = await Promise.all([anon.get(u), as.admin.get(u)]);
    expect(s.status()).toBe(200);
    const keys = (b: { orgs: Record<string, unknown>[] }) => b.orgs.map((o) => Object.keys(o).sort().join(",")).filter((k) => k !== "id,name,slug");
    expect(keys((await s.json()) as { orgs: Record<string, unknown>[] })).toEqual([]);
    expect(a.status()).toBe(200);
  });
});

test.describe("GET /api/v1/permissions", () => {
  test("admin (MANAGE_FEATURES): the catalog holds the 8 permission codes, each {id, code, description}", async ({ as, run }) => {
    const r = await as.admin.get(apiUrl(run.testOrg.slug, "/api/v1/permissions"));
    expect(r.status(), await r.text()).toBe(200);
    const { permissions } = (await r.json()) as { permissions: Record<string, unknown>[] };
    for (const p of permissions) expect(Object.keys(p).sort()).toEqual(["code", "description", "id"]);
    const codes = permissions.map((p) => p.code as string);
    expect(codes).toEqual(expect.arrayContaining([...PERMISSION_CODES]));
  });
});
