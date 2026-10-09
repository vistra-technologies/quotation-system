/**
 * SuperAdmin orgs + org users (Task 11, Step 2).
 *
 * Writes go ONLY to rows this run owns:
 *   - org creation rules: every rejected create carries an UNKNOWN formulaSetId, so a broken slug rule
 *     surfaces as 404 "Formula set not found" (test fails) instead of creating an org; the only accepted
 *     creates are the throwaway orgs `rgr-<runId>-c…` (ledgered kind org);
 *   - the lifecycle (create → suspend → reactivate → suspend → hard delete → cascade proof → audit) runs on
 *     its own throwaway org C;
 *   - SA user CRUD runs in this run's org B (users ledgered kind user, org B is hard-deleted at teardown);
 *     cross-org probes address a Test-Org user the test itself created (factory, ledgered), so a broken
 *     tenancy check could only touch the suite's own row.
 */
import type { APIRequestContext } from "@playwright/test";
import { covers } from "../fixtures/covers";
import { Guarded, createAllowance } from "../fixtures/clients";
import type { RunState } from "../fixtures/run-state";
import { orgUrl } from "../../e2e/helpers";
import { countProjectCalculations, regressionSnapshot, rgrInsertCalculation } from "../../e2e/db-helpers";
import { orgApi } from "./project-helpers";
import { ORG_B_USER_LIMIT } from "../fixtures/test-org-limit";
import { RESERVED_ORG_SLUGS } from "@/lib/auth-utils";
import { runPassword, sessionCookieLine, signIn } from "./sign-in";
import {
  test, expect, SA, GHOST, SA_USER, tag, rawContext, expectStatus, json, auditLog, listOrgs, type OrgRow,
} from "./sa-helpers";

covers("GET /api/v1/superadmin/orgs");
covers("POST /api/v1/superadmin/orgs");
covers("PATCH /api/v1/superadmin/orgs/[orgId]");
covers("DELETE /api/v1/superadmin/orgs/[orgId]");
covers("POST /api/v1/superadmin/orgs/[orgId]/suspend");
covers("GET /api/v1/superadmin/orgs/[orgId]/users");
covers("POST /api/v1/superadmin/orgs/[orgId]/users");
covers("PATCH /api/v1/superadmin/orgs/[orgId]/users/[userId]");
covers("DELETE /api/v1/superadmin/orgs/[orgId]/users/[userId]");

type UserRow = { id: string; username: string; firstName: string; lastName: string; mobile: string | null; profileEmail: string | null; active: boolean; role: { id: string; name: string } };
type RoleRow = { id: string; name: string; isInternalRole: boolean; organizationId: string };

test.describe("GET /api/v1/superadmin/orgs", () => {
  test("lists every org with status, user count and formula-set label; the Test Org and this run's org B are there", async ({ sa, run }) => {
    const orgs = await listOrgs(sa);
    const b = orgs.find((o) => o.id === run.orgB.id)!;
    expect(b).toMatchObject({ slug: run.orgB.slug, name: `RGR ${run.runId} B`, isSuspended: false, activeFormulaSetId: run.formulaSetId, hasMismatch: false });
    expect(b.userCount).toBeGreaterThanOrEqual(1);
    expect(b.userLimit).toBe(ORG_B_USER_LIMIT); // global-setup creates org B with an explicit limit
    expect(b.formulaSetLabel).toMatch(/ v\d+$/);
    const t = orgs.find((o) => o.id === run.testOrg.id)!;
    expect(t).toMatchObject({ slug: run.testOrg.slug, isSuspended: false });
    expect(t.userCount).toBeGreaterThanOrEqual(4); // the run's four role users at least
    expect(t.userLimit).toBeGreaterThanOrEqual(t.userCount); // global-setup raised it for the run (restored at teardown)
    // oldest first
    for (let i = 1; i < orgs.length; i++) expect(orgs[i - 1].createdAt <= orgs[i].createdAt).toBe(true);
    for (const o of orgs) expect(Object.keys(o).sort()).toEqual(["activeFormulaSetId", "createdAt", "formulaSetLabel", "hasMismatch", "id", "isSuspended", "name", "slug", "userCount", "userLimit"]);
  });
});

