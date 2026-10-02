/**
 * Org roles + role permissions: roles (list/create), roles/[roleId] (get), roles/[roleId]/permissions
 * (list/grant/revoke).
 *
 * Gates (route source): GET /roles → MANAGE_USERS or MANAGE_FEATURES; everything else MANAGE_FEATURES.
 *
 * Mutations happen ONLY in this run's throwaway org B: custom roles cannot be ledgered (no deleter), and
 * granting/revoking on the shared Test Org's default roles would race every other spec's 403
 * expectations. Org B (ledgered as kind `org`) is hard-deleted at teardown with everything in it; the
 * one org-B user this file creates is also ledgered (kind user) so it goes even earlier.
 *
 * KNOWN PRODUCT BUGS are written to the correct expectation inside `test.fail()` tests (see users.spec.ts).
 */
import { randomBytes } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "../fixtures/test";
import { covers } from "../fixtures/covers";
import type { Guarded } from "../fixtures/clients";
import { registerNegatives, GHOST, type Ctx } from "./api-matrix";
import { ROLES, ROLE_NAME, ROLE_PERMISSIONS, type PermissionCode } from "./permissions";
import { apiUrl } from "../../e2e/helpers";
import { bypass, runPassword, signIn } from "./sign-in";

covers("GET /api/v1/orgs/[orgSlug]/roles");
covers("POST /api/v1/orgs/[orgSlug]/roles");
covers("GET /api/v1/orgs/[orgSlug]/roles/[roleId]");
covers("GET /api/v1/orgs/[orgSlug]/roles/[roleId]/permissions");
covers("POST /api/v1/orgs/[orgSlug]/roles/[roleId]/permissions");
covers("DELETE /api/v1/orgs/[orgSlug]/roles/[roleId]/permissions");

type RoleRow = { id: string; organizationId: string; name: string; description: string | null; isInternalRole: boolean };
type RolePermRow = { roleId: string; permissionId: string; permission: { id: string; code: string; description: string } };

const orgApi = (slug: string, p: string) => apiUrl(slug, `/api/v1/orgs/${slug}${p}`);
const tag = () => randomBytes(3).toString("hex");

async function rolesOf(g: Guarded, slug: string): Promise<RoleRow[]> {
  const r = await g.get(orgApi(slug, "/roles"));
  expect(r.status(), await r.text()).toBe(200);
  return ((await r.json()) as { roles: RoleRow[] }).roles;
}
async function roleId(g: Guarded, slug: string, name: string): Promise<string> {
  const id = (await rolesOf(g, slug)).find((x) => x.name === name)?.id;
  if (!id) throw new Error(`org ${slug} has no role "${name}"`);
  return id;
}

/** Permission id by code (global catalog; MANAGE_FEATURES holder). */
async function permissionId(g: Guarded, slug: string, code: PermissionCode): Promise<string> {
  const r = await g.get(apiUrl(slug, "/api/v1/permissions"));
  expect(r.status(), await r.text()).toBe(200);
  const id = ((await r.json()) as { permissions: { id: string; code: string }[] }).permissions.find((p) => p.code === code)?.id;
  if (!id) throw new Error(`no permission ${code}`);
  return id;
}

async function rolePerms(g: Guarded, slug: string, id: string): Promise<RolePermRow[]> {
  const r = await g.get(orgApi(slug, `/roles/${id}/permissions`));
  expect(r.status(), await r.text()).toBe(200);
  return ((await r.json()) as { rolePermissions: RolePermRow[] }).rolePermissions;
}

/** Create an org-B custom role (rgr- name). Lives until org B's teardown hard-delete. */
async function orgBRole(orgB: Guarded, run: Ctx["run"], what = "role"): Promise<RoleRow> {
  const name = `${run.prefix}${what}-${tag()}`;
  const r = await orgB.post(orgApi(run.orgB.slug, "/roles"), { data: { name } });
  expect(r.status(), await r.text()).toBe(201);
  return ((await r.json()) as { role: RoleRow }).role;
}

