/**
 * SuperAdmin accounts (/superadmin/admins) and the audit log (/superadmin/audit-log) — Task 11, Step 2.
 *
 * Folds in the API scenarios of tests/e2e/superadmin-accounts.spec.ts and superadmin-audit-log.spec.ts
 * (those files stay in place, untouched), rewritten onto the regression fixtures:
 *   - throwaway accounts are `rgr-<runId>-sa…` (≤ 32 chars), ledgered kind superadmin the moment the 201
 *     arrives, deleted by the tests or by the Cleaner at teardown; teardown reports any leftover as a stray;
 *   - the tester account (TEST_SA_USERNAME) is only ever the CALLER: its password is never changed and it is
 *     never a DELETE target. The seeded `devadmin` (and every other real account) is never addressed by a
 *     mutation at all — the guard allows admin mutations only on ids this run created. The old spec's
 *     "DELETE devadmin → 403" probe is therefore NOT folded in (a regression there would delete a real
 *     account); the protected flag is asserted from the list instead, and self-delete is proven with a
 *     throwaway account's own session;
 *   - the old readSuperAdminAuditRows / purgeE2eSuperAdminAudit DB helpers are replaced by the audit-log API:
 *     audit rows are append-only and SURVIVE the run (accepted exception, see sa-helpers.ts).
 * The two old UI tests (/controls/users, /controls/audit-log pages) belong to the pages task (Task 12).
 */
import { covers } from "../fixtures/covers";
import { Guarded, createAllowance } from "../fixtures/clients";
import type { RunState } from "../fixtures/run-state";
import { runPassword } from "./sign-in";
import {
  test, expect, SA, GHOST, SA_USER, tag, cookie, rawContext, saLogin, expectStatus, json, auditLog, listAdmins, postAdmin, undoAcceptedAdmin,
} from "./sa-helpers";

covers("GET /api/v1/superadmin/admins");
covers("POST /api/v1/superadmin/admins");
covers("PATCH /api/v1/superadmin/admins/[adminId]");
covers("DELETE /api/v1/superadmin/admins/[adminId]");
covers("GET /api/v1/superadmin/audit-log");

const newName = (run: RunState) => `${run.prefix}sa${tag()}`; // e.g. rgr-murz1bv0-sa1a2b3c (21 chars)
/** Throwaway SuperAdmin passwords: derived from this run's RANDOM in-memory password (never from the public runId). */
const pw = (_run: RunState, n: number) => `${runPassword()}-sa${n}`;

