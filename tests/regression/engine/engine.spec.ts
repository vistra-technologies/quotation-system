/**
 * Calculation engine, end to end (Task 13): known floor / room / partition inputs → POST submit-design →
 * GET calculation → exact material-list quantities and units.
 *
 * SOURCE OF TRUTH — no expected number here is invented. Every requirement is copied from a verified
 * {input, expected} tuple of
 *   - tests/unit/materials-evaluate.test.ts  (door.md worked examples; partition.md Scenario 1 in all three
 *     adjacency columns; full-height vs transom door; corner-door doorConnector), and
 *   - tests/e2e/stage24-materials.spec.ts    (A2 door 2 m × 3 m, A3 wall/wall 4 m × 3 m — including the
 *     quantities, computed with the cloisons perUnit values that engine/materials.ts reproduces),
 *   - tests/e2e/hotfix-2026-10-01-h2-h5.spec.ts (H-3: a double-leaf door is one "LH + RH" summary row).
 * The inputs are the same geometry/topology; only the inventory codes are this run's own (rgr-, ledgered).
 * Quantities not stated in those tuples are checked against the engine's own rule, ceil(requirement /
 * perUnitQuantity) (lib/materials/resolve.ts), not against literals.
 *
 * Those tuples belong to the CLOISONS formula set v1 (profileL/profileI subtract doorWidthMmFullHeight). The
 * Test Org runs it; every case first asserts the calculation's pinned set is that one, so a changed Test-Org
 * formula set fails with one clear message instead of dozens of wrong numbers.
 *
 * Topology. The unit tuples use a closed room [PLAIN, p1, PLAIN] (wall/wall), [PLAIN, p1, p2] (p1 = wall/
 * partition) and [p1, p2, p3] (p2 = partition/partition). The live rooms here are closed 4-sided rectangles
 * with the same neighbours for the partition under test: [p1, PLAIN, PLAIN, PLAIN], [PLAIN, p1, p2, PLAIN] and
 * [p1, p2, p3, PLAIN]. The calculation API returns the project-wide material list (lines aggregated by code;
 * materialByRoom is never served), so the partition under test gets its OWN GLASS selection with its own item
 * set — its lines are exactly its own.
 *
 * Problems: INACTIVE_ITEM / UNRESOLVED_CODE / UNIT_MISMATCH are produced with this run's own items (never a
 * shared or seeded one). "Missing price" is not a problem kind (lib/materials/problems.ts) and the formula
 * engine never reads ItemPrice — pinned as such below.
 */
import { test, expect } from "../fixtures/test";
import type { Guarded } from "../fixtures/clients";
import type { Factories } from "../fixtures/factories";
import type { RunState } from "../fixtures/run-state";
import { orgApi } from "../api/project-helpers";
import { allowTestOrgCodes } from "../fixtures/test-org-codes";
import { rgrSetSelectionConfig } from "../../e2e/db-helpers";
import {
  codesOf, doorCfg, expectLines, glassCfg, makeItemSet, readCalc, refused, testOrgItems,
  type Calculation, type ItemSet,
} from "./materials";

test.setTimeout(180_000);

/** The formula set the copied tuples were verified against. */
const TUPLE_SET = { name: "cloisons_formula_set", version: 1 };

type C = { as: Record<"admin", Guarded>; f: Factories; run: RunState };
const U = (c: C, p: string) => orgApi(c.run.testOrg.slug, p);

/** Per-worker item sets (a rejected creation is retried by the next caller). */
const memo = new Map<string, Promise<ItemSet>>();
function itemSet(c: C, key: string, kind: "GLASS" | "DOOR"): Promise<ItemSet> {
  let p = memo.get(key);
  if (!p) {
    p = makeItemSet(testOrgItems(c.f), c.run.prefix, kind, `eng${key}`);
    memo.set(key, p);
    p.catch(() => memo.delete(key));
  }
  return p;
}

const typeIds = new Map<string, string>();
async function typeId(c: C, code: string): Promise<string> {
  if (!typeIds.has(code)) {
    const r = await c.as.admin.get(U(c, "/component-types"));
    expect(r.status()).toBe(200);
    for (const t of ((await r.json()) as { componentTypes: { id: string; code: string }[] }).componentTypes) typeIds.set(t.code, t.id);
  }
  const id = typeIds.get(code);
  if (!id) throw new Error(`Test Org has no ComponentType ${code}`);
  return id;
}

