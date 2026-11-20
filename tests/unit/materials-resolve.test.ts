/**
 * Unit tests for resolveAndAggregate (Stage 24 Batch 5).
 *
 * Pure — no DB. Covers every case in the Batch 5 acceptance checklist.
 * All 11 plan cases + edge cases.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveAndAggregate, itemQuantity } from "../../lib/materials/resolve";
import { ProblemCollector } from "../../lib/materials/problems";
import type { RawMaterialLine } from "../../lib/materials/evaluate";
import type { InventoryRow } from "../../lib/data/inventory";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeInventoryMap(items: Array<[string, Partial<InventoryRow>]>): Map<string, InventoryRow> {
  const m = new Map<string, InventoryRow>();
  for (const [code, overrides] of items) {
    m.set(code, {
      name: overrides.name ?? `Item ${code}`,
      measurementUnit: overrides.measurementUnit ?? "metres",
      perUnitQuantity: overrides.perUnitQuantity ?? 1,
      active: overrides.active ?? true,
      componentTypeId: overrides.componentTypeId ?? null,
      soldInWholePacks: overrides.soldInWholePacks ?? true,
    });
  }
  return m;
}

function makeLine(overrides: Partial<RawMaterialLine> = {}): RawMaterialLine {
  return {
    code: "GLASS-001",
    unit: "metres",
    requirement: 1.0,
    slot: "GLASS",
    formulaId: "profileU",
    roomId: "room-1",
    partitionId: "part-1",
    ...overrides,
  };
}

const emptyLabels = new Map<string, string>();

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("resolveAndAggregate — basic resolution", () => {
  // Test 1: one rawLine, valid active item, correct unit
  test("1. one rawLine, valid active item → quantity = ceil(req / perUnitQuantity)", () => {
    const inv = makeInventoryMap([["GLASS-001", { perUnitQuantity: 3.0 }]]);
    const lines = [makeLine({ requirement: 4.0 })];
    const c = new ProblemCollector();
    const result = resolveAndAggregate(lines, inv, c, emptyLabels, emptyLabels);

    assert.equal(c.hasAny(), false);
    assert.equal(result.length, 1);
    assert.equal(result[0].code, "GLASS-001");
    assert.equal(result[0].quantity, 2); // ceil(4.0 / 3.0) = ceil(1.333) = 2
    assert.equal(result[0].requirement, 4.0);
    assert.equal(result[0].perUnitQuantity, 3.0);
    assert.equal(result[0].slot, "GLASS");
  });

  // Test 2: project-total ceil — 3 rooms × req=0.4 → 1 (not 3)
  test("2. project-total ceil: 3 rooms × req=0.4 with perUnitQuantity=3 → quantity=1, not 3", () => {
    const inv = makeInventoryMap([["STICK-001", { perUnitQuantity: 3.0, measurementUnit: "metres" }]]);
    const lines = [
      makeLine({ code: "STICK-001", requirement: 0.4, roomId: "room-1" }),
      makeLine({ code: "STICK-001", requirement: 0.4, roomId: "room-2" }),
      makeLine({ code: "STICK-001", requirement: 0.4, roomId: "room-3" }),
    ];
    const c = new ProblemCollector();
    const result = resolveAndAggregate(lines, inv, c, emptyLabels, emptyLabels);

    assert.equal(c.hasAny(), false);
    assert.equal(result.length, 1);
    // sum = 1.2; ceil(1.2 / 3.0) = ceil(0.4) = 1 (NOT 3 × ceil(0.4/3.0))
    assert.equal(result[0].requirement, 0.4 + 0.4 + 0.4);
    assert.equal(result[0].quantity, 1);
  });
});

describe("resolveAndAggregate — failure paths", () => {
  // Test 3: UNRESOLVED_CODE
  test("3. UNRESOLVED_CODE: code not in inventory map → problem collected, no line in materialList", () => {
    const inv = makeInventoryMap([]);
    const lines = [makeLine({ code: "UNKNOWN" })];
    const c = new ProblemCollector();
    const result = resolveAndAggregate(lines, inv, c, emptyLabels, emptyLabels);

    assert.equal(result.length, 0);
    const r = c.report();
    assert.equal(r.problems.length, 1);
    assert.equal(r.problems[0].kind, "UNRESOLVED_CODE");
    assert.equal(r.problems[0].code, "UNKNOWN");
    assert.equal(r.problems[0].scope, "INVENTORY");
  });

  // Test 4: INACTIVE_ITEM
  test("4. INACTIVE_ITEM: code found but active=false → INACTIVE_ITEM problem", () => {
    const inv = makeInventoryMap([["GLASS-001", { active: false }]]);
    const lines = [makeLine()];
    const c = new ProblemCollector();
    const result = resolveAndAggregate(lines, inv, c, emptyLabels, emptyLabels);

    assert.equal(result.length, 0);
    const r = c.report();
    assert.equal(r.problems.length, 1);
    assert.equal(r.problems[0].kind, "INACTIVE_ITEM");
    assert.equal(r.problems[0].code, "GLASS-001");
  });

  // Test 5: UNIT_MISMATCH — no division, no line
  test("5. UNIT_MISMATCH: code found, active, wrong unit → UNIT_MISMATCH; no line; no division", () => {
    const inv = makeInventoryMap([["GLASS-001", { measurementUnit: "pieces" }]]);
    const lines = [makeLine({ unit: "metres" })];
    const c = new ProblemCollector();
    const result = resolveAndAggregate(lines, inv, c, emptyLabels, emptyLabels);

    assert.equal(result.length, 0);
    const r = c.report();
    assert.equal(r.problems.length, 1);
    assert.equal(r.problems[0].kind, "UNIT_MISMATCH");
    assert.equal(r.problems[0].expectedUnit, "metres");
    assert.equal(r.problems[0].actualUnit, "pieces");
  });

  // Test 6: all three failures in one pass → all three problems collected
  test("6. all three failures in one pass → exhaustive — all three problems present", () => {
    const inv = makeInventoryMap([
      ["INACTIVE-001", { active: false }],
      ["MISMATCH-001", { measurementUnit: "pieces" }],
      // UNKNOWN-001 is absent → UNRESOLVED_CODE
    ]);
    const lines = [
      makeLine({ code: "UNKNOWN-001", unit: "metres" }),
      makeLine({ code: "INACTIVE-001", unit: "metres" }),
      makeLine({ code: "MISMATCH-001", unit: "metres" }),
    ];
    const c = new ProblemCollector();
    const result = resolveAndAggregate(lines, inv, c, emptyLabels, emptyLabels);

    assert.equal(result.length, 0);
    const r = c.report();
    const kinds = r.problems.map((p) => p.kind).sort();
    assert.ok(kinds.includes("UNRESOLVED_CODE"), "expected UNRESOLVED_CODE");
    assert.ok(kinds.includes("INACTIVE_ITEM"), "expected INACTIVE_ITEM");
    assert.ok(kinds.includes("UNIT_MISMATCH"), "expected UNIT_MISMATCH");
    assert.equal(r.problems.length, 3);
  });
});

describe("resolveAndAggregate — slot merge and determinism", () => {
  // Test 7: slot merge — same code from two different slots → one line, slot is string[]
  test("7. slot merge: same code from two slots → one line with slot as string[]", () => {
    const inv = makeInventoryMap([["GASKET-001", { measurementUnit: "metres" }]]);
    const lines = [
      makeLine({ code: "GASKET-001", unit: "metres", slot: "GLASS", requirement: 2.0 }),
      makeLine({ code: "GASKET-001", unit: "metres", slot: "DOOR", requirement: 3.0 }),
    ];
    const c = new ProblemCollector();
    const result = resolveAndAggregate(lines, inv, c, emptyLabels, emptyLabels);

    assert.equal(c.hasAny(), false);
    assert.equal(result.length, 1);
    assert.equal(result[0].requirement, 5.0);
    assert.ok(Array.isArray(result[0].slot), "slot should be string[] for multi-slot merge");
    const slot = result[0].slot as string[];
    assert.ok(slot.includes("GLASS"), "slot should contain GLASS");
    assert.ok(slot.includes("DOOR"), "slot should contain DOOR");
  });

  // Test 8: determinism — sorted by (code, unit)
  test("8. determinism: materialList sorted by (code, unit)", () => {
    const inv = makeInventoryMap([
      ["ZZZ-001", { measurementUnit: "metres" }],
      ["AAA-001", { measurementUnit: "metres" }],
      ["MMM-001", { measurementUnit: "metres" }],
    ]);
    const lines = [
      makeLine({ code: "ZZZ-001" }),
      makeLine({ code: "AAA-001" }),
      makeLine({ code: "MMM-001" }),
    ];
    const c = new ProblemCollector();
    const result = resolveAndAggregate(lines, inv, c, emptyLabels, emptyLabels);

    assert.equal(c.hasAny(), false);
    assert.equal(result.length, 3);
    assert.equal(result[0].code, "AAA-001");
    assert.equal(result[1].code, "MMM-001");
    assert.equal(result[2].code, "ZZZ-001");
  });

  // Test 8b: determinism with same code, different units
  test("8b. same code, two units → both appear, sorted by unit", () => {
    const inv = makeInventoryMap([
      ["CODE-A", { measurementUnit: "metres" }],
    ]);
    // CODE-A exists only for "metres"; create a separate entry for "pieces" to avoid UNIT_MISMATCH
    const invBoth = new Map(inv);
    invBoth.set("CODE-A", { name: "Item CODE-A metres", measurementUnit: "metres", perUnitQuantity: 1, active: true, componentTypeId: null, soldInWholePacks: true });
    // Add a second inventory entry so "pieces" can resolve
    invBoth.set("CODE-B", { name: "Item CODE-B pieces", measurementUnit: "pieces", perUnitQuantity: 1, active: true, componentTypeId: null, soldInWholePacks: true });
    const lines = [
      makeLine({ code: "CODE-B", unit: "pieces" }),
      makeLine({ code: "CODE-A", unit: "metres" }),
    ];
    const c = new ProblemCollector();
    const result = resolveAndAggregate(lines, invBoth, c, emptyLabels, emptyLabels);
    assert.equal(c.hasAny(), false);
    assert.equal(result[0].code, "CODE-A"); // sorts before CODE-B
    assert.equal(result[1].code, "CODE-B");
  });
});

describe("resolveAndAggregate — edge cases", () => {
  // Test 9: empty rawLines → [] materialList, no problems (v1 path)
  test("9. empty rawLines → [] result, no problems", () => {
    const inv = makeInventoryMap([["GLASS-001", {}]]);
    const c = new ProblemCollector();
    const result = resolveAndAggregate([], inv, c, emptyLabels, emptyLabels);

    assert.equal(c.hasAny(), false);
    assert.deepEqual(result, []);
  });

  // Test 10: same bad code in 5 rawLines → 1 UNRESOLVED_CODE, occurrenceCount=5, ≤5 occurrences
  test("10. same bad code in 5 rawLines → 1 UNRESOLVED_CODE, occurrenceCount=5, occurrences.length≤5", () => {
    const inv = makeInventoryMap([]);
    const lines = Array.from({ length: 5 }, (_, i) =>
      makeLine({ code: "BAD-001", roomId: `room-${i}`, partitionId: `part-${i}` }),
    );
    const c = new ProblemCollector();
    resolveAndAggregate(lines, inv, c, emptyLabels, emptyLabels);

    const r = c.report();
    assert.equal(r.problems.length, 1);
    assert.equal(r.problems[0].occurrenceCount, 5);
    assert.ok(
      (r.problems[0].occurrences?.length ?? 0) <= 5,
      "occurrences must be capped at 5",
    );
  });

  // Test 11: two different bad codes → 2 separate UNRESOLVED_CODE problems
  test("11. two different bad codes → 2 separate UNRESOLVED_CODE problems", () => {
    const inv = makeInventoryMap([]);
    const lines = [
      makeLine({ code: "BAD-001" }),
      makeLine({ code: "BAD-002" }),
    ];
    const c = new ProblemCollector();
    resolveAndAggregate(lines, inv, c, emptyLabels, emptyLabels);

    const r = c.report();
    assert.equal(r.problems.length, 2);
    const codes = r.problems.map((p) => p.code).sort();
    assert.deepEqual(codes, ["BAD-001", "BAD-002"]);
  });

  // occurrence locus uses roomLabels / partitionLabels when available
  test("occurrence locus uses label maps when provided", () => {
    const inv = makeInventoryMap([]);
    const lines = [makeLine({ code: "BAD", roomId: "r1", partitionId: "p1", formulaId: "frmX" })];
    const roomLabels = new Map([["r1", "Ground Floor - Room A"]]);
    const partitionLabels = new Map([["p1", "Wall 1"]]);
    const c = new ProblemCollector();
    resolveAndAggregate(lines, inv, c, roomLabels, partitionLabels);

    const r = c.report();
    const occ = r.problems[0].occurrences?.[0];
    assert.equal(occ?.roomName, "Ground Floor - Room A");
    assert.equal(occ?.partitionLabel, "Wall 1");
    assert.equal(occ?.fieldKey, "frmX"); // formulaId used as fieldKey (D-F)
  });

  // name is propagated from inventory item
  test("resolved line carries name from inventory item", () => {
    const inv = makeInventoryMap([["GLASS-001", { name: "U-Profile 80mm", perUnitQuantity: 1 }]]);
    const lines = [makeLine({ requirement: 2 })];
    const c = new ProblemCollector();
    const result = resolveAndAggregate(lines, inv, c, emptyLabels, emptyLabels);
    assert.equal(result[0].name, "U-Profile 80mm");
  });
});

describe("resolveAndAggregate — perUnitQuantity guard (MINOR-1 — review-b5-1)", () => {
  // perUnitQuantity of 0 would produce Infinity (stored as null in JSON).
  // Negative would produce a nonsense negative quantity. Both are guarded since Batch 5 fix round.

  test("perUnitQuantity = 0 → NON_FINITE_QUANTITY problem emitted, no resolved line", () => {
    const inv = makeInventoryMap([["BAD-ITEM", { perUnitQuantity: 0, measurementUnit: "metres" }]]);
    const lines = [makeLine({ code: "BAD-ITEM", unit: "metres", requirement: 5 })];
    const c = new ProblemCollector();
    const result = resolveAndAggregate(lines, inv, c, emptyLabels, emptyLabels);
    assert.equal(result.length, 0, "no resolved line should be written");
    const r = c.report();
    assert.equal(r.problems.length, 1);
    assert.equal(r.problems[0].kind, "NON_FINITE_QUANTITY");
    assert.equal(r.problems[0].scope, "INVENTORY");
    assert.equal(r.problems[0].code, "BAD-ITEM");
  });

  test("perUnitQuantity < 0 (negative) → NON_FINITE_QUANTITY problem emitted, no resolved line", () => {
    const inv = makeInventoryMap([["BAD-NEG", { perUnitQuantity: -3, measurementUnit: "metres" }]]);
    const lines = [makeLine({ code: "BAD-NEG", unit: "metres", requirement: 5 })];
    const c = new ProblemCollector();
    const result = resolveAndAggregate(lines, inv, c, emptyLabels, emptyLabels);
    assert.equal(result.length, 0, "no resolved line should be written");
    const r = c.report();
    assert.equal(r.problems[0].kind, "NON_FINITE_QUANTITY");
  });

  test("perUnitQuantity = 0.001 (positive but tiny) → resolved correctly", () => {
    const inv = makeInventoryMap([["TINY-UNIT", { perUnitQuantity: 0.001, measurementUnit: "metres" }]]);
    const lines = [makeLine({ code: "TINY-UNIT", unit: "metres", requirement: 0.005 })];
    const c = new ProblemCollector();
    const result = resolveAndAggregate(lines, inv, c, emptyLabels, emptyLabels);
    assert.equal(c.hasAny(), false);
    assert.equal(result.length, 1);
    assert.equal(result[0].quantity, Math.ceil(0.005 / 0.001)); // 5
  });
});

// ─── Stage 37 Batch 1: rounding rules (Q-D16) ────────────────────────────────

describe("itemQuantity (Stage 37 Q-D16)", () => {
  const cases: Array<[string, number, number, boolean, string, number]> = [
    ["whole packs, pack 1, 27.3 -> 28", 27.3, 1, true, "metres", 28],
    ["whole packs, pack 3, 27.3 -> 10", 27.3, 3, true, "metres", 10],
    ["exact multiple stays", 27, 1, true, "metres", 27],
    ["float noise above a whole number does not add a pack", 27.000000000000004, 1, true, "metres", 27],
    ["a real overshoot adds a pack", 27.00001, 1, true, "metres", 28],
    ["tiny positive requirement -> 1 pack", 1e-12, 1, true, "metres", 1],
    ["zero requirement -> 0", 0, 1, true, "metres", 0],
    ["exact metres, 27.3 stays 27.3", 27.3, 1, false, "metres", 27.3],
    ["exact metres rounds to 3 dp", 27.3004, 1, false, "metres", 27.3],
    ["exact metres 0.125", 0.125, 1, false, "metres", 0.125],
    ["exact metres divides by perUnit", 10, 4, false, "metres", 2.5],
    ["exact m2 rounds to 2 dp (down)", 27.304, 1, false, "m²", 27.3],
    ["exact m2 rounds half up", 27.305, 1, false, "m²", 27.31],
    ["exact m2 1.005 -> 1.01 (no float drift)", 1.005, 1, false, "m²", 1.01],
    ["exact pieces use 2 dp", 2.346, 1, false, "pieces", 2.35],
  ];
  for (const [title, req, per, whole, unit, expected] of cases) {
    test(title, () => assert.equal(itemQuantity(req, per, whole, unit), expected));
  }
});

describe("resolveAndAggregate, rounding on the project total (Stage 37)", () => {
  test("ceil once on the project total across rooms: 0.4 + 0.4 with pack 1 -> 1, not 2", () => {
    const inv = makeInventoryMap([["X", { perUnitQuantity: 1 }]]);
    const lines = [
      makeLine({ code: "X", requirement: 0.4, roomId: "room-1" }),
      makeLine({ code: "X", requirement: 0.4, roomId: "room-2" }),
    ];
    const result = resolveAndAggregate(lines, inv, new ProblemCollector(), emptyLabels, emptyLabels);
    assert.equal(result[0].quantity, 1);
  });

  test("soldInWholePacks=false carries the exact quantity into the line (27.3)", () => {
    const inv = makeInventoryMap([["X", { perUnitQuantity: 1, soldInWholePacks: false }]]);
    const lines = [makeLine({ code: "X", requirement: 27.3 })];
    const result = resolveAndAggregate(lines, inv, new ProblemCollector(), emptyLabels, emptyLabels);
    assert.equal(result[0].quantity, 27.3);
  });

  test("not whole packs still fails UNIT_MISMATCH strictly (no conversion, Q-D23)", () => {
    const inv = makeInventoryMap([["X", { measurementUnit: "ft", soldInWholePacks: false }]]);
    const lines = [makeLine({ code: "X", unit: "metres", requirement: 3 })];
    const c = new ProblemCollector();
    const result = resolveAndAggregate(lines, inv, c, emptyLabels, emptyLabels);
    assert.equal(result.length, 0);
    assert.equal(c.report().problems[0].kind, "UNIT_MISMATCH");
  });

  test("a roll item bills in rolls", () => {
    const inv = makeInventoryMap([["R", { measurementUnit: "roll", perUnitQuantity: 1 }]]);
    const lines = [makeLine({ code: "R", unit: "roll", requirement: 2 })];
    const result = resolveAndAggregate(lines, inv, new ProblemCollector(), emptyLabels, emptyLabels);
    assert.equal(result[0].quantity, 2);
    assert.equal(result[0].unit, "roll");
  });
});
