/**
 * SuperAdmin formula sets (Task 11, Step 2).
 *
 * Formula sets are PLATFORM-GLOBAL rows. The suite only ever writes sets it created itself, named
 * `rgr-<runId>-fs-…` (the plan's `rgr-fs-*` would lose the run id that orphan recovery's age gate and the
 * teardown stray check key on), ledgered (kind formulaSet) the moment the 201 arrives; the Cleaner deletes
 * them (refusing any live name that is not rgr-), and teardown reports any of this run's sets still present.
 * The seeded set is only READ. Assignment goes to a throwaway org F this run creates, through
 * withRecordedGlobalState on THAT org's activeFormulaSetId — own org, but the wrapper still proves the revert.
 */
import { covers } from "../fixtures/covers";
import { Guarded, createAllowance } from "../fixtures/clients";
import { globalStateFailuresFile, withRecordedGlobalState } from "../fixtures/global-state";
import {
  test, expect, SA, GHOST, SA_USER, tag, expectStatus, json, auditLog, listOrgs, seededBody, postFormulaSet, ledgerFormulaSet,
  createThrowawayOrg, type FormulaSetDetail,
} from "./sa-helpers";

covers("GET /api/v1/superadmin/formula-sets");
covers("POST /api/v1/superadmin/formula-sets");
covers("GET /api/v1/superadmin/formula-sets/[setId]");
covers("PATCH /api/v1/superadmin/formula-sets/[setId]");
covers("DELETE /api/v1/superadmin/formula-sets/[setId]");
covers("POST /api/v1/superadmin/formula-sets/[setId]/version");

type ListItem = Omit<FormulaSetDetail, "body" | "updatedAt">;
const UNUSED = { orgCount: 0, projectCount: 0, calculationCount: 0 };

async function list(sa: Guarded): Promise<ListItem[]> {
  return (await json<{ formulaSets: ListItem[] }>(await sa.get(`${SA}/formula-sets`))).formulaSets;
}
async function detail(sa: Guarded, id: string): Promise<FormulaSetDetail> {
  return (await json<{ formulaSet: FormulaSetDetail }>(await sa.get(`${SA}/formula-sets/${id}`))).formulaSet;
}