async function selection(c: C, projectId: string, code: "GLASS" | "DOOR", config: Record<string, string>): Promise<string> {
  const r = await c.as.admin.post(U(c, "/selections"), {
    data: { projectId, componentTypeId: await typeId(c, code), label: `${c.run.prefix}${code}`, config, orderIndex: 0 },
  });
  expect(r.status(), await r.text()).toBe(201);
  return ((await r.json()) as { selection: { id: string } }).selection.id;
}

type SideIn = { kind: "PLAIN" } | { kind: "PARTITION"; widthMm: number; heightMm: number };
const PLAIN = { kind: "PLAIN" } as const;
const wall = (widthMm: number, heightMm: number): SideIn => ({ kind: "PARTITION", widthMm, heightMm });

/** A ledgered project with one floor and one closed 4-sided room; returns the partition ids in side order. */
async function project(c: C, sides: SideIn[]): Promise<{ projectId: string; partitionIds: string[] }> {
  const { id: projectId } = await c.f.project();
  const fl = await c.as.admin.post(U(c, "/floors"), { data: { projectId, label: `${c.run.prefix}F` } });
  expect(fl.status(), await fl.text()).toBe(201);
  const floorId = ((await fl.json()) as { floor: { id: string } }).floor.id;
  const rm = await c.as.admin.post(U(c, "/rooms"), { data: { floorId, label: `${c.run.prefix}R` } });
  expect(rm.status(), await rm.text()).toBe(201);
  const roomId = ((await rm.json()) as { room: { id: string } }).room.id;
  const sd = await c.as.admin.patch(U(c, `/rooms/${roomId}/sides`), {
    data: {
      sides: sides.map((s, i) => (s.kind === "PLAIN" ? { kind: "PLAIN", turnDegrees: 90 } : { ...s, turnDegrees: 90, label: `${c.run.prefix}W${i}` })),
    },
  });
  const text = await sd.text();
  expect(sd.status(), text).toBe(200);
  const room = (JSON.parse(text) as { room: { isClosed: boolean; sides: { kind: string; partitionId: string | null }[] } }).room;
  expect(room.isClosed, "the room is closed (the unit tuples use closed rooms)").toBe(true);
  return { projectId, partitionIds: room.sides.filter((s) => s.kind === "PARTITION").map((s) => s.partitionId!) };
}

type Cell = [heightMm: number, selectionId: string];
/** v2 design: one section per entry of `sections` (width, cells top → bottom). */
const design = (sections: Array<[widthMm: number, cells: Cell[]]>) => ({
  schemaVersion: 2,
  sections: sections.map(([w, cells], i) => ({
    id: `s${i}`,
    widthMm: w,
    cells: cells.map(([h, selectionId], j) => ({ id: `s${i}-c${j}`, heightMm: h, selectionId })),
  })),
});
/** materials-evaluate.test.ts glassDesign4Panel(): 4 × 1000 mm glass sections, 3000 mm tall. */
const glass4 = (sel: string) => design([1000, 1000, 1000, 1000].map((w) => [w, [[3000, sel]]]));

async function setDesign(c: C, partitionId: string, heightMm: number, d: unknown): Promise<void> {
  const r = await c.as.admin.patch(U(c, `/partitions/${partitionId}`), { data: { heightMm, design: d } });
  expect(r.status(), await r.text()).toBe(200);
}

async function submit(c: C, projectId: string): Promise<Calculation> {
  const r = await c.as.admin.post(U(c, `/projects/${projectId}/submit-design`));
  expect(r.status(), await r.text()).toBe(200);
  const calc = await readCalc(c.as.admin, c.run.testOrg.slug, projectId);
  expect(calc.formulaSet, "the Test Org's pinned formula set is the one the copied tuples belong to").toEqual(TUPLE_SET);
  expect(calc.status).toBe("OK");
  return calc;
}

// partition.md Scenario 1, materials-evaluate.test.ts "wall/wall" (and stage24 A3 for the quantities).
const SCENARIO1_WALL_WALL = {
  profileU: { requirement: 4, quantity: 2 }, // A3: perUnit 3 → ceil(4/3) = 2
  profileL: 10,
  profileI: 10,
  acousticGasket: 28, // A3
  whiteSeal: 14,
  woodWedge: 8,
  lConnector: { requirement: 4, quantity: 4 }, // A3
  degreeConnector: 0,
  doorConnector: 0,
  straightConnector: 2,
};