test.describe("SuperAdmin accounts", () => {
  test.describe.configure({ mode: "serial" });
  let accountA = { id: "", username: "" };

  test("GET lists accounts oldest first: no secrets; `protected` only for devadmin; exactly one isSelf = the caller", async ({ sa }) => {
    const raw = await expectStatus(await sa.get(`${SA}/admins`), 200);
    expect(raw).not.toMatch(/passwordHash|password/i);
    const admins = (JSON.parse(raw) as { admins: { id: string; username: string; createdAt: string; protected: boolean; isSelf: boolean }[] }).admins;
    expect(admins.filter((a) => a.isSelf).map((a) => a.username)).toEqual([SA_USER()]);
    for (const a of admins) {
      expect(a.protected, a.username).toBe(a.username === "devadmin");
      expect(Object.keys(a).sort()).toEqual(["createdAt", "id", "isSelf", "protected", "username"]);
    }
    for (let i = 1; i < admins.length; i++) expect(admins[i - 1].createdAt <= admins[i].createdAt).toBe(true);
  });

  test("POST validation: bad JSON, non-object, missing fields, bad usernames, short password → 400; nothing created", async ({ sa, ledger, run }) => {
    const nj = await sa.post(`${SA}/admins`, { data: Buffer.from("{not json"), headers: { "Content-Type": "application/json" } });
    expect((await json<{ error: string }>(nj, 400)).error).toBe("Invalid JSON body");
    expect((await json<{ error: string }>(await sa.post(`${SA}/admins`, { data: [] }), 400)).error).toBe("Request body must be a JSON object");
    expect((await json<{ error: string }>(await sa.post(`${SA}/admins`, { data: { username: newName(run) } }), 400)).error).toBe("username and password are required");
    expect((await json<{ error: string }>(await sa.post(`${SA}/admins`, { data: { password: pw(run, 1) } }), 400)).error).toBe("username and password are required");
    // every bad name still carries the run prefix where the rule allows, so a wrongly accepted one is a findable stray
    for (const bad of ["", "a", `${run.prefix}has space`, `-${run.prefix}lead`, `${run.prefix}`.padEnd(33, "a"), `${run.prefix}upper_ok?`]) {
      // raw post (postAdmin insists on an rgr- name); a wrongly accepted account is deleted by id, then the test fails
      const r = await sa.post(`${SA}/admins`, { data: { username: bad, password: pw(run, 1) } });
      await undoAcceptedAdmin(sa, r, JSON.stringify(bad));
      expect((await json<{ error: string }>(r, 400, JSON.stringify(bad))).error).toMatch(/^username must be 2.32 characters/);
    }
    const short = await postAdmin(sa, ledger, newName(run), "short7!");
    expect((await json<{ error: string }>(short, 400)).error).toBe("password must be at least 8 characters");
    expect((await listAdmins(sa)).filter((a) => a.username.startsWith(run.prefix) || a.username.startsWith(`-${run.prefix}`))).toEqual([]);
  });

  test("POST creates an account (201, username trimmed + lower-cased) that can log in; duplicate → 409; listed unprotected", async ({ sa, ledger, run, playwright, baseURL }) => {
    const username = newName(run);
    const r = await postAdmin(sa, ledger, `  ${username.toUpperCase()}  `, pw(run, 1));
    const { admin } = await json<{ admin: { id: string; username: string } }>(r, 201);
    expect(admin).toEqual({ id: expect.any(String), username });
    accountA = admin;
    const ctx = await rawContext(playwright, baseURL);
    try {
      const l = await saLogin(ctx, username, pw(run, 1));
      expect(l.status).toBe(200);
      expect(l.token).toBeTruthy();
    } finally {
      await ctx.dispose();
    }
    expect((await json<{ error: string }>(await postAdmin(sa, ledger, username, pw(run, 1)), 409)).error).toBe(`Username "${username}" is already taken`);
    expect((await listAdmins(sa)).find((a) => a.id === admin.id)).toMatchObject({ username, protected: false, isSelf: false });
  });

  test("PATCH validation: short / missing / non-string newPassword → 400; unknown id → 404; the password is unchanged", async ({ sa, run, playwright, baseURL }) => {
    const url = `${SA}/admins/${accountA.id}`;
    for (const data of [{ newPassword: "short7!" }, {}, { newPassword: 12345678 }]) {
      expect((await json<{ error: string }>(await sa.patch(url, { data }), 400, JSON.stringify(data))).error).toBe("newPassword must be at least 8 characters");
    }
    expect((await json<{ error: string }>(await sa.patch(url, { data: [] }), 400)).error).toBe("Request body must be a JSON object");
    const ghost = new Guarded(sa.ctx, createAllowance([], [GHOST]), cookie(sa.token));
    expect((await json<{ error: string }>(await ghost.patch(`${SA}/admins/${GHOST}`, { data: { newPassword: pw(run, 2) } }), 404)).error).toBe("SuperAdmin not found");
    const ctx = await rawContext(playwright, baseURL);
    try {
      expect((await saLogin(ctx, accountA.username, pw(run, 1))).status).toBe(200);
    } finally {
      await ctx.dispose();
    }
  });

  test("PATCH another account's password: old rejected, new accepted, that account's sessions revoked; the caller's untouched", async ({ sa, run, playwright, baseURL }) => {
    const ctx = await rawContext(playwright, baseURL);
    try {
      const before = await saLogin(ctx, accountA.username, pw(run, 1));
      expect((await ctx.get(`${SA}/admins`, { headers: cookie(before.token!) })).status()).toBe(200);
      const r = await json<{ admin: { id: string }; sessionsRevoked: number }>(await sa.patch(`${SA}/admins/${accountA.id}`, { data: { newPassword: pw(run, 2) } }));
      expect(r.admin).toEqual({ id: accountA.id });
      expect(r.sessionsRevoked).toBeGreaterThanOrEqual(1);
      expect((await saLogin(ctx, accountA.username, pw(run, 1))).status).toBe(401);
      expect((await saLogin(ctx, accountA.username, pw(run, 2))).status).toBe(200);
      expect((await ctx.get(`${SA}/admins`, { headers: cookie(before.token!) })).status()).toBe(401);
      expect((await sa.get(`${SA}/admins`)).status()).toBe(200);
    } finally {
      await ctx.dispose();
    }
  });

  test("PATCH your OWN account keeps the current session and revokes your other sessions (throwaway account B)", async ({ sa, ledger, run, playwright, baseURL }) => {
    const username = newName(run);
    const b = (await json<{ admin: { id: string } }>(await postAdmin(sa, ledger, username, pw(run, 1)), 201)).admin;
    const ctx = await rawContext(playwright, baseURL);
    try {
      const s1 = (await saLogin(ctx, username, pw(run, 1))).token!;
      const s2 = (await saLogin(ctx, username, pw(run, 1))).token!;
      // B's own session, through the guarded client (B's id is in this run's allowance)
      const r = await json<{ sessionsRevoked: number }>(await sa.patch(`${SA}/admins/${b.id}`, { data: { newPassword: pw(run, 2) }, headers: cookie(s1) }));
      expect(r.sessionsRevoked).toBeGreaterThanOrEqual(1);
      expect((await ctx.get(`${SA}/admins`, { headers: cookie(s1) })).status()).toBe(200); // kept
      expect((await ctx.get(`${SA}/admins`, { headers: cookie(s2) })).status()).toBe(401); // revoked
      expect((await saLogin(ctx, username, pw(run, 2))).status).toBe(200);
      // DELETE yourself → 400 "Cannot delete your own account", and B still exists
      expect((await json<{ error: string }>(await sa.delete(`${SA}/admins/${b.id}`, { headers: cookie(s1) }), 400)).error).toBe("Cannot delete your own account");
      expect((await listAdmins(sa)).some((a) => a.id === b.id)).toBe(true);
    } finally {
      await ctx.dispose();
    }
  });

  test("the protected account is flagged in the list (never probed with a mutation); DELETE of an unknown id → 404", async ({ sa }) => {
    const dev = (await listAdmins(sa)).find((a) => a.username === "devadmin");
    expect(dev, "the seeded protected account devadmin exists on this environment").toBeTruthy();
    expect(dev!.protected).toBe(true);
    const ghost = new Guarded(sa.ctx, createAllowance([], [GHOST]), cookie(sa.token));
    expect((await json<{ error: string }>(await ghost.delete(`${SA}/admins/${GHOST}`), 404)).error).toBe("SuperAdmin not found");
  });

  test("DELETE removes the account and its sessions; its audit history survives (by.deleted) and the delete row keeps the name", async ({ sa, ledger, run, playwright, baseURL }) => {
    const ctx = await rawContext(playwright, baseURL);
    try {
      // A authors an audit row: logged in as A, create C
      const aSession = (await saLogin(ctx, accountA.username, pw(run, 2))).token!;
      const c = await postAdmin(sa, ledger, newName(run), pw(run, 1), cookie(aSession));
      await expectStatus(c, 201, "A creates C");
      const beforeLog = await auditLog(sa, { by: accountA.username, pageSize: 100 });
      expect(beforeLog.entries.some((e) => e.action === "superadmin.create")).toBe(true);
      for (const e of beforeLog.entries) expect(e.by).toEqual({ username: accountA.username, deleted: false });

      expect(await json(await sa.delete(`${SA}/admins/${accountA.id}`))).toEqual({ deleted: true });
      expect((await listAdmins(sa)).some((a) => a.id === accountA.id)).toBe(false);
      expect((await saLogin(ctx, accountA.username, pw(run, 2))).status).toBe(401);
      expect((await ctx.get(`${SA}/admins`, { headers: cookie(aSession) })).status()).toBe(401);
      expect((await json<{ error: string }>(await sa.delete(`${SA}/admins/${accountA.id}`), 404)).error).toBe("SuperAdmin not found");

      const after = await auditLog(sa, { by: accountA.username, pageSize: 100 });
      expect(after.total).toBe(beforeLog.total); // the same rows, kept
      for (const e of after.entries) expect(e.by).toEqual({ username: accountA.username, deleted: true });
      expect(after.facets.admins).toContainEqual({ username: accountA.username, deleted: true });
      expect(after.facets.admins).toContainEqual({ username: SA_USER(), deleted: false });
      const del = await auditLog(sa, { verb: "DELETE", item: "SuperAdmin", by: SA_USER(), pageSize: 100 });
      expect(del.entries.find((e) => e.targetId === accountA.id)).toMatchObject({ action: "superadmin.delete", entity: accountA.username, summary: "SuperAdmin account deleted", org: null });
    } finally {
      await ctx.dispose();
    }
  });

  test("every mutation above wrote its audit row (create, password_change, delete), targetType SuperAdmin, never a password", async ({ sa, run }) => {
    const log = await auditLog(sa, { item: "SuperAdmin", by: SA_USER(), pageSize: 100 });
    const mine = log.entries.filter((e) => e.entity?.startsWith(run.prefix));
    const actions = new Set(mine.map((e) => e.action));
    for (const a of ["superadmin.create", "superadmin.password_change", "superadmin.delete"]) expect(actions.has(a), a).toBe(true);
    for (const e of mine) expect(e.targetType).toBe("SuperAdmin");
    const text = JSON.stringify(mine);
    for (const n of [1, 2]) expect(text).not.toContain(pw(run, n));
  });
});

