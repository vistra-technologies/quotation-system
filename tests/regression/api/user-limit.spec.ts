/**
 * Per-org user limit (Stage 29, S29-7 / S29-8): `Organization.userLimit` is a hard cap on User rows (active or
 * deactivated) enforced by one shared helper (lib/data/user-limit.ts) on BOTH creation paths — the org-admin
 * `POST /api/v1/orgs/[orgSlug]/users` and the SuperAdmin `POST /api/v1/superadmin/orgs/[orgId]/users`.
 *
 * Everything runs on ONE throwaway org (`rgr-<runId>-l…`, created here with an explicit limit, ledgered kind org,
 * hard-deleted at teardown with its users). The Test Org and org B are never touched by this file, so no
 * shared limit is changed and nothing needs restoring (the Test Org's own limit is raised/restored by
 * global-setup / global-teardown, fixtures/test-org-limit.ts).
 *
 * Serial story: explicit-limit create → seats in both GETs → fill to the cap → 409 on both paths (exact body) →
 * a deactivated user still counts → deleting a user frees a seat → lowering below usage is allowed and blocks
 * only new adds, with an audit row → concurrent adds at limit-1 yield exactly one 201 and one 409.
 */
import { Guarded, createAllowance, type SaClient } from "../fixtures/clients";
import { orgApi } from "./project-helpers";
import { runPassword, signIn } from "./sign-in";
import { test, expect, SA, rawContext, expectStatus, json, auditLog, listOrgs, createThrowawayOrg, tag } from "./sa-helpers";

type UserRow = { id: string; username: string; active: boolean; role: { name: string } };
type Seats = { limit: number; used: number };

const LIMIT_BODY = (limit: number, current: number) => ({
  error: `User limit reached (${current}/${limit})`,
  code: "USER_LIMIT_REACHED",
  limit,
  current,
});