test.describe("calculation engine: exact material lists (copied tuples)", () => {
  test("single glass wall, wall/wall (partition.md Scenario 1, 4000 × 3000, 4 panels)", async ({ as, f, run }) => {
    const c = { as, f, run };
    const g = await itemSet(c, "gA", "GLASS");
    const { projectId, partitionIds: [p1] } = await project(c, [wall(4000, 3000), PLAIN, PLAIN, PLAIN]);
    const sel = await selection(c, projectId, "GLASS", glassCfg(g));
    await setDesign(c, p1, 3000, glass4(sel));
    const calc = await submit(c, projectId);
    expectLines(calc.materialList, g, SCENARIO1_WALL_WALL, "wall/wall");
    // nothing else is billed: exactly the 10 GLASS formulas, each once
    expect(calc.materialList.map((l) => l.code).sort()).toEqual(Object.values(g.codes).sort());
    expect(calc.materialList.every((l) => l.slot === "GLASS")).toBe(true);
  });

  test("edge profiles follow the neighbours: wall/partition (p1) and partition/partition (p2) — Scenario 1 columns 2 and 3", async ({ as, f, run }) => {
    const c = { as, f, run };
    const shared = await itemSet(c, "gA", "GLASS");
    const own = await itemSet(c, "gB", "GLASS");

    // [PLAIN, p1, p2, PLAIN]: p1's left neighbour is a wall, its right neighbour a glass partition.
    {
      const { projectId, partitionIds: [p1, p2] } = await project(c, [PLAIN, wall(4000, 3000), wall(4000, 3000), PLAIN]);
      const s1 = await selection(c, projectId, "GLASS", glassCfg(own));
      const s2 = await selection(c, projectId, "GLASS", glassCfg(shared));
      await setDesign(c, p1, 3000, glass4(s1));
      await setDesign(c, p2, 3000, glass4(s2));
      const calc = await submit(c, projectId);
      // materials-evaluate.test.ts "wall/partition (leftWallLike=1, rightWallLike=0, rightDegree=1)"
      expectLines(calc.materialList, own, { profileU: 4, profileL: 7, profileI: 7, acousticGasket: 22, whiteSeal: 11, lConnector: 2, degreeConnector: 1 }, "wall/partition p1");
      expect(codesOf(calc.materialList, shared), "p2's own lines are billed too").toHaveLength(10);
    }
    // [p1, p2, p3, PLAIN]: p2 sits between two glass partitions.
    {
      const { projectId, partitionIds: [p1, p2, p3] } = await project(c, [wall(4000, 3000), wall(4000, 3000), wall(4000, 3000), PLAIN]);
      const sMid = await selection(c, projectId, "GLASS", glassCfg(own));
      const sEnds = await selection(c, projectId, "GLASS", glassCfg(shared));
      await setDesign(c, p1, 3000, glass4(sEnds));
      await setDesign(c, p2, 3000, glass4(sMid));
      await setDesign(c, p3, 3000, glass4(sEnds));
      const calc = await submit(c, projectId);
      // materials-evaluate.test.ts "partition/partition (leftDegree=1, rightDegree=1)"
      expectLines(calc.materialList, own, { profileU: 4, profileL: 4, profileI: 4, acousticGasket: 16, whiteSeal: 8, lConnector: 0, degreeConnector: 2 }, "partition/partition p2");
    }
  });

  test("door leaf calc: door.md worked example 2000 × 3000 — frame + leaf, frame only, neither", async ({ as, f, run }) => {
    const c = { as, f, run };
    const d = await itemSet(c, "dA", "DOOR");
    const doorOnly = async (over: Record<string, string>) => {
      const { projectId, partitionIds: [p1] } = await project(c, [wall(2000, 3000), PLAIN, PLAIN, PLAIN]);
      const sel = await selection(c, projectId, "DOOR", doorCfg(d, over));
      await setDesign(c, p1, 3000, design([[2000, [[3000, sel]]]]));
      return submit(c, projectId);
    };

    // frame + leaf: materials-evaluate.test.ts "door.md worked example — frame + leaf"; quantities from stage24 A2.
    const both = await doorOnly({});
    expectLines(both.materialList, d, {
      doorFrame: { requirement: 8, quantity: 3 },
      doorLeaf: { requirement: 10, quantity: 4 },
      cornerConnBig: 3,
      cornerConnSmallFrame: 2,
      cornerConnSmallLeaf: 1,
      lAngle: 4,
      hinges: 4,
      rubber25mm: { requirement: 18, quantity: 18 },
      frameBumperGasket: 8,
      frameBackGasket: { requirement: 12, quantity: 12 },
      leafGlassGasket1: 10,
      leafGlassGasket2: 10,
    }, "frame+leaf");
    expect(both.materialList, "A2: all 12 DOOR materials, nothing else (a door-only wall fires no GLASS formula)").toHaveLength(12);

    // frame only (hasLeaf = No): "door.md worked example — frame only (hasLeaf=No)"
    const frame = await doorOnly({ hasLeaf: "No" });
    expectLines(frame.materialList, d, { doorFrame: 8, cornerConnSmallFrame: 2, lAngle: 4, hinges: 4, rubber25mm: 8, frameBumperGasket: 8, frameBackGasket: 12 }, "frame only");
    expect(codesOf(frame.materialList, d)).toHaveLength(7); // doorLeaf, cornerConnBig, cornerConnSmallLeaf, leafGlassGasket1/2 not fired

    // neither: "door.md worked example — neither" → no lines at all
    const neither = await doorOnly({ hasFrame: "No", hasLeaf: "No" });
    expect(neither.materialList).toEqual([]);
  });

  test("wall with a door: full-height door reduces profileU; transom door does not; a corner door is not a door connector", async ({ as, f, run }) => {
    const c = { as, f, run };
    const g = await itemSet(c, "gA", "GLASS");
    const d = await itemSet(c, "dA", "DOOR");
    const glassDoor = async (sections: (gs: string, ds: string) => Array<[number, Cell[]]>) => {
      const { projectId, partitionIds: [p1] } = await project(c, [wall(4000, 3000), PLAIN, PLAIN, PLAIN]);
      const gs = await selection(c, projectId, "GLASS", glassCfg(g));
      const ds = await selection(c, projectId, "DOOR", doorCfg(d));
      await setDesign(c, p1, 3000, design(sections(gs, ds)));
      return submit(c, projectId);
    };

    // "profileU: full-height door reduces doorWidthMmFullHeight": 900 door + 1100/1000/1000 glass → 3.1
    const full = await glassDoor((gs, ds) => [[900, [[3000, ds]]], [1100, [[3000, gs]]], [1000, [[3000, gs]]], [1000, [[3000, gs]]]]);
    expectLines(full.materialList, g, { profileU: 3.1 }, "full-height door");

    // Two separate source tuples, each with its own literal layout:
    // (a) materials-evaluate.test.ts "profileU: transom door does NOT reduce doorWidthMmFullHeight": sections
    //     900 (1000 glass over a 2000 door) / 1033 / 1033 / 1034 → profileU 4.
    const transomFirst = await glassDoor((gs, ds) => [[900, [[1000, gs], [2000, ds]]], [1033, [[3000, gs]]], [1033, [[3000, gs]]], [1034, [[3000, gs]]]]);
    expectLines(transomFirst.materialList, g, { profileU: 4 }, "transom door (profileU)");
    // (b) materials-evaluate.test.ts "formula set v2: transom door removes L/I", test "v1 baseline: transom door
    //     leaves L/I untouched": sections 1033 / 900 transom / 1033 / 1034 → profileL 10, whiteSeal 14 (v1).
    const transomSecond = await glassDoor((gs, ds) => [[1033, [[3000, gs]]], [900, [[1000, gs], [2000, ds]]], [1033, [[3000, gs]]], [1034, [[3000, gs]]]]);
    expectLines(transomSecond.materialList, g, { profileL: 10, whiteSeal: 14 }, "transom door (v1 baseline)");

    // "doorConnector excludes corner door (test 10)": a door at the left end → 0
    const corner = await glassDoor((gs, ds) => [[900, [[3000, ds]]], [1033, [[3000, gs]]], [1033, [[3000, gs]]], [1034, [[3000, gs]]]]);
    expectLines(corner.materialList, g, { doorConnector: 0 }, "corner door");
  });

  test("double leaf: one 'LH + RH' summary row (H-3); the material list is the single-leaf one (isDoubleLeaf is not billed)", async ({ as, f, run }) => {
    const c = { as, f, run };
    const g = await itemSet(c, "gA", "GLASS");
    const d = await itemSet(c, "dA", "DOOR");
    // H-3 design: a 1400 × 2400 wall, an 800 glass section + a 600 door section hinged "left".
    const twoSection = async (doubleLeaf: boolean) => {
      const { projectId, partitionIds: [p1] } = await project(c, [wall(1400, 2400), PLAIN, PLAIN, PLAIN]);
      const gs = await selection(c, projectId, "GLASS", glassCfg(g));
      const ds = await selection(c, projectId, "DOOR", doorCfg(d));
      // The Test Org's DOOR type has no isDoubleLeaf field, so the API (S31-7) rejects the key; the summary reads
      // it from the stored config (lib/door-leaf.ts), so write that state straight into the DB (Test Org only).
      if (doubleLeaf) await rgrSetSelectionConfig(ds, { ...doorCfg(d), isDoubleLeaf: "Yes" });
      const dsg = design([[800, [[2400, gs]]], [600, [[2400, ds]]]]); // patchTwoSection(…, "left")
      (dsg.sections[1].cells[0] as Record<string, unknown>).hinging = "left";
      await setDesign(c, p1, 2400, dsg);
      return submit(c, projectId);
    };
    const single = await twoSection(false);
    const double = await twoSection(true);
    const doors = (calc: Calculation) => calc.summary.floors.flatMap((fl) => fl.rooms.flatMap((r) => r.walls.flatMap((w) => w.doors)));

    expect(doors(single).map((x) => [x.handing, x.quantity])).toEqual([["LH", 1]]); // H-3-single
    expect(doors(double).map((x) => [x.handing, x.quantity])).toEqual([["LH + RH", 1]]); // H-3-double
    // Pinned (observed): no formula of the set reads isDoubleLeaf, so both lists are identical.
    expect(double.materialList).toEqual(single.materialList);
    expect(codesOf(double.materialList, d)).toHaveLength(12);
  });

  test("design.stops (the edge-profile pickers) are not billed: same list with and without them", async ({ as, f, run }) => {
    // Pinned (observed): the Test Org has no PROFILE_STOP type, and no formula reads design.stops (profile
    // billing goes through the GLASS u/i/l_profile params — the 'edge profiles' asserted above). A wall whose
    // design carries stops computes exactly the Scenario-1 list.
    const c = { as, f, run };
    const g = await itemSet(c, "gA", "GLASS");
    const { projectId, partitionIds: [p1] } = await project(c, [wall(4000, 3000), PLAIN, PLAIN, PLAIN]);
    const sel = await selection(c, projectId, "GLASS", glassCfg(g));
    await setDesign(c, p1, 3000, { ...glass4(sel), stops: { top: sel, bottom: sel } });
    const calc = await submit(c, projectId);
    expectLines(calc.materialList, g, SCENARIO1_WALL_WALL, "with stops");
    expect(calc.materialList).toHaveLength(10);
  });
});

