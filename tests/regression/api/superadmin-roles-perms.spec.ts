/**
 * SuperAdmin roles + role permissions + the permission catalog (Task 11, Step 2), and the org-side
 * POST /api/v1/permissions (the last untested non-SA route).
 *
 * SA role writes go to this run's org B ONLY (cascade-deleted with org B at teardown). Cross-org probes
 * address an org-B role THIS test created together with the Test Org's id as `orgId`: the server must
 * answer 404, and if that tenancy check ever broke, the write would land on the suite's own org-B role.
 *
 * POST /api/v1/permissions creates a GLOBAL catalog row and has no delete route, so only its rejections
 * are exercised (auth, role gate, body validation, duplicate code — all rejected before any write); a
 * successful create is deliberately never sent. The Guarded client refuses that route by design, so these
 * probes use the raw request contexts; each is a request the server must reject.
 */
import { covers } from "../fixtures/covers";
import { Guarded, createAllowance } from "../fixtures/clients";
import { GuardError } from "../fixtures/guard";
import type { RunState } from "../fixtures/run-state";
import { apiUrl } from "../../e2e/helpers";
import { orgApi } from "./project-helpers";
import { runPassword, signIn } from "./sign-in";
import { test, expect, SA, GHOST, tag, rawContext, expectStatus, json, auditLog } from "./sa-helpers";

covers("GET /api/v1/superadmin/permissions");
covers("GET /api/v1/superadmin/roles");
covers("POST /api/v1/superadmin/roles");
covers("PATCH /api/v1/superadmin/roles/[roleId]");
covers("GET /api/v1/superadmin/roles/[roleId]/permissions");
covers("POST /api/v1/superadmin/roles/[roleId]/permissions");
covers("DELETE /api/v1/superadmin/roles/[roleId]/permissions");
covers("POST /api/v1/permissions");

type RoleRow = { id: string; organizationId: string; name: string; description: string | null; isInternalRole: boolean };
type Perm = { id: string; code: string; description: string };
type RolePermRow = { roleId: string; permissionId: string; permission: Perm };

const NOT_IN_ORG = "Role not found or does not belong to the specified organization";

async function catalog(sa: Guarded): Promise<Perm[]> {
  return (await json<{ permissions: Perm[] }>(await sa.get(`${SA}/permissions`))).permissions;
}
async function permId(sa: Guarded, code: string): Promise<string> {
  const p = (await catalog(sa)).find((x) => x.code === code);
  if (!p) throw new Error(`no permission ${code}`);
  return p.id;
}
async function rolesOf(sa: Guarded, orgId: string): Promise<RoleRow[]> {
  return (await json<{ roles: RoleRow[] }>(await sa.get(`${SA}/roles?orgId=${orgId}`))).roles;
}
async function rolePerms(sa: Guarded, roleId: string, orgId: string): Promise<RolePermRow[]> {
  return (await json<{ rolePermissions: RolePermRow[] }>(await sa.get(`${SA}/roles/${roleId}/permissions?orgId=${orgId}`))).rolePermissions;
}
/** SA-create a custom role in org B (rgr- name; cascades with org B). */
async function newOrgBRole(sa: Guarded, run: RunState, what = "sarole"): Promise<RoleRow> {
  return (await json<{ role: RoleRow }>(await sa.post(`${SA}/roles`, { data: { orgId: run.orgB.id, name: `${run.prefix}${what}-${tag()}` } }), 201)).role;
}
/** A client allowed to send the Test Org's id as `orgId` — used ONLY with an org-B role id (cross-org probe). */
const crossOrg = (sa: { ctx: Guarded["ctx"]; token: string }, run: RunState) =>
  new Guarded(sa.ctx, createAllowance([], [run.testOrg.id]), { Cookie: `qs-sa-token=${sa.token}` });