test.describe("GET /api/v1/superadmin/audit-log", () => {
  test("read-only: POST / PATCH / PUT / DELETE → 405 (no write verbs exist)", async ({ sa }) => {
    // raw context: there is no handler to reach, and the guard (rightly) knows no audit-log write shape
    for (const method of ["post", "patch", "put", "delete"] as const) {
      const r = await sa.ctx[method](`${SA}/audit-log`, { headers: cookie(sa.token), data: {} });
      expect(r.status(), method).toBe(405);
    }
  });

  test("bad filter values → 400 with a message", async ({ sa }) => {
    const bad = [
      "scope=everything", "orgId=x", "scope=platform&orgId=x", "verb=insert", "verb=UPSERT", "item=Widget",
      "from=2026-13-01", "from=2026-02-30", "to=yesterday", "from=2026-10-05&to=2026-10-01",
      "page=0", "page=-1", "page=1.5", "page=abc", "pageSize=0", "pageSize=101", "pageSize=x",
    ];
    for (const q of bad) {
      const r = await sa.get(`${SA}/audit-log?${q}`);
      expect((await json<{ error: string }>(r, 400, q)).error.length, q).toBeGreaterThan(0);
    }
  });

  test("shape: newest first, the display triple, the six items in the facet, defaults page 1 / 50; no secrets", async ({ sa, run }) => {
    const raw = await expectStatus(await sa.get(`${SA}/audit-log`), 200);
    expect(raw).not.toMatch(/passwordHash|newPassword|\$2[aby]\$|scrypt/i);
    expect(raw).not.toContain(runPassword());
    expect(raw).not.toContain(process.env.TEST_SA_PASSWORD!);
    const body = JSON.parse(raw) as Awaited<ReturnType<typeof auditLog>>;
    expect({ page: body.page, pageSize: body.pageSize }).toEqual({ page: 1, pageSize: 50 });
    expect(body.total).toBeGreaterThanOrEqual(body.entries.length);
    expect(body.facets.items).toEqual(expect.arrayContaining(["Organization", "User", "Role", "Formula set", "Component type", "SuperAdmin"]));
    for (let i = 1; i < body.entries.length; i++) expect(body.entries[i - 1].createdAt >= body.entries[i].createdAt).toBe(true);
    for (const e of body.entries) {
      expect(["INSERT", "UPDATE", "DELETE"]).toContain(e.verb);
      expect(e.item.length).toBeGreaterThan(0);
      expect(e.summary.length).toBeGreaterThan(0);
      expect(e.action).toMatch(/^[A-Za-z]+\.[A-Za-z_]+$/);
    }
    void run;
  });

  test("filters: a new account is INSERT · SuperAdmin at platform scope by the caller; every result honours every filter", async ({ sa, ledger, run }) => {
    const username = newName(run);
    await expectStatus(await postAdmin(sa, ledger, username, pw(run, 1)), 201);
    const log = await auditLog(sa, { scope: "platform", item: "SuperAdmin", verb: "INSERT", by: SA_USER(), pageSize: 100 });
    expect(log.entries.find((e) => e.entity === username)).toMatchObject({ verb: "INSERT", item: "SuperAdmin", action: "superadmin.create", org: null, by: { username: SA_USER(), deleted: false }, summary: "New SuperAdmin account" });
    for (const e of log.entries) {
      expect(e).toMatchObject({ verb: "INSERT", item: "SuperAdmin", org: null });
      expect(e.by.username).toBe(SA_USER());
    }
    const none = await auditLog(sa, { item: "SuperAdmin", verb: "INSERT", by: `${run.prefix}no-such-admin` });
    expect(none).toMatchObject({ total: 0, entries: [] });
  });

  test("verb filter: INSERT / UPDATE / DELETE partition the log (no overlap, nothing missing)", async ({ sa }) => {
    // other workers write audit rows concurrently — retry until the four counts are read in one quiet window
    await expect(async () => {
      const [ins, up, del, all] = await Promise.all([
        auditLog(sa, { verb: "INSERT", pageSize: 5 }),
        auditLog(sa, { verb: "UPDATE", pageSize: 5 }),
        auditLog(sa, { verb: "DELETE", pageSize: 5 }),
        auditLog(sa, { pageSize: 1 }),
      ]);
      expect(ins.total + up.total + del.total).toBe(all.total);
      for (const [verb, page] of [["INSERT", ins], ["UPDATE", up], ["DELETE", del]] as const) {
        for (const e of page.entries) expect(e.verb).toBe(verb);
      }
    }).toPass({ timeout: 30_000 });
  });

  test("date filter: the day of one of our rows holds it (from = to = that UTC day); a past and a future range hold none", async ({ sa, run }) => {
    // the day comes from the row's own createdAt, so a run crossing UTC midnight cannot break the test
    const ours = (await auditLog(sa, { by: SA_USER(), item: "SuperAdmin", pageSize: 100 })).entries.find((e) => e.entity?.startsWith(run.prefix));
    expect(ours, "an audit row about one of this run's accounts").toBeTruthy();
    const day = ours!.createdAt.slice(0, 10);
    const t = await auditLog(sa, { from: day, to: day, by: SA_USER(), item: "SuperAdmin", pageSize: 100 });
    expect(t.entries.some((e) => e.id === ours!.id)).toBe(true);
    for (const e of t.entries) expect(e.createdAt.slice(0, 10)).toBe(day);
    expect((await auditLog(sa, { from: "2000-01-01", to: "2000-12-31" })).total).toBe(0);
    expect((await auditLog(sa, { from: "2999-01-01" })).total).toBe(0);
  });

  test("paging over a settled window (rows older than 2 days): pages are disjoint slices; past the end is empty", async ({ sa }) => {
    const to = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const p1 = await auditLog(sa, { to, pageSize: 2, page: 1 });
    const p2 = await auditLog(sa, { to, pageSize: 2, page: 2 });
    expect(p1.total, "the dev DB has an audit history older than 2 days").toBeGreaterThanOrEqual(4);
    expect(p1.entries).toHaveLength(2);
    expect(p2.entries).toHaveLength(2);
    expect(p2.total).toBe(p1.total);
    const ids1 = p1.entries.map((e) => e.id);
    for (const e of p2.entries) expect(ids1).not.toContain(e.id);
    expect(p1.entries[1].createdAt >= p2.entries[0].createdAt).toBe(true);
    const beyond = await auditLog(sa, { to, pageSize: 50, page: 100000 });
    expect(beyond.entries).toEqual([]);
    expect(beyond.total).toBe(p1.total);
  });

  test("org scope: an SA-created Test-Org user is INSERT · User under the Test Org (not platform); its delete is DELETE · User with the name kept", async ({ sa, ledger, run }) => {
    // the Test Org is the one org this run may add a (ledgered, rgr-) user to; this client may address only it
    const testOrgSa = new Guarded(sa.ctx, createAllowance([], [run.testOrg.id]), cookie(sa.token));
    const roles = (await json<{ roles: { id: string; name: string }[] }>(await sa.get(`${SA}/roles?orgId=${run.testOrg.id}`))).roles;
    const username = `${run.prefix}sa-aud-${tag()}`;
    const r = await testOrgSa.post(`${SA}/orgs/${run.testOrg.id}/users`, {
      data: { firstName: "Rgr", lastName: "Audit", username, roleId: roles.find((x) => x.name === "Company Member")!.id, password: runPassword() },
    });
    const text = await r.text();
    if (r.status() === 201) ledger.add({ kind: "user", id: (JSON.parse(text) as { user: { id: string } }).user.id, orgSlug: run.testOrg.slug, label: username });
    expect(r.status(), text).toBe(201);
    const userId = (JSON.parse(text) as { user: { id: string } }).user.id;

    const inOrg = await auditLog(sa, { scope: "org", orgId: run.testOrg.id, item: "User", verb: "INSERT", pageSize: 100 });
    expect(inOrg.entries.find((e) => e.entity === username)).toMatchObject({ action: "user.create", org: { id: run.testOrg.id, slug: run.testOrg.slug }, summary: "New user" });
    for (const e of inOrg.entries) expect(e.org?.id).toBe(run.testOrg.id);
    expect(inOrg.facets.orgs).toContainEqual({ id: run.testOrg.id, slug: run.testOrg.slug });
    const anyOrg = await auditLog(sa, { scope: "org", pageSize: 100 });
    for (const e of anyOrg.entries) expect(e.org).not.toBeNull();
    const platform = await auditLog(sa, { scope: "platform", pageSize: 100 });
    for (const e of platform.entries) expect(e.org).toBeNull();
    expect(platform.entries.some((e) => e.entity === username)).toBe(false);

    expect(await json(await testOrgSa.delete(`${SA}/orgs/${run.testOrg.id}/users/${userId}`))).toEqual({ deleted: true });
    ledger.remove(userId);
    const del = await auditLog(sa, { scope: "org", orgId: run.testOrg.id, verb: "DELETE", item: "User", pageSize: 100 });
    expect(del.entries.find((e) => e.targetId === userId)).toMatchObject({ action: "user.delete", entity: username, summary: "User deleted" });
  });
});
