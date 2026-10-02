/**
 * Org user administration: users (list/create), users/[userId] (get/delete), activate, deactivate,
 * password, profile, role. Every route is gated on MANAGE_USERS.
 *
 * Expected statuses are pinned to the route + lib/data/users.ts source (read 2026-10-03). Where the
 * source contradicts its own doc comment / the regression spec, the correct expectation is written in
 * a `test.fail()` test (a KNOWN PRODUCT BUG, listed in the Task 7 report → backlog): it runs, passes
 * while the bug exists and turns red once fixed (then drop the `test.fail` line). Where useful, a
 * plain test next to it pins the safe part of today's behaviour. (test.fixme would be a skip, which
 * the suite's reporter treats as a failure.) RGR_SHOW_KNOWN_BUGS=1 runs them as plain tests, to see
 * that each one fails on its bug assertion and not on setup.
 *
 * Rows: Test-Org users come from `f.user` (ledgered). The org-B "victim" user (the foreign-id target)
 * is ledgered too (kind user — the SuperAdmin user-delete route removes it; org B's own teardown would
 * cascade it anyway). Sign-ins are rate-limited (3/10 s/IP): fresh sign-ins are used only where the
 * test is ABOUT a session, and retry on 429.
 */
import { randomBytes } from "node:crypto";
import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";
import { test, expect } from "../fixtures/test";
import { covers } from "../fixtures/covers";
import { Ledger } from "../fixtures/ledger";
import { LEDGER_FILE } from "../env";
import { Guarded, SaClient, createAllowance } from "../fixtures/clients";
import { registerNegatives, GHOST, type Ctx } from "./api-matrix";
import { ROLE_NAME } from "./permissions";
import { apiUrl } from "../../e2e/helpers";
import { bypass, runPassword, sessionCookieLine, signIn } from "./sign-in";

covers("GET /api/v1/orgs/[orgSlug]/users");
covers("POST /api/v1/orgs/[orgSlug]/users");
covers("GET /api/v1/orgs/[orgSlug]/users/[userId]");
covers("DELETE /api/v1/orgs/[orgSlug]/users/[userId]");
covers("POST /api/v1/orgs/[orgSlug]/users/[userId]/activate");
covers("POST /api/v1/orgs/[orgSlug]/users/[userId]/deactivate");
covers("POST /api/v1/orgs/[orgSlug]/users/[userId]/password");
covers("PUT /api/v1/orgs/[orgSlug]/users/[userId]/profile");
covers("PATCH /api/v1/orgs/[orgSlug]/users/[userId]/role");

type UserRow = {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  name: string;
  mobile: string | null;
  profileEmail: string | null;
  active: boolean;
  roleId: string;
  externalCompanyId: string | null;
  role: { name: string };
};

const orgApi = (slug: string, p: string) => apiUrl(slug, `/api/v1/orgs/${slug}${p}`);

/** Role id by name in the org the client belongs to. */
async function roleIdIn(g: Guarded, slug: string, name: string): Promise<string> {
  const r = await g.get(orgApi(slug, "/roles"));
  expect(r.status(), await r.text()).toBe(200);
  const id = ((await r.json()) as { roles: { id: string; name: string }[] }).roles.find((x) => x.name === name)?.id;
  if (!id) throw new Error(`org ${slug} has no role "${name}"`);
  return id;
}
const testOrgRole = (c: Pick<Ctx, "as" | "run">, name: string) => roleIdIn(c.as.admin, c.run.testOrg.slug, name);

/**
 * One org-B user per worker: the target for every foreign-id probe (never org B's own admin, so a
 * tenancy leak on deactivate/password could not lock the orgB fixture out). Ledgered on creation.
 */
let orgBVictim: Promise<string> | undefined;
function foreignUserId(c: Ctx): Promise<string> {
  orgBVictim ??= (async () => {
    const slug = c.run.orgB.slug;
    const username = `${c.run.prefix}b-victim-${randomBytes(3).toString("hex")}`;
    const roleId = await roleIdIn(c.orgB, slug, ROLE_NAME.member);
    const r = await c.orgB.post(orgApi(slug, "/users"), {
      data: { username, firstName: "RGR", lastName: "Victim", password: runPassword(), roleId },
    });
    expect(r.status(), await r.text()).toBe(201);
    const l = await c.orgB.get(orgApi(slug, "/users"));
    const id = ((await l.json()) as { users: { id: string; username: string }[] }).users.find((u) => u.username === username)?.id;
    if (!id) throw new Error(`org-B user ${username} was created but is not listed`);
    new Ledger(LEDGER_FILE).add({ kind: "user", id, orgSlug: slug, label: username });
    return id;
  })();
  return orgBVictim;
}

