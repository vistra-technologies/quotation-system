/**
 * J6 — a formula set's life, seen from the projects that use it. A SuperAdmin authors a set (a copy of the
 * Test Org's cloisons body), assigns it to this run's own throwaway org, drafts a new VERSION that changes the
 * profileL / profileI formulas, assigns that — and the journey follows what the org's projects compute:
 *
 *   - a project pinned to v1 keeps computing v1 after v2 is assigned (Recompute does not re-pin);
 *   - "Update configuration" re-pins it to v2 (and drops its calculation); re-submit + Recompute compute v2;
 *   - a project created while v2 is active pins v2 directly;
 *   - the assignment is reverted inside withRecordedGlobalState (verified read-back) — the org is back on the
 *     seeded set; the sets stay locked while the org's projects pin them, and are deleted once the org is gone.
 *
 * Expected numbers: the transom-door wall and both formula variants are tests/unit/materials-evaluate.test.ts's
 * "formula set v2: transom door removes L/I" case, copied verbatim (V2_QUANTITY and its v1 / v2 requirements).
 * Assignment only ever touches this run's own throwaway org (rgr- slug, ledgered); the Test Org's active set is
 * only READ.
 */
import { test, expect, SA, createThrowawayOrg, hardDeleteOrg, json, ledgerFormulaSet, listOrgs, postFormulaSet, type FormulaSetDetail } from "../api/sa-helpers";
import { Guarded, createAllowance } from "../fixtures/clients";
import { globalStateFailuresFile, withRecordedGlobalState } from "../fixtures/global-state";
import { orgApi } from "../api/project-helpers";
import { runPassword, signIn } from "../api/sign-in";
import { doorCfg, expectLines, glassCfg, makeItemSet, orgItems, readCalc, type Calculation } from "../engine/materials";
import { PLAIN, addSelection, buildRoom, designOf, typeIdIn, wallOf } from "./journey-helpers";

// materials-evaluate.test.ts, "cloisons formula set v2: no L/I profile or white seal above a transom door":
const V2_QUANTITY = "(partition.widthMm + partition.heightMm*(partition.leftWallLike + partition.rightWallLike) - partition.doorWidthMm) / 1000";
const V1_EXPECT = { profileL: 10, whiteSeal: 14 }; // "v1 baseline: transom door leaves L/I untouched"
const V2_EXPECT = { profileL: 9.1, profileI: 9.1, profileU: 4, whiteSeal: 13.1, acousticGasket: 26.2 };

type Body = { formulas: Array<{ id: string; quantity: string }> } & Record<string, unknown>;