test.describe("calculation engine: refusals keep the stored calculation", () => {
  test("INACTIVE_ITEM: deactivating a billed item → recompute and submit 422 naming the code; the stored row is unchanged; reactivating restores the same list", async ({ as, f, run }) => {
    const c = { as, f, run };
    // A dedicated item set: deactivating a shared item would break the other cases.
    const g = await makeItemSet(testOrgItems(f), run.prefix, "GLASS", "engInact");
    const { projectId, partitionIds: [p1] } = await project(c, [wall(4000, 3000), PLAIN, PLAIN, PLAIN]);
    const sel = await selection(c, projectId, "GLASS", glassCfg(g));
    await setDesign(c, p1, 3000, glass4(sel));
    const before = await submit(c, projectId);
    expectLines(before.materialList, g, SCENARIO1_WALL_WALL);

    const item = U(c, `/inventory/${g.ids.whiteSealCode}`);
    const off = await as.admin.patch(item, { data: { active: false } });
    expect(off.status(), await off.text()).toBe(200);
    try {
      for (const route of ["recompute", "submit-design"]) {
        const body = await refused(await as.admin.post(U(c, `/projects/${projectId}/${route}`)));
        expect(body.ok).toBe(false);
        expect(body.problems.map((p) => [p.kind, p.scope, p.code]), route).toEqual([["INACTIVE_ITEM", "INVENTORY", g.codes.whiteSealCode]]);
        expect(body.problemCount).toBe(1);
        expect(body.error).toBe(`Inventory item "${g.codes.whiteSealCode}" is inactive`);
      }
      // G-3: a refusal never writes — the stored calculation (incl. computedAt) is byte-identical
      expect(await readCalc(as.admin, run.testOrg.slug, projectId)).toEqual(before);
    } finally {
      const on = await as.admin.patch(item, { data: { active: true } });
      expect(on.status(), await on.text()).toBe(200);
    }
    const r = await as.admin.post(U(c, `/projects/${projectId}/recompute`));
    expect(r.status(), await r.text()).toBe(200);
    const after = await readCalc(as.admin, run.testOrg.slug, projectId);
    expect(after.materialList).toEqual(before.materialList);
    expect(Date.parse(after.computedAt)).toBeGreaterThan(Date.parse(before.computedAt));
  });

  test("UNRESOLVED_CODE and UNIT_MISMATCH: 422 with the exact problems; nothing is written", async ({ as, f, run }) => {
    const c = { as, f, run };
    const g = await itemSet(c, "gA", "GLASS");
    // An item whose unit disagrees with the formula: woodWedge is billed in metres; this item says pieces.
    const wrongUnit = await f.inventoryItem({ code: `${run.prefix}engUnit-${Date.now().toString(36)}`, measurementUnit: "pieces", perUnitQuantity: 1 });
    const missing = `${run.prefix}engNoSuchCode`;
    // The two off-set codes are still dropdown choices (S31-7); UNRESOLVED_CODE stays reachable: a choice with no inventory item.
    await allowTestOrgCodes("GLASS", { whiteSealCode: missing, woodWedgeCode: wrongUnit.code });
    const { projectId, partitionIds: [p1] } = await project(c, [wall(4000, 3000), PLAIN, PLAIN, PLAIN]);
    const sel = await selection(c, projectId, "GLASS", { ...glassCfg(g), whiteSealCode: missing, woodWedgeCode: wrongUnit.code });
    await setDesign(c, p1, 3000, glass4(sel));

    const body = await refused(await as.admin.post(U(c, `/projects/${projectId}/submit-design`)));
    const view = body.problems.map((p) => ({ kind: p.kind, scope: p.scope, code: p.code, expectedUnit: p.expectedUnit, actualUnit: p.actualUnit }));
    expect(view).toEqual([
      // sorted by scope, then kind (ProblemCollector.report)
      { kind: "UNIT_MISMATCH", scope: "INVENTORY", code: wrongUnit.code, expectedUnit: "metres", actualUnit: "pieces" },
      { kind: "UNRESOLVED_CODE", scope: "INVENTORY", code: missing, expectedUnit: undefined, actualUnit: undefined },
    ]);
    expect(body.problemCount).toBe(2);
    // nothing written: no calculation, not submitted
    expect((await as.admin.get(U(c, `/projects/${projectId}/calculation`))).status()).toBe(404);
    const pj = (await (await as.admin.get(U(c, `/projects/${projectId}`))).json()) as { project: { designSubmittedAt: string | null } };
    expect(pj.project.designSubmittedAt).toBeNull();
  });

  test("missing price is not a problem: every billed item has no ItemPrice and the calculation is OK", async ({ as, f, run }) => {
    // Pinned (observed + source): CalculationProblemKind has no price kind and the engine never reads
    // ItemPrice (there is no price write API either). Prices belong to the future Quotation stage.
    const c = { as, f, run };
    const g = await itemSet(c, "gA", "GLASS");
    const { projectId, partitionIds: [p1] } = await project(c, [wall(4000, 3000), PLAIN, PLAIN, PLAIN]);
    const sel = await selection(c, projectId, "GLASS", glassCfg(g));
    await setDesign(c, p1, 3000, glass4(sel));
    const calc = await submit(c, projectId);
    for (const id of Object.values(g.ids)) {
      const r = await as.admin.get(U(c, `/inventory/${id}`));
      expect(r.status()).toBe(200);
      expect(((await r.json()) as { item: { prices: unknown[] } }).item.prices).toEqual([]);
    }
    expect(calc.materialList).toHaveLength(10);
    expect(calc.errorDetail).toBeNull();
  });
});