test.describe("POST /api/v1/superadmin/orgs — rules (nothing is created by any rejected request)", () => {
  test("slug, name, password and formula-set rules each answer 400 / 404 with their exact message", async ({ sa, run }) => {
    const p = run.prefix;
    const base = { name: `RGR ${run.runId} bad`, adminPassword: runPassword(), formulaSetId: GHOST };
    const cases: Array<[string, Record<string, unknown>, number, string | RegExp]> = [
      ["reserved slug 'platform'", { ...base, slug: "platform" }, 400, '"platform" is a reserved slug and cannot be used'],
      ["reserved slug, case-folded", { ...base, slug: "  PLATFORM " }, 400, '"platform" is a reserved slug and cannot be used'],
      // Stage 29 (S29-10): every reserved slug is refused; 'controls' and 'www' also case-folded / padded
      ...RESERVED_ORG_SLUGS.map((s): [string, Record<string, unknown>, number, string] => [`reserved slug '${s}'`, { ...base, slug: s }, 400, `"${s}" is a reserved slug and cannot be used`]),
      ["reserved slug 'controls', upper-cased", { ...base, slug: " CONTROLS " }, 400, '"controls" is a reserved slug and cannot be used'],
      ["reserved slug 'www', upper-cased", { ...base, slug: "WWW" }, 400, '"www" is a reserved slug and cannot be used'],
      // Stage 29 (S29-7): userLimit is validated BEFORE anything is written (an unknown formula set would otherwise be 404)
      ...[0, -1, 10001, 1.5, "3", true].map((v): [string, Record<string, unknown>, number, string] => [`userLimit ${JSON.stringify(v)}`, { ...base, slug: `${p}bad6`, userLimit: v }, 400, "userLimit must be a whole number between 1 and 10000"]),
      ["consecutive hyphens", { ...base, slug: `${p}bad--x` }, 400, "slug must not contain consecutive hyphens"],
      ["64 characters", { ...base, slug: `${p}bad`.padEnd(64, "a") }, 400, "slug must be 63 characters or fewer"],
      ["illegal characters", { ...base, slug: `${p}bad_slug!` }, 400, /^slug must contain only lowercase letters/],
      ["leading hyphen", { ...base, slug: `-${p}bad` }, 400, /^slug must contain only lowercase letters/],
      ["trailing hyphen", { ...base, slug: `${p}bad-` }, 400, /^slug must contain only lowercase letters/],
      ["blank name", { ...base, name: "   ", slug: `${p}bad1` }, 400, "name is required"],
      ["blank slug", { ...base, slug: "  " }, 400, "slug is required"],
      ["short adminPassword", { ...base, slug: `${p}bad2`, adminPassword: "short7!" }, 400, "adminPassword must be at least 8 characters"],
      ["missing adminPassword", { name: base.name, slug: `${p}bad3`, formulaSetId: GHOST }, 400, "name, slug, adminPassword, and formulaSetId are required"],
      ["missing formulaSetId", { name: base.name, slug: `${p}bad4`, adminPassword: runPassword() }, 400, "formulaSetId is required"],
      ["unknown formulaSetId", { ...base, slug: `${p}bad5` }, 404, "Formula set not found"],
    ];
    for (const [what, data, status, msg] of cases) {
      const body = await json<{ error: string }>(await sa.post(`${SA}/orgs`, { data }), status, what);
      if (typeof msg === "string") expect(body.error, what).toBe(msg);
      else expect(body.error, what).toMatch(msg);
    }
    const bad = await sa.post(`${SA}/orgs`, { data: Buffer.from("{not json"), headers: { "Content-Type": "application/json" } });
    expect((await json<{ error: string }>(bad, 400)).error).toBe("Invalid JSON body");
    expect((await listOrgs(sa)).filter((o) => o.slug.startsWith(`${p}bad`) || o.slug === "platform")).toEqual([]);
  });

  test("a duplicate slug (org B's, also case-folded and padded) → 409 and no second org", async ({ sa, run }) => {
    for (const slug of [run.orgB.slug, `  ${run.orgB.slug.toUpperCase()} `]) {
      const r = await sa.post(`${SA}/orgs`, { data: { name: `RGR ${run.runId} dup`, slug, adminPassword: runPassword(), formulaSetId: run.formulaSetId } });
      await expectStatus(r, 409, slug);
    }
    expect((await listOrgs(sa)).filter((o) => o.slug === run.orgB.slug)).toHaveLength(1);
  });
});