test.describe("organization user limit", () => {
  test.describe.configure({ mode: "serial" });
  test.describe.configure({ timeout: 180_000 }); // the org admin's sign-in retries on 429 (3 / 10 s / IP, shared by all workers)

  let org: { id: string; slug: string; name: string };
  let admin: Guarded;
  let adminCtx: Awaited<ReturnType<typeof rawContext>>;
  let memberRoleId = "";

  const saUsers = async (sa: SaClient) => json<{ users: UserRow[]; seats: Seats }>(await sa.get(`${SA}/orgs/${org.id}/users`));
  const orgLimit = async (sa: SaClient) => (await listOrgs(sa)).find((o) => o.id === org.id)!;
  const body = (username: string) => ({ firstName: "Rgr", lastName: "Seat", username, roleId: memberRoleId, password: runPassword() });
  const saAdd = (sa: SaClient, username = `${org.slug.slice(0, 20)}-s${tag()}`) =>
    sa.post(`${SA}/orgs/${org.id}/users`, { data: body(username) });
  const adminAdd = (username = `${org.slug.slice(0, 20)}-a${tag()}`) =>
    admin.post(orgApi(org.slug, "/users"), { data: { ...body(username) } });

  test.afterAll(async () => {
    await adminCtx?.dispose();
  });

  test("create with an explicit limit; seats {limit, used} in the org list and in BOTH users GETs", async ({ sa, run, ledger, playwright, baseURL }) => {
    org = await createThrowawayOrg(sa, { run, ledger }, "l", run.formulaSetId, 3);
    const listed = await orgLimit(sa);
    expect(listed).toMatchObject({ userLimit: 3, userCount: 1 });

    const roles = (await json<{ roles: { id: string; name: string }[] }>(await sa.get(`${SA}/roles?orgId=${org.id}`))).roles;
    memberRoleId = roles.find((r) => r.name === "Company Member")!.id;

    const s = await saUsers(sa);
    expect(s.seats).toEqual({ limit: 3, used: 1 });

    adminCtx = await rawContext(playwright, baseURL);
    expect((await signIn(adminCtx, org.slug, "admin", runPassword())).status()).toBe(200);
    admin = new Guarded(adminCtx, createAllowance([org.slug], [org.id]));
    const own = await json<{ users: UserRow[]; seats: Seats }>(await admin.get(orgApi(org.slug, "/users")));
    expect(own.seats).toEqual({ limit: 3, used: 1 });
    expect(own.users).toHaveLength(1);
  });

  test("fill to the limit (one SA add, one org-admin add), then BOTH paths answer 409 USER_LIMIT_REACHED with the exact body; nothing is created", async ({ sa }) => {
    expect((await saAdd(sa)).status()).toBe(201);
    expect((await adminAdd()).status()).toBe(201);
    expect((await saUsers(sa)).seats).toEqual({ limit: 3, used: 3 });
    expect(await orgLimit(sa)).toMatchObject({ userLimit: 3, userCount: 3 });

    const viaSa = await saAdd(sa);
    expect(viaSa.status(), "SuperAdmin path").toBe(409);
    expect(await viaSa.json()).toEqual(LIMIT_BODY(3, 3));
    const viaAdmin = await adminAdd();
    expect(viaAdmin.status(), "org-admin path").toBe(409);
    expect(await viaAdmin.json()).toEqual(LIMIT_BODY(3, 3));
    expect((await saUsers(sa)).users).toHaveLength(3);
  });

  test("a rule failure still wins over the limit: an unknown role at the cap is 400, not 409", async ({ sa }) => {
    const r = await sa.post(`${SA}/orgs/${org.id}/users`, { data: { ...body(`${org.slug.slice(0, 20)}-x${tag()}`), roleId: "rgr-ghost-00000000" } });
    await expectStatus(r, 400, "role from nowhere");
  });

  test("a DEACTIVATED user still counts toward the limit", async ({ sa }) => {
    const victim = (await saUsers(sa)).users.find((u) => u.username !== "admin")!;
    await expectStatus(await sa.patch(`${SA}/orgs/${org.id}/users/${victim.id}`, { data: { active: false } }), 200, "deactivate");
    const s = await saUsers(sa);
    expect(s.users.find((u) => u.id === victim.id)?.active).toBe(false);
    expect(s.seats).toEqual({ limit: 3, used: 3 });
    const r = await saAdd(sa);
    expect(r.status()).toBe(409);
    expect(await r.json()).toEqual(LIMIT_BODY(3, 3));
  });

  test("deleting a user frees a seat: the next add succeeds, the one after is 409 again", async ({ sa }) => {
    const victim = (await saUsers(sa)).users.find((u) => !u.active)!;
    await expectStatus(await sa.delete(`${SA}/orgs/${org.id}/users/${victim.id}`), 200, "delete");
    expect((await saUsers(sa)).seats).toEqual({ limit: 3, used: 2 });
    expect((await adminAdd()).status()).toBe(201);
    expect((await saUsers(sa)).seats).toEqual({ limit: 3, used: 3 });
    expect((await saAdd(sa)).status()).toBe(409);
  });

  test("lowering the limit BELOW current usage is allowed (200); it only blocks new adds; the change is audit-logged with from/to", async ({ sa }) => {
    const r = await json<{ org: { userLimit: number } }>(await sa.patch(`${SA}/orgs/${org.id}`, { data: { userLimit: 1 } }));
    expect(r.org.userLimit).toBe(1);
    const s = await saUsers(sa);
    expect(s.seats).toEqual({ limit: 1, used: 3 });
    expect(s.users).toHaveLength(3); // nobody was removed
    const blocked = await saAdd(sa);
    expect(blocked.status()).toBe(409);
    expect(await blocked.json()).toEqual(LIMIT_BODY(1, 3));
    const viaAdmin = await adminAdd();
    expect(viaAdmin.status()).toBe(409);
    expect(await viaAdmin.json()).toEqual(LIMIT_BODY(1, 3));

    const log = await auditLog(sa, { scope: "org", orgId: org.id, verb: "UPDATE", pageSize: 100 });
    const upd = log.entries.filter((e) => e.action === "org.update");
    expect(upd).toHaveLength(1);
    expect(upd[0].summary).toBe("Changed user limit");
    expect((upd[0].details as { userLimit?: unknown }).userLimit).toEqual({ from: 3, to: 1 });
  });

  test("PATCH userLimit alone is a valid update (no name / formula set needed) and an unchanged-field PATCH still needs at least one field", async ({ sa }) => {
    expect((await json<{ org: { userLimit: number } }>(await sa.patch(`${SA}/orgs/${org.id}`, { data: { userLimit: 4 } }))).org.userLimit).toBe(4);
    await expectStatus(await sa.patch(`${SA}/orgs/${org.id}`, { data: {} }), 400, "empty body");
    expect((await saUsers(sa)).seats).toEqual({ limit: 4, used: 3 });
  });

  test("concurrent adds at limit-1 through the SuperAdmin path: exactly one 201 and one 409, never over the limit", async ({ sa }) => {
    const [a, b] = await Promise.all([saAdd(sa), saAdd(sa)]);
    expect([a.status(), b.status()].sort()).toEqual([201, 409]);
    const loser = a.status() === 409 ? a : b;
    expect(await loser.json()).toEqual(LIMIT_BODY(4, 4));
    expect((await saUsers(sa)).seats).toEqual({ limit: 4, used: 4 });
  });

  test("concurrent adds at limit-1 across BOTH paths (SuperAdmin + org admin): exactly one 201 and one 409", async ({ sa }) => {
    const victim = (await saUsers(sa)).users.find((u) => u.username !== "admin")!;
    await expectStatus(await sa.delete(`${SA}/orgs/${org.id}/users/${victim.id}`), 200, "free one seat");
    expect((await saUsers(sa)).seats).toEqual({ limit: 4, used: 3 });
    const [a, b] = await Promise.all([saAdd(sa), adminAdd()]);
    expect([a.status(), b.status()].sort()).toEqual([201, 409]);
    expect((await saUsers(sa)).seats).toEqual({ limit: 4, used: 4 });
  });
});