/** A role of org B, for "role from another org" probes. */
const orgBRoleId = (c: Ctx) => roleIdIn(c.orgB, c.run.orgB.slug, ROLE_NAME.member);

const newUserBody = (c: Ctx, over: Record<string, unknown>) => ({
  username: `${c.run.prefix}neg-${randomBytes(3).toString("hex")}`,
  firstName: "RGR",
  lastName: "Neg",
  password: runPassword(),
  ...over,
});

registerNegatives([
  { key: "GET /api/v1/orgs/[orgSlug]/users", method: "GET", path: () => "/users", permission: "MANAGE_USERS" },
  {
    key: "POST /api/v1/orgs/[orgSlug]/users",
    method: "POST",
    path: () => "/users",
    permission: "MANAGE_USERS",
    // no password → a leaked auth gate still could not create anything
    body: (c) => ({ username: `${c.run.prefix}neg-auth`, firstName: "RGR", lastName: "Neg" }),
    invalid: [
      { name: "{} (username required)", body: {}, status: 400 },
      { name: "username only (firstName/lastName/roleId/password missing)", body: (c: Ctx) => ({ username: `${c.run.prefix}neg-x` }), status: 400 },
      {
        name: "password shorter than 8 characters",
        body: async (c: Ctx) => newUserBody(c, { roleId: await testOrgRole(c, ROLE_NAME.member), password: "short" }),
        status: 400,
      },
      { name: "unknown roleId", body: (c: Ctx) => newUserBody(c, { roleId: GHOST }), status: 400 },
      { name: "roleId of another org", body: async (c: Ctx) => newUserBody(c, { roleId: await orgBRoleId(c) }), status: 400 },
      {
        name: "U3: external role (Distributor) without externalCompanyId",
        body: async (c: Ctx) => newUserBody(c, { roleId: await testOrgRole(c, ROLE_NAME.distributor) }),
        status: 400,
      },
      {
        name: "unknown externalCompanyId",
        body: async (c: Ctx) => newUserBody(c, { roleId: await testOrgRole(c, ROLE_NAME.distributor), externalCompanyId: GHOST }),
        status: 400,
      },
    ],
  },
  {
    key: "GET /api/v1/orgs/[orgSlug]/users/[userId]",
    method: "GET",
    path: (c) => `/users/${c.run.users.member.id}`,
    permission: "MANAGE_USERS",
    unknownId: () => `/users/${GHOST}`,
    foreignId: async (c) => `/users/${await foreignUserId(c)}`,
  },
  // unknown/foreign id → 400 today (doc says 404): hand-written below, not in the matrix
  { key: "DELETE /api/v1/orgs/[orgSlug]/users/[userId]", method: "DELETE", path: () => `/users/${GHOST}`, permission: "MANAGE_USERS" },
  {
    key: "POST /api/v1/orgs/[orgSlug]/users/[userId]/activate",
    method: "POST",
    path: (c) => `/users/${c.run.users.member.id}/activate`, // already active: a leak would be a no-op
    permission: "MANAGE_USERS",
    malformedJson: false, // reads no body
    unknownId: () => `/users/${GHOST}/activate`,
    foreignId: async (c) => `/users/${await foreignUserId(c)}/activate`,
  },
  {
    key: "POST /api/v1/orgs/[orgSlug]/users/[userId]/deactivate",
    method: "POST",
    path: () => `/users/${GHOST}/deactivate`, // never a live user: a leaked gate must not lock anyone out
    permission: "MANAGE_USERS",
    malformedJson: false, // reads no body
    unknownId: () => `/users/${GHOST}/deactivate`,
    foreignId: async (c) => `/users/${await foreignUserId(c)}/deactivate`,
  },
  {
    key: "POST /api/v1/orgs/[orgSlug]/users/[userId]/password",
    method: "POST",
    path: () => `/users/${GHOST}/password`,
    permission: "MANAGE_USERS",
    body: () => ({ password: runPassword() }), // valid, so unknown/foreign id reach the lookup
    unknownId: () => `/users/${GHOST}/password`,
    foreignId: async (c) => `/users/${await foreignUserId(c)}/password`,
    invalid: [
      { name: "{} (password required)", body: {}, status: 400 },
      { name: "empty password", body: { password: "" }, status: 400 },
      { name: "non-string password", body: { password: 12345678 }, status: 400 },
    ],
  },
  {
    key: "PUT /api/v1/orgs/[orgSlug]/users/[userId]/profile",
    method: "PUT",
    path: (c) => `/users/${c.run.users.member.id}/profile`, // default body {} is a no-op
    permission: "MANAGE_USERS",
    unknownId: () => `/users/${GHOST}/profile`,
    foreignId: async (c) => `/users/${await foreignUserId(c)}/profile`,
    invalid: [
      { name: "empty firstName", body: { firstName: "" }, status: 400 },
      { name: "blank lastName", body: { lastName: "   " }, status: 400 },
      { name: "non-string firstName", body: { firstName: 42 }, status: 400 },
      // unknown externalCompanyId → 404 "User not found" today (mis-mapped): hand-written below
    ],
  },
  {
    key: "PATCH /api/v1/orgs/[orgSlug]/users/[userId]/role",
    method: "PATCH",
    path: (c) => `/users/${c.run.users.member.id}/role`, // default body {} → 400 before any write
    permission: "MANAGE_USERS",
    invalid: [
      { name: "{} (roleId required)", body: {}, status: 400 },
      { name: "unknown roleId", body: { roleId: GHOST }, status: 400 },
      { name: "roleId of another org", body: async (c: Ctx) => ({ roleId: await orgBRoleId(c) }), status: 400 },
    ],
  },
]);