test.describe("GET /api/v1/superadmin/permissions", () => {
  test("the global catalog, A→Z by code, { id, code, description }; identical to the org-side catalog", async ({ sa, as, run }) => {
    const perms = await catalog(sa);
    const codes = perms.map((p) => p.code);
    expect(codes).toEqual([...codes].sort());
    for (const code of ["MANAGE_FEATURES", "MANAGE_PRICING", "MANAGE_USERS"]) expect(codes).toContain(code);
    for (const p of perms) expect(Object.keys(p).sort()).toEqual(["code", "description", "id"]);
    const org = (await json<{ permissions: Perm[] }>(await as.admin.get(apiUrl(run.testOrg.slug, "/api/v1/permissions")))).permissions;
    expect(org.map((p) => p.id).sort()).toEqual(perms.map((p) => p.id).sort());
  });
});

test.describe("SuperAdmin roles (org B)", () => {
  test("GET: 400 without orgId, 404 unknown org; org B's default roles A→Z with the internal flag; disjoint from the Test Org's", async ({ sa, run }) => {
    expect((await json<{ error: string }>(await sa.get(`${SA}/roles`), 400)).error).toBe("orgId query parameter is required");
    expect((await json<{ error: string }>(await sa.get(`${SA}/roles?orgId=${GHOST}`), 404)).error).toBe("Organization not found");
    const roles = await rolesOf(sa, run.orgB.id);
    const names = roles.map((r) => r.name);
    expect(names).toEqual([...names].sort());
    const flags = Object.fromEntries(roles.map((r) => [r.name, r.isInternalRole]));
    expect(flags).toMatchObject({ Admin: true, "Company Member": true, Distributor: false, "Architectural Firm": false });
    for (const r of roles) expect(r.organizationId).toBe(run.orgB.id);
    const testIds = new Set((await rolesOf(sa, run.testOrg.id)).map((r) => r.id));
    expect(roles.filter((r) => testIds.has(r.id))).toEqual([]);
  });

  test("POST creates an external (non-internal) role: name / description trimmed, blank description → null; audit role.create", async ({ sa, run }) => {
    const name = `${run.prefix}sarole-${tag()}`;
    const r = await json<{ role: RoleRow }>(await sa.post(`${SA}/roles`, { data: { orgId: run.orgB.id, name: `  ${name} `, description: "  custom  " } }), 201);
    expect(r.role).toEqual({ id: expect.any(String), organizationId: run.orgB.id, name, description: "custom", isInternalRole: false });
    const r2 = await json<{ role: RoleRow }>(await sa.post(`${SA}/roles`, { data: { orgId: run.orgB.id, name: `${name}-2`, description: "   " } }), 201);
    expect(r2.role.description).toBeNull();
    expect((await rolesOf(sa, run.orgB.id)).filter((x) => x.name.startsWith(name)).map((x) => x.name)).toEqual([name, `${name}-2`]);
    const log = await auditLog(sa, { scope: "org", orgId: run.orgB.id, item: "Role", verb: "INSERT", pageSize: 100 });
    expect(log.entries.find((e) => e.targetId === r.role.id)).toMatchObject({ action: "role.create", entity: name });
  });

  test("POST rules: missing / blank name, missing orgId → 400; unknown org → 404", async ({ sa, run }) => {
    expect((await json<{ error: string }>(await sa.post(`${SA}/roles`, { data: { orgId: run.orgB.id } }), 400)).error).toBe("orgId and name are required");
    expect((await json<{ error: string }>(await sa.post(`${SA}/roles`, { data: { orgId: run.orgB.id, name: 7 } }), 400)).error).toBe("orgId and name are required");
    expect((await json<{ error: string }>(await sa.post(`${SA}/roles`, { data: { orgId: run.orgB.id, name: "   " } }), 400)).error).toBe("name is required");
    // no orgId at all: the guard cannot attribute it to an org, so this one rejection goes out on the raw context
    const raw = await sa.ctx.post(`${SA}/roles`, { data: { name: `${run.prefix}noorg` }, headers: { Cookie: `qs-sa-token=${sa.token}` } });
    expect((await json<{ error: string }>(raw, 400)).error).toBe("orgId and name are required");
    const ghost = new Guarded(sa.ctx, createAllowance([], [GHOST]), { Cookie: `qs-sa-token=${sa.token}` });
    expect((await json<{ error: string }>(await ghost.post(`${SA}/roles`, { data: { orgId: GHOST, name: `${run.prefix}ghost` } }), 404)).error).toBe("Organization not found");
    // a non-JSON body carries no orgId: the guard refuses it before sending, so the raw context sends it
    expect(() => sa.post(`${SA}/roles`, { data: Buffer.from("{not json") })).toThrow(GuardError);
    const nj = await sa.ctx.post(`${SA}/roles`, { data: Buffer.from("{not json"), headers: { "Content-Type": "application/json", Cookie: `qs-sa-token=${sa.token}` } });
    expect((await json<{ error: string }>(nj, 400)).error).toBe("Invalid JSON body");
    // nothing was created (by name — other workers add org-B roles concurrently, so counts are not stable)
    expect((await rolesOf(sa, run.orgB.id)).filter((r) => [`${run.prefix}noorg`, `${run.prefix}ghost`, "", " "].includes(r.name))).toEqual([]);
  });

  // Stage 31 S31-10: POST/PATCH roles map the (organizationId, name) unique violation (P2002) to 409 with a
  // fixed text (was a 500, backlog). Nothing is written.
  test("a duplicate role name in the org answers 409 (fixed text), on create and on rename", async ({ sa, run }) => {
    const dup = { error: "A role with this name already exists" };
    expect(await json<{ error: string }>(await sa.post(`${SA}/roles`, { data: { orgId: run.orgB.id, name: "Admin" } }), 409)).toEqual(dup);
    const mine = await newOrgBRole(sa, run);
    expect(await json<{ error: string }>(await sa.patch(`${SA}/roles/${mine.id}`, { data: { orgId: run.orgB.id, name: "Admin" } }), 409)).toEqual(dup);
    const after = await rolesOf(sa, run.orgB.id);
    expect(after.filter((r) => r.name === "Admin")).toHaveLength(1); // no second "Admin"
    expect(after.find((r) => r.id === mine.id)?.name).toBe(mine.name); // the rename did not apply
  });

  test("PATCH renames (trimmed) → 200 { role }; rules 400; unknown role / another org's id → 404; audit role.rename", async ({ sa, run }) => {
    const mine = await newOrgBRole(sa, run);
    const newName = `${mine.name}-renamed`;
    const r = await json<{ role: RoleRow }>(await sa.patch(`${SA}/roles/${mine.id}`, { data: { orgId: run.orgB.id, name: `  ${newName}  ` } }));
    expect(r.role).toEqual({ ...mine, name: newName });
    expect((await json<{ error: string }>(await sa.patch(`${SA}/roles/${mine.id}`, { data: { orgId: run.orgB.id, name: " " } }), 400)).error).toBe("name is required");
    expect((await json<{ error: string }>(await sa.patch(`${SA}/roles/${mine.id}`, { data: { orgId: run.orgB.id } }), 400)).error).toBe("orgId and name are required");
    expect((await json<{ error: string }>(await sa.patch(`${SA}/roles/${GHOST}`, { data: { orgId: run.orgB.id, name: `${run.prefix}x` } }), 404)).error).toBe(NOT_IN_ORG);
    // cross-org: org B's role addressed with the Test Org's id
    expect((await json<{ error: string }>(await crossOrg(sa, run).patch(`${SA}/roles/${mine.id}`, { data: { orgId: run.testOrg.id, name: `${run.prefix}hijack` } }), 404)).error).toBe(NOT_IN_ORG);
    expect((await rolesOf(sa, run.orgB.id)).find((x) => x.id === mine.id)?.name).toBe(newName);
    const log = await auditLog(sa, { scope: "org", orgId: run.orgB.id, item: "Role", verb: "UPDATE", pageSize: 100 });
    const rows = log.entries.filter((e) => e.targetId === mine.id && e.action === "role.rename");
    expect(rows).toHaveLength(1);
    expect(rows[0].entity).toBe(newName);
  });
});