/** One org-B custom role per worker for foreign-id probes (a leaked gate could only touch it). */
let foreignRole: Promise<string> | undefined;
const foreignRoleId = (c: Ctx) => (foreignRole ??= orgBRole(c.orgB, c.run, "foreign-role").then((r) => r.id));

const designPermBody = async (c: Ctx) => ({ permissionId: await permissionId(c.as.admin, c.run.testOrg.slug, "DESIGN") });

registerNegatives([
  // either permission suffices (route: MANAGE_USERS first, then MANAGE_FEATURES)
  { key: "GET /api/v1/orgs/[orgSlug]/roles", method: "GET", path: () => "/roles", permission: ["MANAGE_USERS", "MANAGE_FEATURES"] },
  {
    key: "POST /api/v1/orgs/[orgSlug]/roles",
    method: "POST",
    path: () => "/roles",
    permission: "MANAGE_FEATURES",
    body: () => ({}), // no name → a leaked gate still could not create a role in the Test Org
    invalid: [
      { name: "{} (name required)", body: {}, status: 400 },
      { name: "blank name", body: { name: "   " }, status: 400 },
      { name: "non-string name", body: { name: 42 }, status: 400 },
    ],
  },
  {
    key: "GET /api/v1/orgs/[orgSlug]/roles/[roleId]",
    method: "GET",
    path: async (c) => `/roles/${await roleId(c.as.admin, c.run.testOrg.slug, ROLE_NAME.member)}`,
    permission: "MANAGE_FEATURES",
    unknownId: () => `/roles/${GHOST}`,
    foreignId: async (c) => `/roles/${await foreignRoleId(c)}`,
  },
  {
    key: "GET /api/v1/orgs/[orgSlug]/roles/[roleId]/permissions",
    method: "GET",
    path: async (c) => `/roles/${await roleId(c.as.admin, c.run.testOrg.slug, ROLE_NAME.member)}/permissions`,
    permission: "MANAGE_FEATURES",
    unknownId: () => `/roles/${GHOST}/permissions`,
    foreignId: async (c) => `/roles/${await foreignRoleId(c)}/permissions`,
  },
  {
    key: "POST /api/v1/orgs/[orgSlug]/roles/[roleId]/permissions",
    method: "POST",
    path: () => `/roles/${GHOST}/permissions`, // never a live role: a leaked gate grants nothing
    permission: "MANAGE_FEATURES",
    body: designPermBody, // valid, so unknown/foreign role ids reach the lookup
    unknownId: () => `/roles/${GHOST}/permissions`,
    foreignId: async (c) => `/roles/${await foreignRoleId(c)}/permissions`,
    invalid: [
      { name: "{} (permissionId required)", body: {}, status: 400 },
      { name: "empty permissionId", body: { permissionId: "" }, status: 400 },
      { name: "non-string permissionId", body: { permissionId: 7 }, status: 400 },
    ],
  },
  {
    key: "DELETE /api/v1/orgs/[orgSlug]/roles/[roleId]/permissions",
    method: "DELETE",
    path: () => `/roles/${GHOST}/permissions`,
    permission: "MANAGE_FEATURES",
    body: designPermBody,
    malformedJson: true, // this DELETE reads a JSON body
    unknownId: () => `/roles/${GHOST}/permissions`,
    foreignId: async (c) => `/roles/${await foreignRoleId(c)}/permissions`,
    invalid: [
      { name: "{} (permissionId required)", body: {}, status: 400 },
      { name: "empty permissionId", body: { permissionId: "" }, status: 400 },
    ],
  },
]);