/** Throwaway org lifecycle — one serial story on org C. */
test.describe("throwaway org lifecycle: create → suspend → reactivate → suspend → hard delete → cascade → audit", () => {
  test.describe.configure({ mode: "serial" });

  let orgC: { id: string; slug: string; name: string };
  let projectId = "";
  // The org admin's session, signed in BEFORE the suspension and held across it (S29-9: an existing session
  // is refused on its next API call, and works again after reactivation). Only ever used against org C.
  let heldCtx: APIRequestContext | undefined;
  test.afterAll(async () => {
    await heldCtx?.dispose();
  });

  test("create: 201 { org, warnings: [] }, seeded admin + default roles, listed active; audit org.create + user.create", async ({ sa, run, ledger }) => {
    const slug = `${run.prefix}c${tag()}`;
    const r = await sa.post(`${SA}/orgs`, { data: { name: `  RGR ${run.runId} C  `, slug: `  ${slug.toUpperCase()} `, adminPassword: runPassword(), formulaSetId: run.formulaSetId } });
    const text = await r.text();
    if (r.status() === 201) {
      const o = (JSON.parse(text) as { org: { id: string; slug: string; name: string } }).org;
      ledger.add({ kind: "org", id: o.id, orgSlug: o.slug, label: o.slug }); // ledger FIRST, then assert
      sa.allowance.ids.add(o.id);
    }
    expect(r.status(), text).toBe(201);
    const body = JSON.parse(text) as { org: { id: string; slug: string; name: string }; warnings: unknown[] };
    orgC = body.org;
    expect(body).toEqual({ org: { id: expect.any(String), slug, name: `RGR ${run.runId} C` }, warnings: [] }); // slug lower-cased + trimmed, name trimmed

    const listed = (await listOrgs(sa)).find((o) => o.id === orgC.id)!;
    expect(listed).toMatchObject({ slug, isSuspended: false, userCount: 1, userLimit: 3, activeFormulaSetId: run.formulaSetId, hasMismatch: false }); // userLimit: the default for a new org

    const u = await json<{ users: UserRow[]; externalCompanies: unknown[] }>(await sa.get(`${SA}/orgs/${orgC.id}/users`));
    expect(u.externalCompanies).toEqual([]);
    expect(u.users.map((x) => [x.username, x.role.name, x.active])).toEqual([["admin", "Admin", true]]);
    const roles = await json<{ roles: RoleRow[] }>(await sa.get(`${SA}/roles?orgId=${orgC.id}`));
    expect(roles.roles.map((x) => x.name).sort()).toEqual(["Admin", "Architectural Firm", "Company Member", "Distributor"]);

    const log = await auditLog(sa, { scope: "org", orgId: orgC.id, pageSize: 100 });
    expect(log.entries.map((e) => e.action).sort()).toEqual(["org.create", "user.create"]);
    expect(log.entries.find((e) => e.action === "org.create")).toMatchObject({ verb: "INSERT", item: "Organization", entity: slug, org: { id: orgC.id, slug }, by: { username: SA_USER(), deleted: false } });
    expect(log.entries.find((e) => e.action === "user.create")).toMatchObject({ item: "User", entity: "admin" });
  });

  test("PATCH: name / formula set update with the edit shape; validation 400s; unknown org / formula set 404; audit org.update", async ({ sa, run }) => {
    const url = `${SA}/orgs/${orgC.id}`;
    const ok = await json<{ org: Record<string, unknown>; warnings: unknown[] }>(await sa.patch(url, { data: { name: `  RGR ${run.runId} C renamed ` } }));
    expect(ok).toEqual({
      org: { id: orgC.id, name: `RGR ${run.runId} C renamed`, slug: orgC.slug, isSuspended: false, userLimit: 3, activeFormulaSetId: run.formulaSetId, formulaSetLabel: expect.stringMatching(/ v\d+$/) },
      warnings: [],
    });
    expect((await json<{ org: { activeFormulaSetId: string } }>(await sa.patch(url, { data: { formulaSetId: run.formulaSetId } }))).org.activeFormulaSetId).toBe(run.formulaSetId);

    const cases: Array<[string, unknown, number, string]> = [
      ["no updatable field", { slug: "x" }, 400, "At least one of name, formulaSetId or userLimit must be provided"],
      ["userLimit 0", { userLimit: 0 }, 400, "userLimit must be a whole number between 1 and 10000"],
      ["userLimit 10001", { userLimit: 10001 }, 400, "userLimit must be a whole number between 1 and 10000"],
      ["userLimit 1.5", { userLimit: 1.5 }, 400, "userLimit must be a whole number between 1 and 10000"],
      ["userLimit as a string", { userLimit: "3" }, 400, "userLimit must be a whole number between 1 and 10000"],
      ["valid name + invalid userLimit writes nothing", { name: "rgr-should-not-apply", userLimit: 0 }, 400, "userLimit must be a whole number between 1 and 10000"],
      ["blank name", { name: "  " }, 400, "name must not be empty"],
      ["unknown formula set", { formulaSetId: GHOST }, 404, "Formula set not found"],
    ];
    for (const [what, data, status, msg] of cases) {
      expect((await json<{ error: string }>(await sa.patch(url, { data }), status, what)).error).toBe(msg);
    }
    const nj = await sa.patch(url, { data: Buffer.from("{not json"), headers: { "Content-Type": "application/json" } });
    expect((await json<{ error: string }>(nj, 400)).error).toBe("Invalid JSON body");
    const ghost = new Guarded(sa.ctx, createAllowance([], [GHOST]), { Cookie: `qs-sa-token=${sa.token}` });
    expect((await json<{ error: string }>(await ghost.patch(`${SA}/orgs/${GHOST}`, { data: { name: "rgr-ghost" } }), 404)).error).toMatch(/not found/i);
    // the slug never changes through PATCH
    expect((await listOrgs(sa)).find((o) => o.id === orgC.id)).toMatchObject({ slug: orgC.slug, name: `RGR ${run.runId} C renamed` });

    const log = await auditLog(sa, { scope: "org", orgId: orgC.id, verb: "UPDATE", pageSize: 100 });
    const upd = log.entries.filter((e) => e.action === "org.update");
    expect(upd).toHaveLength(2); // the rejected PATCHes wrote nothing
    expect(upd.map((e) => e.summary).sort()).toEqual(["Changed formula set", "Changed name"]);
  });

  test("hard delete of an ACTIVE org → 400 (suspended-only gate) and the org is still there", async ({ sa }) => {
    const r = await sa.delete(`${SA}/orgs/${orgC.id}`);
    expect((await json<{ error: string }>(r, 400)).error).toMatch(/suspended/i);
    expect((await listOrgs(sa)).some((o) => o.id === orgC.id)).toBe(true);
  });

  test("give org C data to cascade: its admin signs in and creates a project; a calculation row is attached", async ({ playwright, baseURL }) => {
    test.setTimeout(180_000); // sign-ins retry on 429 (rate limit 3 / 10 s / IP, shared by all workers)
    heldCtx = await rawContext(playwright, baseURL); // kept open on purpose (disposed in afterAll)
    expect((await signIn(heldCtx, orgC.slug, "admin", runPassword())).status()).toBe(200);
    const admin = new Guarded(heldCtx, createAllowance([orgC.slug], [orgC.id]));
    const p = await admin.post(orgApi(orgC.slug, "/projects"), { data: { name: `${orgC.slug}-proj`, currency: "AED", projectLocation: "Dubai, UAE" } });
    projectId = (await json<{ project: { id: string } }>(p, 201)).project.id; // cascades with org C (not ledgered on its own)
    await rgrInsertCalculation(projectId);
    expect(await countProjectCalculations(orgC.id)).toBe(1);
  });

  test("suspend → 200; listed suspended; its pages answer 403; audit org.suspend", async ({ sa, playwright, baseURL }) => {
    expect(await json(await sa.post(`${SA}/orgs/${orgC.id}/suspend`, { data: { suspend: true } }))).toEqual({ ok: true });
    expect((await listOrgs(sa)).find((o) => o.id === orgC.id)?.isSuspended).toBe(true);
    const ctx = await rawContext(playwright, baseURL);
    try {
      const page = await ctx.get(orgUrl(orgC.slug, "/dashboard"), { maxRedirects: 0 });
      expect(page.status()).toBe(403);
      expect(page.headers()["content-type"]).toContain("text/html"); // S29-9: static HTML page, not JSON
      const html = await page.text();
      expect(html).toContain("Organization suspended");
      expect(html).toContain("This organization has been suspended. Please contact your platform administrator.");
      expect(html).not.toContain(orgC.slug); // no org data on the page
      expect(html).not.toMatch(/<script/i); // no JS
    } finally {
      await ctx.dispose();
    }
    const log = await auditLog(sa, { scope: "org", orgId: orgC.id, verb: "UPDATE", pageSize: 100 });
    expect(log.entries.find((e) => e.action === "org.suspend")).toMatchObject({ summary: "Suspended", entity: orgC.slug });
  });

  // S29-9: suspended means no org-user access at all. The API and sign-in refuse immediately (no cache),
  // whatever the proxy's 60 s page cache says.
  test("suspended org: sign-in refused 403 ORG_SUSPENDED (no session issued); the held session's API calls → 403 ORG_SUSPENDED", async ({ playwright, baseURL }) => {
    test.setTimeout(180_000); // sign-ins retry on 429 (rate limit 3 / 10 s / IP, shared by all workers)
    const body = { error: "This organization has been suspended. Please contact your platform administrator.", code: "ORG_SUSPENDED" };
    const fresh = await rawContext(playwright, baseURL);
    try {
      const r = await signIn(fresh, orgC.slug, "admin", runPassword());
      expect(r.status(), await r.text()).toBe(403);
      const text = await r.text();
      expect(JSON.parse(text)).toMatchObject({ code: "ORG_SUSPENDED", message: body.error });
      expect(sessionCookieLine(r), "no session cookie issued").toBeUndefined();
      expect((await fresh.get(orgApi(orgC.slug, "/me"))).status(), "the refused sign-in left no usable session").toBe(401);
    } finally {
      await fresh.dispose();
    }
    const admin = new Guarded(heldCtx!, createAllowance([orgC.slug], [orgC.id]));
    for (const path of ["/me", `/projects/${projectId}`]) {
      const r = await admin.get(orgApi(orgC.slug, path));
      expect(r.status(), path).toBe(403);
      expect(await r.json(), path).toEqual(body);
    }
  });

  test("bad suspend bodies → 400; unknown org → 404", async ({ sa }) => {
    for (const data of [{}, { suspend: "true" }, { suspend: 1 }]) {
      expect((await json<{ error: string }>(await sa.post(`${SA}/orgs/${orgC.id}/suspend`, { data }), 400, JSON.stringify(data))).error).toBe("suspend (boolean) is required");
    }
    const ghost = new Guarded(sa.ctx, createAllowance([], [GHOST]), { Cookie: `qs-sa-token=${sa.token}` });
    await expectStatus(await ghost.post(`${SA}/orgs/${GHOST}/suspend`, { data: { suspend: true } }), 404);
    expect((await listOrgs(sa)).find((o) => o.id === orgC.id)?.isSuspended).toBe(true); // unchanged by the rejects
  });

  test("reactivate → 200, listed active, audit org.reactivate; the held session and a fresh sign-in work again; suspend again → 200", async ({ sa, playwright, baseURL }) => {
    test.setTimeout(180_000);
    expect(await json(await sa.post(`${SA}/orgs/${orgC.id}/suspend`, { data: { suspend: false } }))).toEqual({ ok: true });
    expect((await listOrgs(sa)).find((o) => o.id === orgC.id)?.isSuspended).toBe(false);
    const log = await auditLog(sa, { scope: "org", orgId: orgC.id, verb: "UPDATE", pageSize: 100 });
    expect(log.entries.find((e) => e.action === "org.reactivate")).toMatchObject({ summary: "Reactivated" });
    // Reactivation restores everything: the held session (never deleted) works again and a fresh sign-in succeeds.
    // API only: proxy.ts may serve its cached 403 page for up to 60 s per instance.
    const admin = new Guarded(heldCtx!, createAllowance([orgC.slug], [orgC.id]));
    expect((await admin.get(orgApi(orgC.slug, "/me"))).status()).toBe(200);
    expect((await admin.get(orgApi(orgC.slug, `/projects/${projectId}`))).status()).toBe(200);
    const fresh = await rawContext(playwright, baseURL);
    try {
      expect((await signIn(fresh, orgC.slug, "admin", runPassword())).status()).toBe(200);
      expect((await fresh.get(orgApi(orgC.slug, "/me"))).status()).toBe(200);
    } finally {
      await fresh.dispose();
    }
    expect(await json(await sa.post(`${SA}/orgs/${orgC.id}/suspend`, { data: { suspend: true } }))).toEqual({ ok: true });
    expect((await listOrgs(sa)).find((o) => o.id === orgC.id)?.isSuspended).toBe(true);
  });

  test("hard delete → 200; gone everywhere; every org-scoped table holds 0 rows for it (cascade); audit trail complete", async ({ sa }) => {
    test.setTimeout(180_000);
    const before = (await regressionSnapshot()).orgs[orgC.slug] as { counts: Record<string, number> } | undefined;
    expect(before, "org C in the snapshot before the delete").toBeTruthy();
    expect(before!.counts).toMatchObject({ user: 1, role: 4, project: 1, projectCalculation: 1 });
    expect(before!.counts.componentType ?? 0).toBeGreaterThan(0);

    expect(await json(await sa.delete(`${SA}/orgs/${orgC.id}`))).toEqual({ ok: true });

    const orgs: OrgRow[] = await listOrgs(sa);
    expect(orgs.some((o) => o.id === orgC.id || o.slug === orgC.slug)).toBe(false);
    // every id-addressed route now 404s
    await expectStatus(await sa.delete(`${SA}/orgs/${orgC.id}`), 404, "delete again");
    await expectStatus(await sa.post(`${SA}/orgs/${orgC.id}/suspend`, { data: { suspend: false } }), 404, "suspend");
    await expectStatus(await sa.patch(`${SA}/orgs/${orgC.id}`, { data: { name: "rgr-gone" } }), 404, "patch");
    await expectStatus(await sa.get(`${SA}/orgs/${orgC.id}/users`), 404, "users");
    await expectStatus(await sa.get(`${SA}/roles?orgId=${orgC.id}`), 404, "roles");

    // cascade proof: the org — and with it every org-scoped table's rows — is absent from the snapshot
    expect((await regressionSnapshot()).orgs[orgC.slug]).toBeUndefined();
    expect(await countProjectCalculations(orgC.id)).toBe(0);

    // the audit trail survives the org (org id + slug snapshot), one row per step
    const log = await auditLog(sa, { scope: "org", orgId: orgC.id, pageSize: 100 });
    const actions = log.entries.map((e) => e.action);
    expect(actions.filter((a) => a === "org.suspend")).toHaveLength(2);
    for (const a of ["org.create", "user.create", "org.update", "org.reactivate", "org.delete"]) expect(actions, a).toContain(a);
    expect(log.entries.find((e) => e.action === "org.delete")).toMatchObject({ verb: "DELETE", entity: orgC.slug, org: { id: orgC.id, slug: orgC.slug }, summary: "Organization deleted" });
    expect(log.facets.orgs).toContainEqual({ id: orgC.id, slug: orgC.slug });
  });
});

