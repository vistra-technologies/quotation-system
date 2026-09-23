/**
 * Unit tests for lib/summary buildSummary (Stage 23 Batch 4). Pure — no DB, no server.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildSummary } from "../../lib/summary";
import type { SummaryInput } from "../../lib/summary";

const GLASS_T = "type-glass";
const DOOR_T = "type-door";

const req = (key: string) => ({ key, label: key, type: "dropdown", required: true, basic: true });
const opt = (key: string) => ({ key, label: key, type: "dropdown", required: false, basic: true });

function snapshot(doorRequired = false) {
  return {
    takenAt: "2026-09-21T00:00:00.000Z",
    componentTypes: [
      {
        id: GLASS_T,
        code: "GLASS",
        name: "Partition",
        active: true,
        fieldsSchema: [req("category"), req("glassType"), req("thickness")],
        fieldOptionsConfig: {},
      },
      {
        id: DOOR_T,
        code: "DOOR",
        name: "Door",
        active: true,
        fieldsSchema: [req("category"), doorRequired ? req("doorType") : opt("doorType")],
        fieldOptionsConfig: {},
      },
    ],
  };
}

const body = {
  slots: {
    GLASS: { role: "glass", requiredParams: [], summaryParams: { glassType: "glassType", thickness: "thickness" } },
    DOOR: { role: "door", requiredParams: [], summaryParams: { category: "category", doorType: "doorType" } },
  },
  formulas: [],
};

const selections = [
  { id: "g-id1-12", componentTypeId: GLASS_T, config: { category: "Clear", glassType: "ID1", thickness: "12" } },
  { id: "g-id1-10", componentTypeId: GLASS_T, config: { category: "Clear", glassType: "ID1", thickness: "10" } },
  { id: "g-id2-12", componentTypeId: GLASS_T, config: { category: "Tinted", glassType: "ID2", thickness: "12" } },
  { id: "g-id1-12-tinted", componentTypeId: GLASS_T, config: { category: "Tinted", glassType: "ID1", thickness: "12" } },
  { id: "d-simple", componentTypeId: DOOR_T, config: { category: "Single", doorType: "Simple Glass" } },
  { id: "d-blank", componentTypeId: DOOR_T, config: { category: "Single", doorType: "  " } },
  { id: "d-nokey", componentTypeId: DOOR_T, config: { category: "Single" } },
  { id: "orphan", componentTypeId: "type-gone", config: {} },
];

type Cell = { id: string; heightMm: number; selectionId: string | null; hinging?: "left" | "right" };
const cell = (id: string, heightMm: number, selectionId: string | null, hinging?: "left" | "right"): Cell =>
  hinging ? { id, heightMm, selectionId, hinging } : { id, heightMm, selectionId };
const section = (id: string, widthMm: number, cells: Cell[]) => ({ id, widthMm, cells });
const design = (sections: unknown[]) => ({ schemaVersion: 2, sections });

function partition(id: string, label: string, sections: unknown[]) {
  return { id, label, widthMm: 0, heightMm: 0, design: design(sections) };
}

function input(
  partitions: ReturnType<typeof partition>[],
  over: Partial<SummaryInput> = {},
): SummaryInput {
  return {
    formulaSetBody: body,
    snapshot: snapshot(),
    floors: [{ id: "f1", label: "Ground", rooms: [{ id: "r1", label: "Room A", partitions }] }],
    selections,
    ...over,
  };
}

describe("buildSummary", () => {
  test("plain glass wall: one row per cell, correct areaM2, KPI is their sum", () => {
    const r = buildSummary(
      input([
        partition("p1", "North", [
          section("s1", 1195, [cell("c1", 2800, "g-id1-12")]),
          section("s2", 1000, [cell("c2", 2800, "g-id1-12")]),
        ]),
      ]),
    );
    assert.equal(r.status, "OK");
    const wall = r.summary.floors[0].rooms[0].walls[0];
    assert.equal(wall.glass.length, 2);
    assert.deepEqual(wall.glass[0], {
      glassType: "ID1",
      thickness: "12",
      widthMm: 1195,
      heightMm: 2800,
      areaM2: 3.346,
    });
    assert.equal(wall.glass[1].areaM2, 2.8);
    assert.equal(r.summary.kpis.totalPartitionSqm, 6.146);
  });

  test("door-with-transom: one door row + one transom glass row on the SAME wall; total excludes door", () => {
    const r = buildSummary(
      input([
        partition("p1", "North", [
          section("s1", 900, [cell("c1a", 4000, "g-id1-12")]),
          section("s2", 1200, [cell("c2a", 1200, "g-id1-12"), cell("c2b", 2800, "d-simple", "right")]),
          section("s3", 900, [cell("c3a", 4000, "g-id1-12")]),
        ]),
      ]),
    );
    assert.equal(r.status, "OK");
    const wall = r.summary.floors[0].rooms[0].walls[0];
    assert.equal(wall.glass.length, 3);
    assert.deepEqual(wall.glass[1], { glassType: "ID1", thickness: "12", widthMm: 1200, heightMm: 1200, areaM2: 1.44 });
    assert.equal(wall.doors.length, 1);
    assert.deepEqual(wall.doors[0], {
      widthMm: 1200,
      heightMm: 2800,
      handing: "RH",
      category: "Single",
      doorType: "Simple Glass",
      quantity: 1,
    });
    // 0.9*4 + 1.2*1.2 + 0.9*4 = 3.6 + 1.44 + 3.6 = 8.64 (door's 1200x2800 excluded)
    assert.equal(r.summary.kpis.totalPartitionSqm, 8.64);
  });

  test("two glass types on one wall -> two sqmByGlassType entries summing to the total", () => {
    const r = buildSummary(
      input([
        partition("p1", "N", [
          section("s1", 1000, [cell("c1", 2000, "g-id1-12")]),
          section("s2", 1000, [cell("c2", 3000, "g-id2-12")]),
        ]),
      ]),
    );
    const k = r.summary.kpis;
    assert.equal(k.sqmByGlassType.length, 2);
    assert.deepEqual(k.sqmByGlassType.map((e) => e.glassType), ["ID1", "ID2"]);
    assert.equal(k.sqmByGlassType.reduce((a, e) => a + e.areaM2, 0), k.totalPartitionSqm);
    assert.equal(k.totalPartitionSqm, 5);
  });

  test("two thicknesses of the same glassType -> two entries (key is the pair)", () => {
    const r = buildSummary(
      input([
        partition("p1", "N", [
          section("s1", 1000, [cell("c1", 2000, "g-id1-12")]),
          section("s2", 1000, [cell("c2", 2000, "g-id1-10")]),
        ]),
      ]),
    );
    assert.deepEqual(
      r.summary.kpis.sqmByGlassType.map((e) => [e.glassType, e.thickness]),
      [
        ["ID1", "10"],
        ["ID1", "12"],
      ],
    );
  });

  test("the GLASS category does not affect grouping", () => {
    const r = buildSummary(
      input([
        partition("p1", "N", [
          section("s1", 1000, [cell("c1", 2000, "g-id1-12")]), // category Clear
          section("s2", 1000, [cell("c2", 2000, "g-id1-12-tinted")]), // category Tinted, same pair
        ]),
      ]),
    );
    assert.equal(r.summary.kpis.sqmByGlassType.length, 1);
    assert.equal(r.summary.kpis.sqmByGlassType[0].areaM2, 4);
  });

  test("two identical doors on the SAME wall -> one row, quantity 2 (D-40)", () => {
    const r = buildSummary(
      input([
        partition("p1", "N", [
          section("s1", 900, [cell("c1", 2800, "d-simple", "left")]),
          section("s2", 900, [cell("c2", 2800, "d-simple", "left")]),
        ]),
      ]),
    );
    const doors = r.summary.floors[0].rooms[0].walls[0].doors;
    assert.equal(doors.length, 1);
    assert.equal(doors[0].quantity, 2);
    assert.deepEqual(r.summary.kpis.doorsByType, [{ doorType: "Simple Glass", quantity: 2 }]);
  });

  test("2 identical doors on wall A + 1 on wall B -> two rows (2 and 1), never merged (D-40)", () => {
    const r = buildSummary(
      input([
        partition("pA", "A", [
          section("s1", 900, [cell("c1", 2800, "d-simple", "left")]),
          section("s2", 900, [cell("c2", 2800, "d-simple", "left")]),
        ]),
        partition("pB", "B", [section("s3", 900, [cell("c3", 2800, "d-simple", "left")])]),
      ]),
    );
    const [a, b] = r.summary.floors[0].rooms[0].walls;
    assert.equal(a.doors.length, 1);
    assert.equal(a.doors[0].quantity, 2);
    assert.equal(b.doors.length, 1);
    assert.equal(b.doors[0].quantity, 1);
    // doorsByType KPI still totals across walls (it is keyed by doorType only)
    assert.deepEqual(r.summary.kpis.doorsByType, [{ doorType: "Simple Glass", quantity: 3 }]);
    // rooms carry no door list
    assert.ok(!("doors" in r.summary.floors[0].rooms[0]));
  });

  test("a wall with no doors emits doors: [] (present key)", () => {
    const r = buildSummary(input([partition("p1", "N", [section("s1", 1000, [cell("c1", 2000, "g-id1-12")])])]));
    const wall = r.summary.floors[0].rooms[0].walls[0];
    assert.ok("doors" in wall);
    assert.deepEqual(wall.doors, []);
  });

  test("doors differing only in hinging -> two rows LH and RH; missing hinging -> LH", () => {
    const r = buildSummary(
      input([
        partition("p1", "N", [
          section("s1", 900, [cell("c1", 2800, "d-simple", "left")]),
          section("s2", 900, [cell("c2", 2800, "d-simple", "right")]),
          section("s3", 900, [cell("c3", 2800, "d-simple")]),
        ]),
      ]),
    );
    const doors = r.summary.floors[0].rooms[0].walls[0].doors;
    assert.equal(doors.length, 2);
    assert.deepEqual(doors.map((d) => [d.handing, d.quantity]), [
      ["LH", 2],
      ["RH", 1],
    ]);
    assert.ok(doors.every((d) => d.handing !== null));
  });

  test("blank non-required doorType -> null; no crash, no 'undefined'", () => {
    for (const sel of ["d-blank", "d-nokey"]) {
      const r = buildSummary(input([partition("p1", "N", [section("s1", 900, [cell("c1", 2800, sel)])])]));
      assert.equal(r.status, "OK");
      const d = r.summary.floors[0].rooms[0].walls[0].doors[0];
      assert.equal(d.doorType, null);
      assert.ok(!JSON.stringify(r).includes("undefined"));
    }
  });

  test("blank value for a key the schema marks required:true -> FAILED", () => {
    const r = buildSummary(
      input([partition("p1", "N", [section("s1", 900, [cell("c1", 2800, "d-blank")])])], { snapshot: snapshot(true) }),
    );
    assert.equal(r.status, "FAILED");
    assert.match(r.errorDetail!, /doorType/);
    assert.match(r.errorDetail!, /p1/);
  });

  test("slot summaryParams naming a key the config lacks -> null, not a throw", () => {
    const b = {
      slots: { ...body.slots, GLASS: { role: "glass", summaryParams: { glassType: "nope", thickness: "thickness" } } },
    };
    // key "nope" isn't in the schema, so it is not required -> null
    const r = buildSummary(
      input([partition("p1", "N", [section("s1", 1000, [cell("c1", 2000, "g-id1-12")])])], { formulaSetBody: b }),
    );
    assert.equal(r.status, "OK");
    assert.equal(r.summary.floors[0].rooms[0].walls[0].glass[0].glassType, null);
  });

  test("selectionId null -> FAILED naming partition + cell; no 'Unassigned' anywhere", () => {
    const r = buildSummary(
      input([partition("p-x", "North", [section("s1", 1000, [cell("cell-7", 2000, null)])])]),
    );
    assert.equal(r.status, "FAILED");
    assert.match(r.errorDetail!, /North/);
    assert.match(r.errorDetail!, /p-x/);
    assert.match(r.errorDetail!, /cell-7/);
    assert.ok(!JSON.stringify(r).includes("Unassigned"));
    assert.deepEqual(r.summary.floors, []);
  });

  test("cell whose componentTypeId is absent from the snapshot -> FAILED", () => {
    const r = buildSummary(input([partition("p1", "N", [section("s1", 1000, [cell("c1", 2000, "orphan")])])]));
    assert.equal(r.status, "FAILED");
    assert.match(r.errorDetail!, /snapshot/);
  });

  test("malformed (non-null, missing componentTypes) snapshot -> FAILED cleanly, not a crash (review-7 MINOR)", () => {
    const r = buildSummary(
      input([partition("p1", "N", [section("s1", 1000, [cell("c1", 2000, "g-id1-12")])])], {
        snapshot: { takenAt: "2026-09-21T00:00:00.000Z" } as unknown as SummaryInput["snapshot"],
      }),
    );
    assert.equal(r.status, "FAILED");
    assert.match(r.errorDetail!, /snapshot/i);
  });

  test("unknown selection id and slotless type -> FAILED", () => {
    const missing = buildSummary(input([partition("p1", "N", [section("s1", 1000, [cell("c1", 2000, "nope")])])]));
    assert.equal(missing.status, "FAILED");
    const noSlot = buildSummary(
      input([partition("p1", "N", [section("s1", 1000, [cell("c1", 2000, "g-id1-12")])])], {
        formulaSetBody: { slots: { DOOR: body.slots.DOOR } },
      }),
    );
    assert.equal(noSlot.status, "FAILED");
  });

  test("every result carries materialList: []", () => {
    const ok = buildSummary(input([partition("p1", "N", [section("s1", 1000, [cell("c1", 2000, "g-id1-12")])])]));
    const bad = buildSummary(input([partition("p1", "N", [section("s1", 1000, [cell("c1", 2000, null)])])]));
    assert.deepEqual(ok.materialList, []);
    assert.deepEqual(bad.materialList, []);
  });

  test("KPIs sum unrounded areas and round once", () => {
    // 3 x (333 x 1000 / 1e6 = 0.333) = 0.999; rounding per-row first would still be 0.999, so use 3 x 0.33333
    const cells = [0, 1, 2].map((i) => section(`s${i}`, 1, [cell(`c${i}`, 333333, "g-id1-12")])); // 0.333333 each
    const r = buildSummary(input([partition("p1", "N", cells)]));
    assert.equal(r.summary.floors[0].rooms[0].walls[0].glass[0].areaM2, 0.3333);
    assert.equal(r.summary.kpis.totalPartitionSqm, 1); // 0.999999 -> 1, not 0.3333*3 = 0.9999
  });

  // The following two tests document the exact FAILED conditions that projects.ts (Stage 24 Batch 5
  // fix round, IMPORTANT-1) now maps to 422 CalculationProblemReport instead of throwing → 500.
  // Both conditions pass Phase A (the cell IS assigned, the componentTypeId IS in the snapshot) and
  // are only caught by buildSummary's semantic checks.

  test("blank required GLASS field (glassType) -> FAILED naming the field (routes to 422, not 500)", () => {
    // Snapshot marks glassType required:true via req() helper; config has glassType: "".
    const blankGlassTypeSelection = { id: "g-blank-gt", componentTypeId: GLASS_T, config: { category: "Clear", glassType: "", thickness: "12" } };
    const r = buildSummary({
      formulaSetBody: body,
      snapshot: snapshot(), // glassType is required:true in snapshot()
      floors: [{ id: "f1", label: "Ground", rooms: [{ id: "r1", label: "Room A", partitions: [
        partition("p1", "Wall 1", [section("s1", 1000, [cell("c1", 2800, "g-blank-gt")])]),
      ] }] }],
      selections: [blankGlassTypeSelection],
    });
    assert.equal(r.status, "FAILED", `expected FAILED, got ${r.status}: ${r.errorDetail}`);
    assert.match(r.errorDetail!, /glassType/i, "errorDetail should name the blank field");
  });

  test("selection type present in snapshot but has no slot in formula set -> FAILED (routes to 422, not 500)", () => {
    // GLASS is in the snapshot but the formula set body has no GLASS slot.
    const r = buildSummary(
      input([partition("p1", "Wall 1", [section("s1", 1000, [cell("c1", 2000, "g-id1-12")])])], {
        formulaSetBody: { slots: { DOOR: body.slots.DOOR } }, // GLASS slot deliberately absent
      }),
    );
    assert.equal(r.status, "FAILED", `expected FAILED, got ${r.status}: ${r.errorDetail}`);
    assert.match(r.errorDetail!, /slot/i, "errorDetail should mention 'slot'");
    assert.match(r.errorDetail!, /GLASS/i, "errorDetail should name the type code");
  });

  test("deterministic: same input twice -> identical output", () => {
    const i = input([
      partition("p1", "N", [
        section("s1", 900, [cell("c1", 2800, "d-simple", "left")]),
        section("s2", 1000, [cell("c2", 2000, "g-id2-12")]),
        section("s3", 1000, [cell("c3", 2000, "g-id1-10")]),
      ]),
    ]);
    assert.equal(JSON.stringify(buildSummary(i)), JSON.stringify(buildSummary(i)));
  });
});