test.describe("roles: reads", () => {
  test("GET /roles: the org's roles A→Z incl. the four defaults with their U3 internal flag; org-scoped", async ({ as, run }) => {
    const roles = await rolesOf(as.admin, run.testOrg.slug);
    for (const r of roles) expect(r.organizationId).toBe(run.testOrg.id);
    const names = roles.map((r) => r.name);
    // A→Z (DB collation): the four defaults appear in alphabetical order relative to each other
    const defaults = names.filter((n) => (Object.values(ROLE_NAME) as string[]).includes(n));
    expect(defaults).toEqual([ROLE_NAME.admin, ROLE_NAME.architect, ROLE_NAME.member, ROLE_NAME.distributor]);
    const byName = new Map(roles.map((r) => [r.name, r]));
    for (const role of ROLES) expect(byName.has(ROLE_NAME[role]), ROLE_NAME[role]).toBe(true);
    expect(byName.get(ROLE_NAME.admin)!.isInternalRole).toBe(true);
    expect(byName.get(ROLE_NAME.member)!.isInternalRole).toBe(true);
    expect(byName.get(ROLE_NAME.distributor)!.isInternalRole).toBe(false);
    expect(byName.get(ROLE_NAME.architect)!.isInternalRole).toBe(false);
  });

  test("GET /roles/[roleId] + its permissions: each default role holds exactly its default grants", async ({ as, run }) => {
    const slug = run.testOrg.slug;
    for (const role of ROLES) {
      const id = await roleId(as.admin, slug, ROLE_NAME[role]);
      const r = await as.admin.get(orgApi(slug, `/roles/${id}`));
      expect(r.status(), await r.text()).toBe(200);
      expect(((await r.json()) as { role: RoleRow }).role).toMatchObject({ id, name: ROLE_NAME[role], organizationId: run.testOrg.id });
      const perms = await rolePerms(as.admin, slug, id);
      for (const p of perms) {
        expect(p.permissionId).toBe(p.permission.id);
        expect(Object.keys(p.permission).sort()).toEqual(["code", "description", "id"]);
      }
      const codes = perms.map((p) => p.permission.code);
      expect(codes).toEqual([...codes].sort()); // A→Z by code
      expect([...codes].sort()).toEqual([...ROLE_PERMISSIONS[role]].sort());
    }
  });
});