test("J6: formula set author → assign → new version → assign → what pinned / re-pinned / new projects compute → revert", async ({ sa, run, ledger, playwright, baseURL }) => {
  test.setTimeout(420_000);

  // ── author v1: a copy of the Test Org's active (cloisons) body — READ only ────
  const testOrgRow = (await listOrgs(sa)).find((o) => o.slug === run.testOrg.slug)!;
  const source = (await json<{ formulaSet: FormulaSetDetail }>(await sa.get(`${SA}/formula-sets/${testOrgRow.activeFormulaSetId}`))).formulaSet;
  expect(`${source.name} v${source.version}`, "the copied tuples belong to cloisons v1").toBe("cloisons_formula_set v1");
  const name = `${run.prefix}fs-j6-${Date.now().toString(36)}`;
  const r1 = await postFormulaSet(sa, ledger, { name, body: source.body });
  const v1 = (await json<{ formulaSet: FormulaSetDetail }>(r1, 201)).formulaSet;
  expect(v1).toMatchObject({ name, version: 1, locked: false });

  const org = await createThrowawayOrg(sa, { run, ledger }, "k");
  const B = (p: string) => orgApi(org.slug, p);
  const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {} });
  let v2: FormulaSetDetail | undefined;
  try {
    expect((await signIn(ctx, org.slug, "admin", runPassword())).status()).toBe(200);
    const admin = new Guarded(ctx, createAllowance([org.slug], [org.id]));
    const glass = await makeItemSet(orgItems(admin, org.slug), run.prefix, "GLASS", "j6g");
    const door = await makeItemSet(orgItems(admin, org.slug), run.prefix, "DOOR", "j6d");
    // Make the items real dropdown choices of the org's (own, throwaway) configuration: "Update configuration"
    // re-validates every saved component against the org's option lists and refuses values outside them.
    const allowCodes = async (code: "GLASS" | "DOOR", parent: string, codes: Record<string, string>) => {
      const id = await typeIdIn(admin, org.slug, code);
      const path = B(`/component-types/${id}/field-values`);
      type Cfg = Record<string, { options?: string[]; valueMap?: Record<string, string[]> }>;
      const cfg = structuredClone((await json<{ componentType: { fieldOptionsConfig: Cfg | null } }>(await admin.get(path))).componentType.fieldOptionsConfig ?? {});
      for (const [field, value] of Object.entries(codes)) {
        const vm = (cfg[field] ??= {}).valueMap ??= {};
        vm[parent] = [...new Set([...(vm[parent] ?? []), value])];
      }
      await json(await admin.put(path, { data: { fieldOptionsConfig: cfg } }));
    };
    await allowCodes("GLASS", "ID1", glass.codes); // the code fields depend on glassType
    await allowCodes("DOOR", "Simple Glass", door.codes); // … and on doorType
    /** A 4000 × 3000 wall/wall wall with the unit test's transom-door design; returns the project id. */
    const transomProject = async (label: string) => {
      const p = await json<{ project: { id: string; formulaSetId: string } }>(await admin.post(B("/projects"), { data: { name: `${run.prefix}j6-${label}`, currency: "AED", projectLocation: "Dubai UAE" } }), 201);
      const { partitionIds: [w] } = await buildRoom(admin, org.slug, run.prefix, p.project.id, [wallOf(4000, 3000), PLAIN, PLAIN, PLAIN]);
      const gs = await addSelection(admin, org.slug, p.project.id, "GLASS", `${run.prefix}J6 Glass`, glassCfg(glass));
      const ds = await addSelection(admin, org.slug, p.project.id, "DOOR", `${run.prefix}J6 Door`, doorCfg(door));
      const design = designOf([[1033, [[3000, gs]]], [900, [[1000, gs], [2000, ds]]], [1033, [[3000, gs]]], [1034, [[3000, gs]]]]);
      await json(await admin.patch(B(`/partitions/${w}`), { data: { heightMm: 3000, design } }));
      return p.project;
    };
    const submit = async (projectId: string): Promise<Calculation> => {
      await json(await admin.post(B(`/projects/${projectId}/submit-design`)));
      return readCalc(admin, org.slug, projectId);
    };
    const recompute = async (projectId: string): Promise<Calculation> => {
      await json(await admin.post(B(`/projects/${projectId}/recompute`)));
      return readCalc(admin, org.slug, projectId);
    };
    const assign = async (id: string) => {
      const r = await json<{ org: { activeFormulaSetId: string; formulaSetLabel: string }; warnings: unknown[] }>(await sa.patch(`${SA}/orgs/${org.id}`, { data: { formulaSetId: id } }));
      expect(r.warnings, "the authored set is structurally compatible with the org's starter catalog").toEqual([]);
      return r.org;
    };

    const spec = {
      key: `org ${org.slug}.activeFormulaSetId`,
      read: async () => (await listOrgs(sa)).find((o) => o.id === org.id)?.activeFormulaSetId ?? null,
      write: async (v: unknown) => {
        await json(await sa.patch(`${SA}/orgs/${org.id}`, { data: { formulaSetId: v } }));
      },
    };
    let pinned = "";
    await withRecordedGlobalState(
      spec,
      async () => {
        expect(await assign(v1.id)).toMatchObject({ activeFormulaSetId: v1.id, formulaSetLabel: `${name} v1` });
      },
      async () => {
        // a project created now pins v1 and computes the v1 tuple
        const p1 = await transomProject("p1");
        pinned = p1.id;
        expect(p1.formulaSetId).toBe(v1.id);
        const k1 = await submit(p1.id);
        expect(k1.formulaSet).toEqual({ name, version: 1 });
        expectLines(k1.materialList, glass, V1_EXPECT, "v1");

        // new version (draft, body copied) → change profileL / profileI exactly as the unit test's v2
        const rv = await sa.post(`${SA}/formula-sets/${v1.id}/version`, { data: {} });
        v2 = (await json<{ formulaSet: FormulaSetDetail }>(rv, 201)).formulaSet;
        ledgerFormulaSet(sa, ledger, v2);
        expect(v2).toMatchObject({ name, version: 2, locked: false });
        expect(v2.body).toEqual(v1.body);
        const body = structuredClone(v2.body) as Body;
        for (const f of body.formulas) if (f.id === "profileL" || f.id === "profileI") f.quantity = V2_QUANTITY;
        await json(await sa.patch(`${SA}/formula-sets/${v2.id}`, { data: { body } }));
        expect(await assign(v2.id)).toMatchObject({ activeFormulaSetId: v2.id, formulaSetLabel: `${name} v2` });

        // the pinned project does not move: Recompute still computes v1
        const k1r = await recompute(p1.id);
        expect(k1r.formulaSet, "Recompute uses the project's pinned set").toEqual({ name, version: 1 });
        expect(k1r.materialList).toEqual(k1.materialList);

        // Update configuration offers — and applies — the formula change; it drops the calculation
        const prev = await json<{ needsUpdate: boolean; formula: { changed: boolean; from: string; to: string; problem: string | null } }>(await admin.get(B(`/projects/${p1.id}/config-update`)));
        expect(prev.needsUpdate).toBe(true);
        expect(prev.formula).toEqual({ changed: true, from: `${name} v1`, to: `${name} v2`, problem: null });
        expect(await json(await admin.post(B(`/projects/${p1.id}/config-update`), { data: {} }))).toEqual({ ok: true, updatedSelections: 0 });
        expect((await admin.get(B(`/projects/${p1.id}/calculation`))).status(), "re-pinning drops the old calculation").toBe(404);
        expect((await json<{ project: { formulaSetId: string; designSubmittedAt: string | null } }>(await admin.get(B(`/projects/${p1.id}`)))).project).toMatchObject({ formulaSetId: v2!.id, designSubmittedAt: null });

        // re-submit → v2; Recompute → the same v2 list, later computedAt
        const k2 = await submit(p1.id);
        expect(k2.formulaSet).toEqual({ name, version: 2 });
        expectLines(k2.materialList, glass, V2_EXPECT, "v2");
        const k2r = await recompute(p1.id);
        expect(k2r.materialList).toEqual(k2.materialList);
        expect(Date.parse(k2r.computedAt)).toBeGreaterThan(Date.parse(k2.computedAt));

        // a project created while v2 is active pins v2 directly
        const p2 = await transomProject("p2");
        expect(p2.formulaSetId).toBe(v2!.id);
        expectLines((await submit(p2.id)).materialList, glass, V2_EXPECT, "new project on v2");

        // lock state follows the pins: v1 lost its org (→ v2) and its only project (re-pinned) → unlocked;
        // v2 is held by the org and both projects + their calculations
        const detail = async (id: string) => (await json<{ formulaSet: FormulaSetDetail }>(await sa.get(`${SA}/formula-sets/${id}`))).formulaSet;
        expect(await detail(v1.id)).toMatchObject({ locked: false, inUseBy: { orgCount: 0, projectCount: 0, calculationCount: 0 } });
        expect(await detail(v2!.id)).toMatchObject({ locked: true, inUseBy: { orgCount: 1, projectCount: 2, calculationCount: 2 } });
      },
      globalStateFailuresFile(run.storageDir),
    );
    expect(await spec.read(), "assignment reverted to the seeded set").toBe(run.formulaSetId);
    // a revert never rewrites pins: the org's projects keep v2 → v2 stays undeletable; the unused v1 deletes
    expect(await json(await sa.delete(`${SA}/formula-sets/${v2!.id}`), 409)).toEqual({
      error: "Formula set is in use and cannot be deleted",
      inUseBy: { orgCount: 0, projectCount: 2, calculationCount: 2 },
    });
    expect((await json<{ project: { formulaSetId: string } }>(await admin.get(B(`/projects/${pinned}`)))).project.formulaSetId).toBe(v2!.id);
    expect(await json(await sa.delete(`${SA}/formula-sets/${v1.id}`))).toEqual({ id: v1.id });
    ledger.remove(v1.id);
  } finally {
    await ctx.dispose();
  }

  // the org (and with it every pin) goes; then v2 can go too
  await hardDeleteOrg(sa, org.id);
  ledger.remove(org.id);
  expect(await json(await sa.delete(`${SA}/formula-sets/${v2!.id}`))).toEqual({ id: v2!.id });
  ledger.remove(v2!.id);
  expect((await sa.get(`${SA}/formula-sets/${v2!.id}`)).status()).toBe(404);
});