/** SA user management in this run's org B. */
test.describe("SuperAdmin org users (org B)", () => {
  async function orgBRoles(sa: Guarded, run: RunState): Promise<Record<string, RoleRow>> {
    const roles = (await json<{ roles: RoleRow[] }>(await sa.get(`${SA}/roles?orgId=${run.orgB.id}`))).roles;
    return Object.fromEntries(roles.map((r) => [r.name, r]));
  }
  async function listUsers(sa: Guarded, orgId: string): Promise<UserRow[]> {
    return (await json<{ users: UserRow[] }>(await sa.get(`${SA}/orgs/${orgId}/users`))).users;
  }
  /** SA-create an internal user in org B (ledgered kind user). */
  async function createOrgBUser(sa: Guarded, run: RunState, ledger: import("../fixtures/ledger").Ledger, extra: Record<string, unknown> = {}) {
    const roles = await orgBRoles(sa, run);
    const username = `${run.prefix}sau-${tag()}`;
    const r = await sa.post(`${SA}/orgs/${run.orgB.id}/users`, {
      data: { firstName: "  Rgr ", lastName: " User  ", username: `  ${username} `, roleId: roles["Company Member"].id, password: runPassword(), ...extra },
    });
    const text = await r.text();
    if (r.status() === 201) {
      const u = (JSON.parse(text) as { user: { id: string; username: string } }).user;
      ledger.add({ kind: "user", id: u.id, orgSlug: run.orgB.slug, label: u.username });
    }
    expect(r.status(), text).toBe(201);
    return { ...(JSON.parse(text) as { user: { id: string; username: string } }).user, roles };
  }

  test("GET lists org B's users A→Z with role, never a secret; external companies alongside; unknown org 404", async ({ sa, run }) => {
    const r = await sa.get(`${SA}/orgs/${run.orgB.id}/users`);
    const raw = await expectStatus(r, 200);
    expect(raw).not.toMatch(/password|hash/i);
    const body = JSON.parse(raw) as { users: UserRow[]; externalCompanies: { id: string; name: string }[]; seats: { limit: number; used: number } };
    expect(body.seats.limit).toBe(ORG_B_USER_LIMIT); // Stage 29: seats alongside the list
    expect(body.seats.used).toBe(body.users.length);
    expect(body.users.find((u) => u.username === "admin")).toMatchObject({ role: { name: "Admin" }, active: true });
    const names = body.users.map((u) => u.username);
    expect(names).toEqual([...names].sort());
    expect(Array.isArray(body.externalCompanies)).toBe(true);
    await expectStatus(await sa.get(`${SA}/orgs/${GHOST}/users`), 404);
  });

  test("POST creates a user (trimmed fields, optional contact data) that can sign in; audit user.create under org B", async ({ sa, run, ledger, playwright, baseURL }) => {
    test.setTimeout(180_000); // sign-ins retry on 429 (rate limit 3 / 10 s / IP, shared by all workers)
    const u = await createOrgBUser(sa, run, ledger, { mobile: "  +971 50 000 0000 ", profileEmail: " rgr@example.com " });
    expect(u.username).toBe(u.username.trim());
    expect((await listUsers(sa, run.orgB.id)).find((x) => x.id === u.id)).toEqual({
      id: u.id, username: u.username, firstName: "Rgr", lastName: "User", mobile: "+971 50 000 0000", profileEmail: "rgr@example.com", active: true,
      role: { id: u.roles["Company Member"].id, name: "Company Member" },
    });
    const ctx = await rawContext(playwright, baseURL);
    try {
      expect((await signIn(ctx, run.orgB.slug, u.username, runPassword())).status()).toBe(200);
    } finally {
      await ctx.dispose();
    }
    const log = await auditLog(sa, { scope: "org", orgId: run.orgB.id, item: "User", verb: "INSERT", pageSize: 100 });
    expect(log.entries.find((e) => e.targetId === u.id)).toMatchObject({ action: "user.create", entity: u.username, summary: "New user", org: { id: run.orgB.id } });
  });

  test("POST rules: required fields, password length, tenancy (role / company of another org), U3 company rule, duplicate, unknown org", async ({ sa, run, ledger, f }) => {
    const roles = await orgBRoles(sa, run);
    const testOrgRole = (await json<{ roles: RoleRow[] }>(await sa.get(`${SA}/roles?orgId=${run.testOrg.id}`))).roles.find((r) => r.name === "Company Member")!;
    const testOrgCompany = await f.externalCompany(); // a Test-Org row this test owns
    const existing = await createOrgBUser(sa, run, ledger);
    const ok = { firstName: "Rgr", lastName: "User", roleId: roles["Company Member"].id, password: runPassword() };
    const un = () => `${run.prefix}sau-x${tag()}`;
    const url = `${SA}/orgs/${run.orgB.id}/users`;
    const cases: Array<[string, Record<string, unknown>, number, string]> = [
      ["missing firstName", { ...ok, firstName: " ", username: un() }, 400, "firstName is required"],
      ["missing lastName", { ...ok, lastName: undefined, username: un() }, 400, "lastName is required"],
      ["missing username", { ...ok, username: "  " }, 400, "username is required"],
      ["missing roleId", { ...ok, roleId: "", username: un() }, 400, "roleId is required"],
      ["missing password", { ...ok, password: undefined, username: un() }, 400, "password is required"],
      ["short password", { ...ok, password: "short7!", username: un() }, 400, "password must be at least 8 characters"],
      ["Test-Org role", { ...ok, roleId: testOrgRole.id, username: un() }, 400, "roleId does not belong to this organization"],
      ["Test-Org company", { ...ok, roleId: roles.Distributor.id, externalCompanyId: testOrgCompany.id, username: un() }, 400, "externalCompanyId does not belong to this organization"],
      ["external role without company", { ...ok, roleId: roles["Architectural Firm"].id, username: un() }, 400, "External company is required for this role"],
      ["duplicate username", { ...ok, username: existing.username }, 409, `Username "${existing.username}" is already taken in this organization`],
    ];
    for (const [what, data, status, msg] of cases) {
      expect((await json<{ error: string }>(await sa.post(url, { data }), status, what)).error, what).toBe(msg);
    }
    const nj = await sa.post(url, { data: Buffer.from("{not json"), headers: { "Content-Type": "application/json" } });
    expect((await json<{ error: string }>(nj, 400)).error).toBe("Invalid JSON body");
    const ghost = new Guarded(sa.ctx, createAllowance([], [GHOST]), { Cookie: `qs-sa-token=${sa.token}` });
    await expectStatus(await ghost.post(`${SA}/orgs/${GHOST}/users`, { data: { ...ok, username: un() } }), 404, "unknown org");
    // nothing but `existing` was created
    expect((await listUsers(sa, run.orgB.id)).filter((u) => u.username.startsWith(`${run.prefix}sau-x`))).toEqual([]);
  });

  test("PATCH edits fields (trimmed; '' clears contact data) and reports changedFields; password reset revokes sessions", async ({ sa, run, ledger, playwright, baseURL }) => {
    test.setTimeout(180_000); // sign-ins retry on 429 (rate limit 3 / 10 s / IP, shared by all workers)
    const u = await createOrgBUser(sa, run, ledger, { mobile: "123", profileEmail: "a@b.c" });
    const url = `${SA}/orgs/${run.orgB.id}/users/${u.id}`;
    const r = await json<{ user: { id: string }; changedFields: string[] }>(await sa.patch(url, { data: { firstName: "  New ", lastName: " Name ", mobile: "", profileEmail: null, roleId: u.roles.Admin.id } }));
    expect(r).toEqual({ user: { id: u.id }, changedFields: ["firstName", "lastName", "mobile", "profileEmail", "roleId"] });
    expect((await listUsers(sa, run.orgB.id)).find((x) => x.id === u.id)).toMatchObject({ firstName: "New", lastName: "Name", mobile: null, profileEmail: null, role: { name: "Admin" } });

    const ctx = await rawContext(playwright, baseURL);
    try {
      expect((await signIn(ctx, run.orgB.slug, u.username, runPassword())).status()).toBe(200);
      const me = () => ctx.get(orgApi(run.orgB.slug, "/me"));
      expect((await me()).status()).toBe(200);
      const newPw = `${runPassword()}-Sa9`;
      expect(await json(await sa.patch(url, { data: { newPassword: newPw } }))).toEqual({ user: { id: u.id }, changedFields: ["password"] });
      expect((await me()).status()).toBe(401); // the user's sessions were revoked
      expect((await signIn(ctx, run.orgB.slug, u.username, runPassword())).status()).toBe(401);
      expect((await signIn(ctx, run.orgB.slug, u.username, newPw)).status()).toBe(200);
    } finally {
      await ctx.dispose();
    }
    // deactivate / reactivate round-trip
    expect((await json<{ changedFields: string[] }>(await sa.patch(url, { data: { active: false } }))).changedFields).toEqual(["active"]);
    expect((await listUsers(sa, run.orgB.id)).find((x) => x.id === u.id)?.active).toBe(false);
    expect((await json<{ changedFields: string[] }>(await sa.patch(url, { data: { active: true } }))).changedFields).toEqual(["active"]);

    const log = await auditLog(sa, { scope: "org", orgId: run.orgB.id, item: "User", verb: "UPDATE", pageSize: 100 });
    const rows = log.entries.filter((e) => e.targetId === u.id);
    expect(rows.length).toBe(4);
    expect(JSON.stringify(rows).includes(runPassword()), "the password appears in the audit rows").toBe(false); // boolean: a failure never prints the secret
    expect(rows.some((e) => e.summary === "Changed password")).toBe(true);
  });

  test("PATCH rules: username immutable, empty / wrong-typed fields, other-org role, U3, unknown user, another org's user → 400/404", async ({ sa, run, ledger, f }) => {
    const u = await createOrgBUser(sa, run, ledger);
    const testOrgRole = (await json<{ roles: RoleRow[] }>(await sa.get(`${SA}/roles?orgId=${run.testOrg.id}`))).roles.find((r) => r.name === "Company Member")!;
    const url = `${SA}/orgs/${run.orgB.id}/users/${u.id}`;
    const cases: Array<[string, unknown, number, string]> = [
      ["username", { username: `${run.prefix}renamed` }, 400, "username cannot be changed"],
      ["nothing editable", { bogus: 1 }, 400, "At least one editable field must be provided"],
      ["blank firstName", { firstName: "  " }, 400, "firstName must be a non-empty string"],
      ["numeric lastName", { lastName: 5 }, 400, "lastName must be a non-empty string"],
      ["numeric mobile", { mobile: 5 }, 400, "mobile must be a string or null"],
      ["blank roleId", { roleId: " " }, 400, "roleId must be a non-empty string"],
      ["string active", { active: "yes" }, 400, "active must be a boolean"],
      ["short newPassword", { newPassword: "short7!" }, 400, "newPassword must be at least 8 characters"],
      ["array body", [], 400, "Request body must be a JSON object"],
      ["Test-Org role", { roleId: testOrgRole.id }, 400, "roleId does not belong to this organization"],
      ["external role, no company", { roleId: u.roles.Distributor.id }, 400, "This role requires an external company, and this user has none"],
    ];
    for (const [what, data, status, msg] of cases) {
      expect((await json<{ error: string }>(await sa.patch(url, { data }), status, what)).error, what).toBe(msg);
    }
    await expectStatus(await sa.patch(`${SA}/orgs/${run.orgB.id}/users/${GHOST}`, { data: { firstName: "x" } }), 404, "unknown user");
    // a Test-Org user (this test's own) addressed under org B: 404, and it is unchanged
    const mine = await f.user("member");
    await expectStatus(await sa.patch(`${SA}/orgs/${run.orgB.id}/users/${mine.id}`, { data: { firstName: "rgr-hijacked" } }), 404, "foreign user");
    expect((await listUsers(sa, run.orgB.id)).find((x) => x.id === u.id)).toMatchObject({ firstName: "Rgr", lastName: "User", role: { name: "Company Member" }, active: true });
  });

  test("DELETE removes the user (200 { deleted: true }), then 404; another org's user is out of reach; audit user.delete", async ({ sa, run, ledger, f, as, url }) => {
    const u = await createOrgBUser(sa, run, ledger);
    const del = `${SA}/orgs/${run.orgB.id}/users/${u.id}`;
    expect(await json(await sa.delete(del))).toEqual({ deleted: true });
    expect((await listUsers(sa, run.orgB.id)).some((x) => x.id === u.id)).toBe(false);
    await expectStatus(await sa.delete(del), 404, "again");

    const mine = await f.user("member"); // Test-Org row this test owns
    await expectStatus(await sa.delete(`${SA}/orgs/${run.orgB.id}/users/${mine.id}`), 404, "foreign user");
    expect((await as.admin.get(url(`/users/${mine.id}`))).status()).toBe(200); // still there

    const log = await auditLog(sa, { scope: "org", orgId: run.orgB.id, item: "User", verb: "DELETE", pageSize: 100 });
    expect(log.entries.find((e) => e.targetId === u.id)).toMatchObject({ action: "user.delete", entity: u.username, summary: "User deleted" });
  });
});