async function getUser(g: Guarded, url: (p: string) => string, id: string): Promise<{ user: UserRow; isSelf: boolean }> {
  const r = await g.get(url(`/users/${id}`));
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()) as { user: UserRow; isSelf: boolean };
}

test.describe("users: rules", () => {
  const contexts: APIRequestContext[] = [];
  /** A cookie-jar context for a fresh sign-in; disposed after each test. */
  const fresh = async (pw: PlaywrightWorkerArgs["playwright"], baseURL?: string) => {
    const c = await pw.request.newContext({ baseURL, extraHTTPHeaders: bypass() });
    contexts.push(c);
    return c;
  };
  test.afterEach(async () => {
    while (contexts.length) await contexts.pop()!.dispose();
  });

  test("create → appears in list → can sign in → role change takes effect on the live session", async ({ as, f, url, run, playwright, baseURL }) => {
    const u = await f.user("member");
    const list = (await (await as.admin.get(url("/users"))).json()) as { users: (UserRow & Record<string, unknown>)[] };
    const row = list.users.find((x) => x.id === u.id);
    expect(row, "new user is listed").toBeTruthy();
    expect(row!.role.name).toBe(ROLE_NAME.member);
    expect(row!.active).toBe(true);
    expect(Object.keys(row!).filter((k) => /password|hash/i.test(k))).toEqual([]);

    const { user, isSelf } = await getUser(as.admin, url, u.id);
    expect(isSelf).toBe(false);
    expect(user).toMatchObject({ username: u.username, firstName: "RGR", lastName: "User", name: "RGR User", active: true, externalCompanyId: null });

    const sess = await fresh(playwright, baseURL);
    const login = await signIn(sess, run.testOrg.slug, u.username, runPassword());
    expect(login.status(), await login.text()).toBe(200);
    expect((await sess.get(url("/inventory"))).status()).toBe(200); // Company Member holds MANAGE_PRICING

    // External roles need a company (U3): give the user one via profile first, then change the role.
    const co = await f.externalCompany();
    const p = await as.admin.put(url(`/users/${u.id}/profile`), { data: { externalCompanyId: co.id } });
    expect(p.status(), await p.text()).toBe(200);
    const archId = await roleIdIn(as.admin, run.testOrg.slug, ROLE_NAME.architect);
    const ch = await as.admin.patch(url(`/users/${u.id}/role`), { data: { roleId: archId } });
    expect(ch.status(), await ch.text()).toBe(200);
    expect(await ch.json()).toEqual({ ok: true });

    // applies on the very next request of the still-held session
    expect((await sess.get(url("/inventory"))).status()).toBe(403);
    const me = await sess.get(url("/me"));
    expect(me.status()).toBe(200);
    expect(((await me.json()) as { roleName: string }).roleName).toBe(ROLE_NAME.architect);
    expect((await getUser(as.admin, url, u.id)).user.roleId).toBe(archId);
  });

  test("duplicate username in the same org → 409, nothing created", async ({ as, f, url, run }) => {
    const u = await f.user("member");
    const roleId = await roleIdIn(as.admin, run.testOrg.slug, ROLE_NAME.member);
    const before = ((await (await as.admin.get(url("/users"))).json()) as { users: unknown[] }).users.length;
    const r = await as.admin.post(url("/users"), {
      data: { username: u.username, firstName: "RGR", lastName: "Dup", password: runPassword(), roleId },
    });
    expect(r.status(), await r.text()).toBe(409);
    expect(((await r.json()) as { error: string }).error).toContain("already taken");
    const l = (await (await as.admin.get(url("/users"))).json()) as { users: { username: string }[] };
    expect(l.users.filter((x) => x.username === u.username)).toHaveLength(1);
    expect(l.users.length).toBeGreaterThanOrEqual(before); // other workers may add users in parallel
  });

  test("usernames are unique per org, not globally: org B may reuse a Test-Org username", async ({ f, orgB, run, ledger }) => {
    const u = await f.user("member");
    const slug = run.orgB.slug;
    const roleId = await roleIdIn(orgB, slug, ROLE_NAME.member);
    const r = await orgB.post(orgApi(slug, "/users"), {
      data: { username: u.username, firstName: "RGR", lastName: "Twin", password: runPassword(), roleId },
    });
    expect(r.status(), await r.text()).toBe(201);
    expect(await r.json()).toEqual({ user: { username: u.username } });
    const twin = ((await (await orgB.get(orgApi(slug, "/users"))).json()) as { users: { id: string; username: string }[] }).users.find(
      (x) => x.username === u.username,
    );
    expect(twin, "created in org B").toBeTruthy();
    ledger.add({ kind: "user", id: twin!.id, orgSlug: slug, label: u.username });
    expect(twin!.id).not.toBe(u.id);
  });

  test("last-admin protection: org B's only Admin cannot deactivate or delete itself", async ({ orgB, run }) => {
    const slug = run.orgB.slug;
    const me = (await (await orgB.get(orgApi(slug, "/me"))).json()) as { userId: string };
    const admins = ((await (await orgB.get(orgApi(slug, "/users"))).json()) as { users: { id: string; role: { name: string } }[] }).users.filter(
      (x) => x.role.name === ROLE_NAME.admin,
    );
    expect(admins.map((a) => a.id)).toEqual([me.userId]); // org B really has exactly one Admin

    const d = await orgB.post(orgApi(slug, `/users/${me.userId}/deactivate`));
    expect(d.status(), await d.text()).toBe(400);
    expect(((await d.json()) as { error: string }).error).toMatch(/cannot deactivate your own account/i);
    const del = await orgB.delete(orgApi(slug, `/users/${me.userId}`));
    expect(del.status(), await del.text()).toBe(400);
    expect(((await del.json()) as { error: string }).error).toMatch(/cannot delete your own account/i);
    expect((await orgB.get(orgApi(slug, "/me"))).status()).toBe(200); // still signed in and active
  });

  // SUSPECTED PRODUCT BUG (Task 7 report): changeUserRole has no self / last-admin guard — the only
  // Admin can demote itself and leave the org with no user able to manage users or roles. Because today
  // the demotion SUCCEEDS, the test runs in its own single-admin throwaway org C (ledgered kind org,
  // hard-deleted at teardown) — never org B, whose admin the other probes rely on.
  test("last-admin protection: the only Admin cannot be demoted (PATCH own role → 400)", async ({ run, ledger, playwright, baseURL }) => {
    test.fail(!process.env.RGR_SHOW_KNOWN_BUGS, "KNOWN PRODUCT BUG (see comment above): flips red once fixed — then drop this line");
    const sa = await SaClient.login(baseURL!, process.env.TEST_SA_USERNAME!, process.env.TEST_SA_PASSWORD!, createAllowance([]), process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
    const slug = `${run.prefix}c${randomBytes(2).toString("hex")}`;
    let ctx: APIRequestContext | undefined;
    try {
      const c = await sa.post("/api/v1/superadmin/orgs", { data: { name: `RGR ${run.runId} C`, slug, adminPassword: runPassword(), formulaSetId: run.formulaSetId } });
      if (c.status() !== 201) throw new Error(`setup: create org C → HTTP ${c.status()} ${await c.text()}`);
      const orgC = ((await c.json()) as { org: { id: string; slug: string } }).org;
      ledger.add({ kind: "org", id: orgC.id, orgSlug: orgC.slug, label: orgC.slug });

      ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: bypass() });
      const login = await signIn(ctx, slug, "admin", runPassword()); // org C's seeded (only) admin
      if (login.status() !== 200) throw new Error(`setup: sign in to org C → HTTP ${login.status()}`);
      const admin = new Guarded(ctx, createAllowance([slug], [orgC.id]));
      const me = (await (await admin.get(orgApi(slug, "/me"))).json()) as { userId: string; roleName: string };
      if (me.roleName !== ROLE_NAME.admin) throw new Error(`setup: org C's admin has role ${me.roleName}`);
      const memberRole = await roleIdIn(admin, slug, ROLE_NAME.member);

      const r = await admin.patch(orgApi(slug, `/users/${me.userId}/role`), { data: { roleId: memberRole } });
      expect(r.status(), await r.text()).toBe(400);
      expect(((await (await admin.get(orgApi(slug, "/me"))).json()) as { roleName: string }).roleName).toBe(ROLE_NAME.admin);
    } finally {
      await ctx?.dispose();
      await sa.dispose();
    }
  });

  test("an admin cannot deactivate or delete themselves (400) and stays active", async ({ as, url, run }) => {
    const id = run.users.admin.id;
    const { isSelf } = await getUser(as.admin, url, id);
    expect(isSelf).toBe(true);
    const d = await as.admin.post(url(`/users/${id}/deactivate`));
    expect(d.status(), await d.text()).toBe(400);
    const del = await as.admin.delete(url(`/users/${id}`));
    expect(del.status(), await del.text()).toBe(400);
    expect((await getUser(as.admin, url, id)).user.active).toBe(true);
    expect((await as.admin.get(url("/me"))).status()).toBe(200);
  });

  test("password reset: old password rejected, new one accepted", async ({ as, f, url, run, playwright, baseURL }) => {
    const u = await f.user("member");
    const slug = run.testOrg.slug;
    const newPw = `${runPassword()}-Rotated9`;
    const r = await as.admin.post(url(`/users/${u.id}/password`), { data: { password: newPw } });
    expect(r.status(), await r.text()).toBe(200);
    expect(await r.json()).toEqual({ ok: true });

    const old = await signIn(await fresh(playwright, baseURL), slug, u.username, runPassword());
    expect(old.status(), await old.text()).toBe(401);
    expect(sessionCookieLine(old)).toBeUndefined();
    const ctx = await fresh(playwright, baseURL);
    const ok = await signIn(ctx, slug, u.username, newPw);
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await ctx.get(url("/me"))).status()).toBe(200);
  });

  // SUSPECTED PRODUCT BUG: setUserPassword only rewrites the credential hash — sessions opened with the
  // old password stay valid after an admin reset (the usual reason for a reset is a compromised account).
  test("password reset revokes the user's existing sessions", async ({ as, f, url, run, playwright, baseURL }) => {
    test.fail(!process.env.RGR_SHOW_KNOWN_BUGS, "KNOWN PRODUCT BUG (see comment above): flips red once fixed — then drop this line");
    const u = await f.user("member");
    const held = await fresh(playwright, baseURL);
    expect((await signIn(held, run.testOrg.slug, u.username, runPassword())).status()).toBe(200);
    expect((await held.get(url("/me"))).status()).toBe(200);
    const r = await as.admin.post(url(`/users/${u.id}/password`), { data: { password: `${runPassword()}-Rotated9` } });
    expect(r.status()).toBe(200);
    expect((await held.get(url("/me"))).status()).toBe(401);
  });

  // SUSPECTED PRODUCT BUG: POST /users enforces "at least 8 characters" but the reset route accepts any
  // non-empty password (a 1-char password is stored).
  test("password reset enforces the same 8-character minimum as create (400)", async ({ as, f, url }) => {
    test.fail(!process.env.RGR_SHOW_KNOWN_BUGS, "KNOWN PRODUCT BUG (see comment above): flips red once fixed — then drop this line");
    const u = await f.user("member");
    const r = await as.admin.post(url(`/users/${u.id}/password`), { data: { password: "short" } });
    expect(r.status(), await r.text()).toBe(400);
  });

  test("deactivate → sign-in refused; activate → sign-in works again", async ({ as, f, url, run, playwright, baseURL }) => {
    const u = await f.user("member");
    const slug = run.testOrg.slug;
    const d = await as.admin.post(url(`/users/${u.id}/deactivate`));
    expect(d.status(), await d.text()).toBe(200);
    expect(await d.json()).toEqual({ ok: true });
    expect((await getUser(as.admin, url, u.id)).user.active).toBe(false);
    // a deactivated user still appears in the admin list (deactivate is not delete)
    const listed = ((await (await as.admin.get(url("/users"))).json()) as { users: { id: string; active: boolean }[] }).users.find((x) => x.id === u.id);
    expect(listed?.active).toBe(false);

    const refused = await signIn(await fresh(playwright, baseURL), slug, u.username, runPassword());
    expect(refused.status(), await refused.text()).toBe(401);
    expect(sessionCookieLine(refused)).toBeUndefined();

    const a = await as.admin.post(url(`/users/${u.id}/activate`));
    expect(a.status(), await a.text()).toBe(200);
    expect(await a.json()).toEqual({ ok: true });
    expect((await getUser(as.admin, url, u.id)).user.active).toBe(true);
    // activate is idempotent
    expect((await as.admin.post(url(`/users/${u.id}/activate`))).status()).toBe(200);

    const ctx = await fresh(playwright, baseURL);
    const ok = await signIn(ctx, slug, u.username, runPassword());
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await ctx.get(url("/me"))).status()).toBe(200);
  });

  test("profile PUT updates name/mobile/email and GET reflects it; omitted fields are untouched; '' clears optional fields", async ({ as, f, url }) => {
    const u = await f.user("member");
    const r = await as.admin.put(url(`/users/${u.id}/profile`), {
      data: { firstName: "  Rgr ", lastName: "Renamed", mobile: "+971500000000", profileEmail: "rgr@example.test" },
    });
    expect(r.status(), await r.text()).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    let { user } = await getUser(as.admin, url, u.id);
    expect(user).toMatchObject({ firstName: "Rgr", lastName: "Renamed", name: "Rgr Renamed", mobile: "+971500000000", profileEmail: "rgr@example.test" });
    expect(user.username).toBe(u.username); // username is immutable via profile

    // only supplied keys change
    expect((await as.admin.put(url(`/users/${u.id}/profile`), { data: { lastName: "Again" } })).status()).toBe(200);
    ({ user } = await getUser(as.admin, url, u.id));
    expect(user).toMatchObject({ firstName: "Rgr", lastName: "Again", name: "Rgr Again", mobile: "+971500000000" });

    // {} is accepted as a no-op (pinned: the route has no "at least one field" rule)
    const noop = await as.admin.put(url(`/users/${u.id}/profile`), { data: {} });
    expect(noop.status(), await noop.text()).toBe(200);
    expect((await getUser(as.admin, url, u.id)).user).toMatchObject({ firstName: "Rgr", lastName: "Again", mobile: "+971500000000" });

    // blank optional fields clear to null
    expect((await as.admin.put(url(`/users/${u.id}/profile`), { data: { mobile: "", profileEmail: "  " } })).status()).toBe(200);
    ({ user } = await getUser(as.admin, url, u.id));
    expect(user.mobile).toBeNull();
    expect(user.profileEmail).toBeNull();
  });

  test("profile PUT with an unknown / another org's externalCompanyId is rejected (4xx) and changes nothing", async ({ as, f, url, run, orgB }) => {
    const u = await f.user("distributor");
    const before = (await getUser(as.admin, url, u.id)).user.externalCompanyId;
    const bCo = `${run.prefix}b-co-${randomBytes(3).toString("hex")}`;
    const c = await orgB.post(orgApi(run.orgB.slug, "/external-companies"), { data: { name: bCo, type: "DISTRIBUTOR", country: "UAE", defaultCurrency: "AED" } });
    expect(c.status(), await c.text()).toBe(201); // org-B row: goes with org B at teardown
    const bCoId = ((await (await orgB.get(orgApi(run.orgB.slug, "/external-companies"))).json()) as { companies: { id: string; name: string }[] }).companies.find(
      (x) => x.name === bCo,
    )!.id;
    for (const coId of [GHOST, bCoId]) {
      const r = await as.admin.put(url(`/users/${u.id}/profile`), { data: { externalCompanyId: coId } });
      expect(r.status(), await r.text()).toBeGreaterThanOrEqual(400);
      expect(r.status()).toBeLessThan(500);
    }
    expect((await getUser(as.admin, url, u.id)).user.externalCompanyId).toBe(before);
  });

  // SUSPECTED PRODUCT BUG: the route's first catch branch matches "not found or access denied", which
  // the DAL's "External company not found or access denied" also contains — so an unknown company is
  // reported as 404 {"error":"User not found"} instead of the documented 400.
  test("profile PUT with an unknown externalCompanyId → 400 naming the company (not 404 'User not found')", async ({ as, f, url }) => {
    test.fail(!process.env.RGR_SHOW_KNOWN_BUGS, "KNOWN PRODUCT BUG (see comment above): flips red once fixed — then drop this line");
    const u = await f.user("member");
    const r = await as.admin.put(url(`/users/${u.id}/profile`), { data: { externalCompanyId: GHOST } });
    expect(r.status(), await r.text()).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/external company/i);
  });

  // SUSPECTED PRODUCT BUG: a JSON body that is not an object (e.g. "x", null, 1) reaches `"k" in body`
  // outside any try → unhandled TypeError → empty-body 500.
  test("profile PUT with a non-object JSON body → 400", async ({ as, url, run }) => {
    test.fail(!process.env.RGR_SHOW_KNOWN_BUGS, "KNOWN PRODUCT BUG (see comment above): flips red once fixed — then drop this line");
    for (const data of ["a string", null, 1]) {
      const r = await as.admin.put(url(`/users/${run.users.member.id}/profile`), { data: JSON.stringify(data), headers: { "Content-Type": "application/json" } });
      expect(r.status(), `${JSON.stringify(data)}: ${await r.text()}`).toBe(400);
    }
  });

  // SUSPECTED PRODUCT BUG: profileEmail is stored without any format validation.
  test("profile PUT rejects a malformed profileEmail (400)", async ({ as, f, url }) => {
    test.fail(!process.env.RGR_SHOW_KNOWN_BUGS, "KNOWN PRODUCT BUG (see comment above): flips red once fixed — then drop this line");
    const u = await f.user("member");
    const r = await as.admin.put(url(`/users/${u.id}/profile`), { data: { profileEmail: "not-an-email" } });
    expect(r.status(), await r.text()).toBe(400);
  });

  test("U3 on profile: an external-role user's company can be switched but not cleared", async ({ as, f, url }) => {
    const u = await f.user("distributor"); // the factory gives it a company
    const before = (await getUser(as.admin, url, u.id)).user.externalCompanyId;
    expect(before).toEqual(expect.any(String));
    const clear = await as.admin.put(url(`/users/${u.id}/profile`), { data: { externalCompanyId: null } });
    expect(clear.status(), await clear.text()).toBe(400);
    expect(((await clear.json()) as { error: string }).error).toMatch(/external company is required/i);
    expect((await getUser(as.admin, url, u.id)).user.externalCompanyId).toBe(before);

    const co = await f.externalCompany();
    const sw = await as.admin.put(url(`/users/${u.id}/profile`), { data: { externalCompanyId: co.id } });
    expect(sw.status(), await sw.text()).toBe(200);
    expect((await getUser(as.admin, url, u.id)).user.externalCompanyId).toBe(co.id);
  });

  // SUSPECTED PRODUCT BUG: changeUserRole does not apply U3 — an internal user moved to an external
  // role keeps externalCompanyId = null, which create/profile both forbid.
  test("U3 on role change: moving a company-less user to an external role → 400", async ({ as, f, url, run }) => {
    test.fail(!process.env.RGR_SHOW_KNOWN_BUGS, "KNOWN PRODUCT BUG (see comment above): flips red once fixed — then drop this line");
    const u = await f.user("member");
    const distId = await roleIdIn(as.admin, run.testOrg.slug, ROLE_NAME.distributor);
    const r = await as.admin.patch(url(`/users/${u.id}/role`), { data: { roleId: distId } });
    expect(r.status(), await r.text()).toBe(400);
  });

  test("DELETE removes the user: 204, GET → 404, gone from the list, sign-in refused", async ({ as, f, url, run, ledger, playwright, baseURL }) => {
    const u = await f.user("member");
    const r = await as.admin.delete(url(`/users/${u.id}`));
    expect(r.status(), await r.text()).toBe(204);
    ledger.remove(u.id); // gone; nothing left for teardown
    expect((await as.admin.get(url(`/users/${u.id}`))).status()).toBe(404);
    const l = (await (await as.admin.get(url("/users"))).json()) as { users: { id: string }[] };
    expect(l.users.map((x) => x.id)).not.toContain(u.id);
    const s = await signIn(await fresh(playwright, baseURL), run.testOrg.slug, u.username, runPassword());
    expect(s.status(), await s.text()).toBe(401);
    // a second delete is rejected (no longer in the org)
    const again = await as.admin.delete(url(`/users/${u.id}`));
    expect(again.status()).toBeGreaterThanOrEqual(400);
    expect(again.status()).toBeLessThan(500);
  });

  test("DELETE is refused (400) while the user owns a project; deactivation is the alternative", async ({ as, f, url, run, ledger, playwright, baseURL }) => {
    const u = await f.user("member");
    const ctx = await fresh(playwright, baseURL);
    expect((await signIn(ctx, run.testOrg.slug, u.username, runPassword())).status()).toBe(200);
    const name = `${run.prefix}owned-${randomBytes(3).toString("hex")}`;
    const p = await ctx.post(url("/projects"), { data: { name, currency: "AED", projectLocation: "Dubai, UAE" } });
    expect(p.status(), await p.text()).toBe(201);
    const projectId = ((await p.json()) as { project: { id: string } }).project.id;
    ledger.add({ kind: "project", id: projectId, orgSlug: run.testOrg.slug, label: name }); // drained before the user

    const r = await as.admin.delete(url(`/users/${u.id}`));
    expect(r.status(), await r.text()).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/associated projects or inquiries/i);
    expect((await getUser(as.admin, url, u.id)).user.active).toBe(true);
  });

  test("DELETE / PATCH role on an unknown or another org's user are rejected (4xx) and change nothing", async ({ as, url, run, f, orgB }) => {
    const victim = await foreignUserId({ run, f, orgB, as });
    const memberRole = await roleIdIn(as.admin, run.testOrg.slug, ROLE_NAME.member);
    for (const id of [GHOST, victim]) {
      const del = await as.admin.delete(url(`/users/${id}`));
      expect(del.status(), await del.text()).toBeGreaterThanOrEqual(400);
      expect(del.status()).toBeLessThan(500);
      const role = await as.admin.patch(url(`/users/${id}/role`), { data: { roleId: memberRole } });
      expect(role.status(), await role.text()).toBeGreaterThanOrEqual(400);
      expect(role.status()).toBeLessThan(500);
    }
    // the org-B user is untouched
    const b = await orgB.get(orgApi(run.orgB.slug, `/users/${victim}`));
    expect(b.status(), await b.text()).toBe(200);
    expect(((await b.json()) as { user: UserRow }).user.role.name).toBe(ROLE_NAME.member);
  });

  // SUSPECTED PRODUCT BUG: both routes document 404 for a user not in the org but map the DAL's
  // "User not found or access denied" to 400 (the other [userId] routes return 404).
  test("DELETE / PATCH role on an unknown or foreign user → 404 (as documented)", async ({ as, url, run, f, orgB }) => {
    test.fail(!process.env.RGR_SHOW_KNOWN_BUGS, "KNOWN PRODUCT BUG (see comment above): flips red once fixed — then drop this line");
    const victim = await foreignUserId({ run, f, orgB, as });
    const memberRole = await roleIdIn(as.admin, run.testOrg.slug, ROLE_NAME.member);
    for (const id of [GHOST, victim]) {
      expect((await as.admin.delete(url(`/users/${id}`))).status()).toBe(404);
      expect((await as.admin.patch(url(`/users/${id}/role`), { data: { roleId: memberRole } })).status()).toBe(404);
    }
  });
});