test.describe("SuperAdmin role permissions (org B)", () => {
  test("GET: a new role has none; Admin holds the management permissions, A→Z by code; orgId required; another org → 404", async ({ sa, run }) => {
    const mine = await newOrgBRole(sa, run);
    expect(await rolePerms(sa, mine.id, run.orgB.id)).toEqual([]);
    const admin = (await rolesOf(sa, run.orgB.id)).find((r) => r.name === "Admin")!;
    const perms = await rolePerms(sa, admin.id, run.orgB.id);
    const codes = perms.map((p) => p.permission.code);
    expect(codes).toEqual([...codes].sort());
    for (const c of ["MANAGE_FEATURES", "MANAGE_PRICING", "MANAGE_USERS"]) expect(codes).toContain(c);
    for (const p of perms) expect(p.roleId).toBe(admin.id);
    expect((await json<{ error: string }>(await sa.get(`${SA}/roles/${mine.id}/permissions`), 400)).error).toBe("orgId query parameter is required");
    expect((await json<{ error: string }>(await sa.get(`${SA}/roles/${mine.id}/permissions?orgId=${run.testOrg.id}`), 404)).error).toBe(NOT_IN_ORG);
  });

  test("grant (201, idempotent) and revoke (200, idempotent) toggle exactly that permission; rules 400/404; audit assign/revoke", async ({ sa, run }) => {
    const mine = await newOrgBRole(sa, run);
    const pid = await permId(sa, "MANAGE_PRICING");
    const url = `${SA}/roles/${mine.id}/permissions`;
    for (let i = 0; i < 2; i++) expect(await json(await sa.post(url, { data: { orgId: run.orgB.id, permissionId: pid } }), 201)).toEqual({ success: true });
    expect((await rolePerms(sa, mine.id, run.orgB.id)).map((p) => p.permission.code)).toEqual(["MANAGE_PRICING"]);

    for (const [what, data] of [["no permissionId", { orgId: run.orgB.id }], ["blank permissionId", { orgId: run.orgB.id, permissionId: "  " }]] as const) {
      const r = await sa.post(url, { data });
      expect((await json<{ error: string }>(r, 400, what)).error).toMatch(/permissionId (is )?required|orgId and permissionId are required/);
    }
    await expectStatus(await sa.post(`${SA}/roles/${GHOST}/permissions`, { data: { orgId: run.orgB.id, permissionId: pid } }), 404, "unknown role");
    const cross = crossOrg(sa, run);
    expect((await json<{ error: string }>(await cross.post(url, { data: { orgId: run.testOrg.id, permissionId: await permId(sa, "MANAGE_USERS") } }), 404)).error).toBe(NOT_IN_ORG);
    expect((await json<{ error: string }>(await cross.delete(url, { data: { orgId: run.testOrg.id, permissionId: pid } }), 404)).error).toBe(NOT_IN_ORG);
    expect((await rolePerms(sa, mine.id, run.orgB.id)).map((p) => p.permission.code)).toEqual(["MANAGE_PRICING"]); // the rejects changed nothing

    for (let i = 0; i < 2; i++) expect(await json(await sa.delete(url, { data: { orgId: run.orgB.id, permissionId: pid } }))).toEqual({ success: true });
    expect(await rolePerms(sa, mine.id, run.orgB.id)).toEqual([]);
    expect((await json<{ error: string }>(await sa.delete(url, { data: { orgId: run.orgB.id } }), 400)).error).toBe("orgId and permissionId are required");

    const log = await auditLog(sa, { scope: "org", orgId: run.orgB.id, item: "Role", pageSize: 100 });
    const actions = log.entries.filter((e) => e.targetId === mine.id).map((e) => e.action);
    expect(actions.filter((a) => a === "permission.assign")).toHaveLength(2); // every accepted call is audited
    expect(actions.filter((a) => a === "permission.revoke")).toHaveLength(2);
  });

  // Stage 31 S31-10: granting an id that is not in the permission catalog hits the RolePermission FK (P2003),
  // which now maps to 400 (was a 500, backlog). Nothing is written.
  test("granting an unknown permissionId answers 400 (Unknown permissionId)", async ({ sa, run }) => {
    const mine = await newOrgBRole(sa, run);
    expect(await json<{ error: string }>(await sa.post(`${SA}/roles/${mine.id}/permissions`, { data: { orgId: run.orgB.id, permissionId: GHOST } }), 400)).toEqual({ error: "Unknown permissionId" });
    expect(await rolePerms(sa, mine.id, run.orgB.id)).toEqual([]);
  });

  test("effect: a user holding the custom role gains / loses MANAGE_USERS access as the SuperAdmin toggles it", async ({ sa, run, ledger, orgB, playwright, baseURL }) => {
    test.setTimeout(180_000); // sign-ins retry on 429 (rate limit 3 / 10 s / IP, shared by all workers)
    const mine = await newOrgBRole(sa, run);
    // custom roles are external (isInternalRole false) → U3: the user needs an org-B external company
    const coName = `${run.prefix}saco-${tag()}`;
    await expectStatus(await orgB.post(orgApi(run.orgB.slug, "/external-companies"), { data: { name: coName, type: "DISTRIBUTOR", country: "UAE", defaultCurrency: "AED" } }), 201);
    const co = (await json<{ companies: { id: string; name: string }[] }>(await orgB.get(orgApi(run.orgB.slug, "/external-companies")))).companies.find((c) => c.name === coName)!;
    const username = `${run.prefix}sap-${tag()}`;
    const u = await sa.post(`${SA}/orgs/${run.orgB.id}/users`, { data: { firstName: "Rgr", lastName: "Perm", username, roleId: mine.id, externalCompanyId: co.id, password: runPassword() } });
    const text = await u.text();
    if (u.status() === 201) ledger.add({ kind: "user", id: (JSON.parse(text) as { user: { id: string } }).user.id, orgSlug: run.orgB.slug, label: username });
    expect(u.status(), text).toBe(201);

    const ctx = await rawContext(playwright, baseURL);
    try {
      expect((await signIn(ctx, run.orgB.slug, username, runPassword())).status()).toBe(200);
      const users = () => ctx.get(orgApi(run.orgB.slug, "/users"));
      expect((await users()).status()).toBe(403);
      const body = { orgId: run.orgB.id, permissionId: await permId(sa, "MANAGE_USERS") };
      await expectStatus(await sa.post(`${SA}/roles/${mine.id}/permissions`, { data: body }), 201);
      expect((await users()).status()).toBe(200);
      await expectStatus(await sa.delete(`${SA}/roles/${mine.id}/permissions`, { data: body }), 200);
      expect((await users()).status()).toBe(403);
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe("POST /api/v1/permissions (org route; rejections only — a create would leave an undeletable global row)", () => {
  const url = (run: RunState) => apiUrl(run.testOrg.slug, "/api/v1/permissions");

  test("401 without a session; 403 for every role without MANAGE_FEATURES", async ({ anon, as, run }) => {
    // an EXISTING code: even if the auth / role gate regressed, the create could only hit the unique
    // constraint (409) — it can never add a row to the undeletable global catalog
    const data = { code: "manage_features", description: "rgr gate probe" };
    expect((await anon.ctx.post(url(run), { data })).status()).toBe(401);
    for (const role of ["member", "distributor", "architect"] as const) {
      const r = await as[role].ctx.post(url(run), { data });
      expect(r.status(), `${role}: ${await r.text()}`).toBe(403);
    }
  });

  test("admin: malformed JSON / missing code / missing description → 400; an existing code (case-folded) → 409; the catalog is unchanged", async ({ as, sa, run }) => {
    const before = (await catalog(sa)).map((p) => p.code);
    const post = (data: unknown, headers?: Record<string, string>) => as.admin.ctx.post(url(run), { data, headers });
    expect((await json<{ error: string }>(await post(Buffer.from("{not json"), { "Content-Type": "application/json" }), 400)).error).toBe("Request body must be valid JSON");
    expect((await json<{ error: string }>(await post({ description: "rgr" }), 400)).error).toBe("code is required");
    expect((await json<{ error: string }>(await post({ code: "   ", description: "rgr" }), 400)).error).toBe("code is required");
    expect((await json<{ error: string }>(await post({ code: "manage_features" }) /* existing code: a broken description rule could only 409 */, 400)).error).toBe("description is required");
    expect((await json<{ error: string }>(await post({ code: "  manage_features ", description: "rgr duplicate probe" }), 409)).error).toBe('Permission code "MANAGE_FEATURES" already exists');
    expect((await catalog(sa)).map((p) => p.code)).toEqual(before);
  });
});