test.describe("roles: mutations (org B only)", () => {
  const contexts: APIRequestContext[] = [];
  test.afterEach(async () => {
    while (contexts.length) await contexts.pop()!.dispose();
  });

  test("POST /roles creates an org-scoped, non-internal custom role with no permissions", async ({ orgB, as, run }) => {
    const slug = run.orgB.slug;
    const name = `${run.prefix}role-${tag()}`;
    const r = await orgB.post(orgApi(slug, "/roles"), { data: { name: `  ${name} `, description: "  rgr custom role  " } });
    expect(r.status(), await r.text()).toBe(201);
    const role = ((await r.json()) as { role: RoleRow }).role;
    expect(role).toMatchObject({ name, description: "rgr custom role", organizationId: run.orgB.id, isInternalRole: false });

    expect((await rolesOf(orgB, slug)).map((x) => x.id)).toContain(role.id);
    const g = await orgB.get(orgApi(slug, `/roles/${role.id}`));
    expect(g.status()).toBe(200);
    expect(((await g.json()) as { role: RoleRow }).role).toMatchObject({ id: role.id, name });
    expect(await rolePerms(orgB, slug, role.id)).toEqual([]);

    // a blank description is stored as null
    const r2 = await orgB.post(orgApi(slug, "/roles"), { data: { name: `${run.prefix}role-${tag()}`, description: "  " } });
    expect(r2.status(), await r2.text()).toBe(201);
    expect(((await r2.json()) as { role: RoleRow }).role.description).toBeNull();

    // invisible to the Test Org
    expect((await rolesOf(as.admin, run.testOrg.slug)).map((x) => x.id)).not.toContain(role.id);
  });

  // SUSPECTED PRODUCT BUG: Role has @@unique([organizationId, name]) but createRole's P2002 is not mapped
  // — a duplicate name returns 500 instead of a 409.
  test("POST /roles with a name already used in the org → 409", async ({ orgB, run }) => {
    test.fail(!process.env.RGR_SHOW_KNOWN_BUGS, "KNOWN PRODUCT BUG (see comment above): flips red once fixed — then drop this line");
    const role = await orgBRole(orgB, run);
    const r = await orgB.post(orgApi(run.orgB.slug, "/roles"), { data: { name: role.name } });
    expect(r.status(), await r.text()).toBe(409);
  });

  test("permission grant → a live session gains access immediately; revoke → loses it", async ({ orgB, run, ledger, playwright, baseURL }) => {
    const slug = run.orgB.slug;
    const role = await orgBRole(orgB, run);
    // custom roles are external (isInternalRole false) → U3: the user needs a company. The company lives
    // in org B and goes with it at teardown (no org-B admin session exists for the org-API deleter).
    const coName = `${run.prefix}b-co-${tag()}`;
    const c = await orgB.post(orgApi(slug, "/external-companies"), { data: { name: coName, type: "DISTRIBUTOR", country: "UAE", defaultCurrency: "AED" } });
    expect(c.status(), await c.text()).toBe(201);
    const coId = ((await (await orgB.get(orgApi(slug, "/external-companies"))).json()) as { companies: { id: string; name: string }[] }).companies.find(
      (x) => x.name === coName,
    )!.id;
    const username = `${run.prefix}b-perm-${tag()}`;
    const u = await orgB.post(orgApi(slug, "/users"), {
      data: { username, firstName: "RGR", lastName: "Perm", password: runPassword(), roleId: role.id, externalCompanyId: coId },
    });
    expect(u.status(), await u.text()).toBe(201);
    const userId = ((await (await orgB.get(orgApi(slug, "/users"))).json()) as { users: { id: string; username: string }[] }).users.find(
      (x) => x.username === username,
    )!.id;
    ledger.add({ kind: "user", id: userId, orgSlug: slug, label: username });

    const sess = await playwright.request.newContext({ baseURL, extraHTTPHeaders: bypass() });
    contexts.push(sess);
    const login = await signIn(sess, slug, username, runPassword());
    expect(login.status(), await login.text()).toBe(200);
    expect((await sess.get(orgApi(slug, "/users"))).status()).toBe(403);
    expect((await sess.get(orgApi(slug, "/roles"))).status()).toBe(403);

    const manageUsers = await permissionId(orgB, slug, "MANAGE_USERS");
    const grant = await orgB.post(orgApi(slug, `/roles/${role.id}/permissions`), { data: { permissionId: manageUsers } });
    expect(grant.status(), await grant.text()).toBe(201);
    expect(await grant.json()).toEqual({ success: true });
    // idempotent: granting again is a 201 no-op, still exactly one row
    expect((await orgB.post(orgApi(slug, `/roles/${role.id}/permissions`), { data: { permissionId: manageUsers } })).status()).toBe(201);
    expect((await rolePerms(orgB, slug, role.id)).map((p) => p.permission.code)).toEqual(["MANAGE_USERS"]);

    // the held session gains it on its very next request
    expect((await sess.get(orgApi(slug, "/users"))).status()).toBe(200);
    expect((await sess.get(orgApi(slug, "/roles"))).status()).toBe(200); // GET /roles accepts MANAGE_USERS…
    expect((await sess.get(orgApi(slug, `/roles/${role.id}`))).status()).toBe(403); // …the rest need MANAGE_FEATURES
    const me = (await (await sess.get(orgApi(slug, "/me"))).json()) as { permissionCodes: string[] };
    expect(me.permissionCodes).toEqual(["MANAGE_USERS"]);

    const revoke = await orgB.delete(orgApi(slug, `/roles/${role.id}/permissions`), { data: { permissionId: manageUsers } });
    expect(revoke.status(), await revoke.text()).toBe(200);
    expect(await revoke.json()).toEqual({ success: true });
    expect(await rolePerms(orgB, slug, role.id)).toEqual([]);
    expect((await sess.get(orgApi(slug, "/users"))).status()).toBe(403);
    expect((await sess.get(orgApi(slug, "/roles"))).status()).toBe(403);
  });

  test("revoking a permission the role does not hold → 404, nothing changes", async ({ orgB, run }) => {
    const slug = run.orgB.slug;
    const role = await orgBRole(orgB, run);
    const r = await orgB.delete(orgApi(slug, `/roles/${role.id}/permissions`), { data: { permissionId: await permissionId(orgB, slug, "QUOTE") } });
    expect(r.status(), await r.text()).toBe(404);
    expect(await rolePerms(orgB, slug, role.id)).toEqual([]);
  });

  // SUSPECTED PRODUCT BUG: the 404 above echoes the raw Prisma error ("Invalid `prisma.rolePermission
  // .delete()` invocation: …") to the client — internals leak through err.message.
  test("revoking a permission the role does not hold → a 404 that does not leak ORM internals", async ({ orgB, run }) => {
    test.fail(!process.env.RGR_SHOW_KNOWN_BUGS, "KNOWN PRODUCT BUG (see comment above): flips red once fixed — then drop this line");
    const slug = run.orgB.slug;
    const role = await orgBRole(orgB, run);
    const r = await orgB.delete(orgApi(slug, `/roles/${role.id}/permissions`), { data: { permissionId: await permissionId(orgB, slug, "QUOTE") } });
    expect(r.status()).toBe(404);
    expect(await r.text()).not.toMatch(/prisma|invocation/i);
  });

  // SUSPECTED PRODUCT BUG: addRolePermission upserts without checking the permission exists — the FK
  // violation surfaces as a 500 instead of a 400/404. (The request writes nothing either way.)
  test("granting an unknown permission id → 404, nothing granted", async ({ orgB, run }) => {
    test.fail(!process.env.RGR_SHOW_KNOWN_BUGS, "KNOWN PRODUCT BUG (see comment above): flips red once fixed — then drop this line");
    const slug = run.orgB.slug;
    const role = await orgBRole(orgB, run);
    const r = await orgB.post(orgApi(slug, `/roles/${role.id}/permissions`), { data: { permissionId: GHOST } });
    expect(r.status(), await r.text()).toBe(404);
    expect(await rolePerms(orgB, slug, role.id)).toEqual([]);
  });

  test("granting an unknown permission id is rejected (non-2xx) and grants nothing", async ({ orgB, run }) => {
    const slug = run.orgB.slug;
    const role = await orgBRole(orgB, run);
    const r = await orgB.post(orgApi(slug, `/roles/${role.id}/permissions`), { data: { permissionId: GHOST } });
    expect(r.ok(), `HTTP ${r.status()} ${await r.text()}`).toBe(false);
    expect(await rolePerms(orgB, slug, role.id)).toEqual([]);
  });

  // The product has NO system-role immutability: an org admin with MANAGE_FEATURES may change a default
  // role's grants (no isSystem flag exists; no route guard). Pinned on org B's own default role, and the
  // grant is restored in `finally` even if an assertion fails.
  test("default roles are not immutable: an org admin can revoke and re-grant a default role's permission (pinned)", async ({ orgB, run }) => {
    const slug = run.orgB.slug;
    const arch = await roleId(orgB, slug, ROLE_NAME.architect);
    const design = await permissionId(orgB, slug, "DESIGN");
    expect((await rolePerms(orgB, slug, arch)).map((p) => p.permission.code)).toEqual(["DESIGN"]);
    try {
      const del = await orgB.delete(orgApi(slug, `/roles/${arch}/permissions`), { data: { permissionId: design } });
      expect(del.status(), await del.text()).toBe(200);
      expect(await rolePerms(orgB, slug, arch)).toEqual([]);
    } finally {
      const back = await orgB.post(orgApi(slug, `/roles/${arch}/permissions`), { data: { permissionId: design } });
      expect(back.status(), `restore DESIGN on org B's ${ROLE_NAME.architect}: ${await back.text()}`).toBe(201);
    }
    expect((await rolePerms(orgB, slug, arch)).map((p) => p.permission.code)).toEqual(["DESIGN"]);
  });
});