test.describe("SuperAdmin formula sets", () => {
  test.describe.configure({ mode: "serial" });

  let name = "";
  let v1: FormulaSetDetail;
  let v2: FormulaSetDetail;

  test("GET list: newest first, no body, lock state; the seeded set (org B's) and the Test Org's set are listed locked", async ({ sa, run }) => {
    const sets = await list(sa);
    for (let i = 1; i < sets.length; i++) expect(sets[i - 1].createdAt >= sets[i].createdAt).toBe(true);
    for (const s of sets) {
      expect(s).not.toHaveProperty("body");
      expect(s.locked).toBe(s.inUseBy.orgCount + s.inUseBy.projectCount + s.inUseBy.calculationCount > 0);
    }
    const seeded = sets.find((s) => s.id === run.formulaSetId)!; // org B was created on it
    expect(seeded.locked).toBe(true);
    expect(seeded.inUseBy.orgCount).toBeGreaterThanOrEqual(1);
    // the Test Org's active set (not necessarily the newest seeded version) is listed as locked too
    const testOrgSet = (await listOrgs(sa)).find((o) => o.id === run.testOrg.id)!.activeFormulaSetId!;
    expect(sets.find((s) => s.id === testOrgSet)?.locked).toBe(true);
    const d = await detail(sa, run.formulaSetId);
    expect(d).toMatchObject({ id: seeded.id, name: seeded.name, version: seeded.version, locked: true });
    expect(typeof d.body).toBe("object");
    expect((await json<{ error: string }>(await sa.get(`${SA}/formula-sets/${GHOST}`), 404)).error).toBe("FormulaSet not found");
  });

  test("POST rules: name / body shape / body validation → 400 (validationErrors listed); nothing created", async ({ sa, run }) => {
    const bad = `${run.prefix}fsbad`;
    // name rules are probed with body: null, so a broken name rule still fails on the body check (no row)
    const cases: Array<[string, unknown, string]> = [
      ["missing name", { body: null }, "name is required"],
      ["blank name", { name: "   ", body: null }, "name is required"],
      ["numeric name", { name: 5, body: null }, "name is required"],
      ["missing body", { name: bad }, "body must be a non-null object"],
      ["null body", { name: bad, body: null }, "body must be a non-null object"],
      ["array body", { name: bad, body: [] }, "body must be a non-null object"],
      ["string body", { name: bad, body: "x" }, "body must be a non-null object"],
    ];
    for (const [what, data, msg] of cases) {
      expect((await json<{ error: string }>(await sa.post(`${SA}/formula-sets`, { data }), 400, what)).error, what).toBe(msg);
    }
    const invalid = await json<{ error: string; validationErrors: unknown[] }>(await sa.post(`${SA}/formula-sets`, { data: { name: bad, body: {} } }), 400);
    expect(invalid.error).toBe("Validation failed");
    expect(invalid.validationErrors.length).toBeGreaterThan(0);
    const nj = await sa.post(`${SA}/formula-sets`, { data: Buffer.from("{not json"), headers: { "Content-Type": "application/json" } });
    expect((await json<{ error: string }>(nj, 400)).error).toBe("Invalid JSON body");
    expect((await list(sa)).filter((s) => s.name.startsWith(bad))).toEqual([]);
  });

  test("POST creates v1 (name trimmed, a sent `version` ignored, unlocked); the same name again becomes v2; audit INSERT at platform scope", async ({ sa, run, ledger }) => {
    name = `${run.prefix}fs-${tag()}`;
    const body = await seededBody(sa, run);
    const r1 = await postFormulaSet(sa, ledger, { name: `  ${name}  `, body, version: 7 });
    v1 = (await json<{ formulaSet: FormulaSetDetail }>(r1, 201)).formulaSet;
    expect(v1).toMatchObject({ name, version: 1, locked: false, inUseBy: UNUSED, publishedAt: null });
    expect(v1.body).toEqual(body);
    expect(await detail(sa, v1.id)).toEqual(v1);
    v2 = (await json<{ formulaSet: FormulaSetDetail }>(await postFormulaSet(sa, ledger, { name, body }), 201)).formulaSet;
    expect(v2).toMatchObject({ name, version: 2 });
    const sets = await list(sa);
    expect(sets.findIndex((s) => s.id === v2.id)).toBeLessThan(sets.findIndex((s) => s.id === v1.id)); // newest first

    const log = await auditLog(sa, { scope: "platform", item: "Formula set", verb: "INSERT", by: SA_USER(), pageSize: 100 });
    expect(log.entries.find((e) => e.targetId === v1.id)).toMatchObject({ action: "formulaSet.create", entity: `${name} v1`, org: null });
    expect(log.entries.find((e) => e.targetId === v2.id)).toMatchObject({ action: "formulaSet.create", entity: `${name} v2` });
  });

  test("POST /version copies the body to max(version)+1 (v3); a name override forks a new family at v1; unknown source → 404", async ({ sa, run, ledger }) => {
    const r = await sa.post(`${SA}/formula-sets/${v1.id}/version`, { data: {} });
    const v3 = (await json<{ formulaSet: FormulaSetDetail }>(r, 201)).formulaSet;
    ledgerFormulaSet(sa, ledger, v3);
    expect(v3).toMatchObject({ name, version: 3, locked: false, inUseBy: UNUSED });
    expect(v3.body).toEqual(v1.body);

    const forkName = `${run.prefix}fs-fork-${tag()}`;
    const f = await sa.post(`${SA}/formula-sets/${v2.id}/version`, { data: { name: `  ${forkName} ` } });
    const fork = (await json<{ formulaSet: FormulaSetDetail }>(f, 201)).formulaSet;
    ledgerFormulaSet(sa, ledger, fork);
    expect(fork).toMatchObject({ name: forkName, version: 1 });

    // an absent / non-JSON body is fine (no override)
    const nb = await sa.post(`${SA}/formula-sets/${v1.id}/version`, { data: Buffer.from("not json"), headers: { "Content-Type": "application/json" } });
    const v4 = (await json<{ formulaSet: FormulaSetDetail }>(nb, 201)).formulaSet;
    ledgerFormulaSet(sa, ledger, v4);
    expect(v4).toMatchObject({ name, version: 4 });

    const ghost = new Guarded(sa.ctx, createAllowance([], [GHOST]), { Cookie: `qs-sa-token=${sa.token}` });
    expect((await json<{ error: string }>(await ghost.post(`${SA}/formula-sets/${GHOST}/version`, { data: {} }), 404)).error).toBe("FormulaSet not found");

    const log = await auditLog(sa, { scope: "platform", item: "Formula set", verb: "INSERT", pageSize: 100 });
    expect(log.entries.find((e) => e.targetId === v3.id)).toMatchObject({ action: "formulaSet.newVersion", entity: `${name} v3` });
  });

  test("PATCH an unused set: name / version / body → 200; rules 400; (name, version) collision → 409; unknown → 404; audit UPDATE", async ({ sa, run }) => {
    const url = `${SA}/formula-sets/${v2.id}`;
    const renamed = `${name}-r`;
    expect((await json<{ formulaSet: FormulaSetDetail }>(await sa.patch(url, { data: { name: `  ${renamed} ` } }))).formulaSet).toMatchObject({ name: renamed, version: 2 });
    expect((await json<{ formulaSet: FormulaSetDetail }>(await sa.patch(url, { data: { version: 9 } }))).formulaSet).toMatchObject({ name: renamed, version: 9 });
    expect((await json<{ formulaSet: FormulaSetDetail }>(await sa.patch(url, { data: { body: v1.body } }))).formulaSet.body).toEqual(v1.body);

    const cases: Array<[string, unknown, string]> = [
      ["nothing to change", { bogus: 1 }, "At least one field (name, version, body) must be provided"],
      ["blank name", { name: " " }, "name must be a non-empty string"],
      ["version 0", { version: 0 }, "version must be a positive integer"],
      ["version 1.5", { version: 1.5 }, "version must be a positive integer"],
      ["version '2'", { version: "2" }, "version must be a positive integer"],
      ["null body", { body: null }, "body must be a non-null object"],
    ];
    for (const [what, data, msg] of cases) {
      expect((await json<{ error: string }>(await sa.patch(url, { data }), 400, what)).error, what).toBe(msg);
    }
    expect((await json<{ error: string }>(await sa.patch(url, { data: { body: {} } }), 400)).error).toBe("Validation failed");
    // moving v2 (now "<name>-r" v9) onto v1's exact (name, version) collides
    expect((await json<{ error: string }>(await sa.patch(url, { data: { name, version: 1 } }), 409)).error).toBe("A formula set with this name and version already exists");
    const ghost = new Guarded(sa.ctx, createAllowance([], [GHOST]), { Cookie: `qs-sa-token=${sa.token}` });
    expect((await json<{ error: string }>(await ghost.patch(`${SA}/formula-sets/${GHOST}`, { data: { name: `${run.prefix}x` } }), 404)).error).toBe("FormulaSet not found");
    expect(await detail(sa, v2.id)).toMatchObject({ name: renamed, version: 9 }); // the rejects changed nothing

    const log = await auditLog(sa, { item: "Formula set", verb: "UPDATE", pageSize: 100 });
    expect(log.entries.filter((e) => e.targetId === v2.id && e.action === "formulaSet.update")).toHaveLength(3);
  });

  test("assigned to throwaway org F (withRecordedGlobalState): locked — PATCH / DELETE 409 with inUseBy; revert proven; then DELETE 200 → 404; audit", async ({ sa, run, ledger }) => {
    test.setTimeout(150_000);
    const orgF = await createThrowawayOrg(sa, { run, ledger }, "f");
    const spec = {
      key: `org ${orgF.slug}.activeFormulaSetId`,
      read: async () => (await listOrgs(sa)).find((o) => o.id === orgF.id)?.activeFormulaSetId ?? null,
      write: async (v: unknown) => {
        await expectStatus(await sa.patch(`${SA}/orgs/${orgF.id}`, { data: { formulaSetId: v } }), 200, "revert assignment");
      },
    };
    await withRecordedGlobalState(
      spec,
      async () => {
        const r = await json<{ org: { activeFormulaSetId: string; formulaSetLabel: string }; warnings: unknown[] }>(await sa.patch(`${SA}/orgs/${orgF.id}`, { data: { formulaSetId: v1.id } }));
        expect(r.org).toMatchObject({ activeFormulaSetId: v1.id, formulaSetLabel: `${name} v1` });
        expect(r.warnings).toEqual([]); // same body as the seeded set → structurally compatible
      },
      async () => {
        expect(await detail(sa, v1.id)).toMatchObject({ locked: true, inUseBy: { orgCount: 1, projectCount: 0, calculationCount: 0 } });
        expect((await list(sa)).find((s) => s.id === v1.id)?.locked).toBe(true);
        const del = await json<{ error: string; inUseBy: unknown }>(await sa.delete(`${SA}/formula-sets/${v1.id}`), 409);
        expect(del).toEqual({ error: "Formula set is in use and cannot be deleted", inUseBy: { orgCount: 1, projectCount: 0, calculationCount: 0 } });
        const edit = await json<{ error: string; inUseBy: unknown }>(await sa.patch(`${SA}/formula-sets/${v1.id}`, { data: { name: `${name}-locked` } }), 409);
        expect(edit).toEqual({ error: "Formula set is in use and cannot be edited", inUseBy: { orgCount: 1, projectCount: 0, calculationCount: 0 } });
        expect((await detail(sa, v1.id)).name).toBe(name);
      },
      globalStateFailuresFile(run.storageDir),
    );
    expect(await spec.read()).toBe(run.formulaSetId); // back on the seeded set
    expect(await detail(sa, v1.id)).toMatchObject({ locked: false, inUseBy: UNUSED });

    expect(await json(await sa.delete(`${SA}/formula-sets/${v1.id}`))).toEqual({ id: v1.id });
    expect((await json<{ error: string }>(await sa.get(`${SA}/formula-sets/${v1.id}`), 404)).error).toBe("FormulaSet not found");
    expect((await json<{ error: string }>(await sa.delete(`${SA}/formula-sets/${v1.id}`), 404)).error).toBe("FormulaSet not found");
    expect((await list(sa)).some((s) => s.id === v1.id)).toBe(false);

    const del = await auditLog(sa, { item: "Formula set", verb: "DELETE", pageSize: 100 });
    expect(del.entries.find((e) => e.targetId === v1.id)).toMatchObject({ action: "formulaSet.delete", entity: `${name} v1` });
    const orgLog = await auditLog(sa, { scope: "org", orgId: orgF.id, verb: "UPDATE", pageSize: 100 });
    expect(orgLog.entries.filter((e) => e.action === "org.update").map((e) => (e.details as { formulaSetId?: string }).formulaSetId).sort()).toEqual([run.formulaSetId, v1.id].sort());
  });
});
