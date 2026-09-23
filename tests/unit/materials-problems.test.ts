/**
 * Unit tests for ProblemCollector (Stage 24 Batch 2).
 *
 * Pure — no DB. Covers every case in the Batch 2 acceptance checklist for lib/materials/problems.ts.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ProblemCollector } from "../../lib/materials/problems";
import type { CalculationProblem } from "../../lib/materials/problems";

function makeProblem(overrides: Partial<CalculationProblem> = {}): CalculationProblem {
  return {
    kind: "UNRESOLVED_CODE",
    scope: "INVENTORY",
    message: "Cannot resolve code GLASS-001",
    code: "GLASS-001",
    locus: { selectionId: "sel-1", fieldKey: "glassCode" },
    ...overrides,
  };
}

describe("ProblemCollector — basic", () => {
  test("empty collector: hasAny() is false", () => {
    const c = new ProblemCollector();
    assert.equal(c.hasAny(), false);
  });

  test("empty collector: report() has ok:false, empty problems, problemCount:0", () => {
    const c = new ProblemCollector();
    const r = c.report();
    assert.equal(r.ok, false);
    assert.deepEqual(r.problems, []);
    assert.equal(r.problemCount, 0);
  });

  test("add() then hasAny() → true", () => {
    const c = new ProblemCollector();
    c.add(makeProblem());
    assert.equal(c.hasAny(), true);
  });

  test("problemCount equals problems.length", () => {
    const c = new ProblemCollector();
    c.add(makeProblem({ code: "A", locus: { selectionId: "s1", fieldKey: "f1" } }));
    c.add(makeProblem({ code: "B", locus: { selectionId: "s2", fieldKey: "f2" } }));
    const r = c.report();
    assert.equal(r.problemCount, r.problems.length);
  });

  test("collector never throws on add() with any valid CalculationProblem", () => {
    const c = new ProblemCollector();
    assert.doesNotThrow(() => {
      c.add({ kind: "CELL_UNASSIGNED", scope: "DESIGN", message: "unassigned" });
      c.add({ kind: "SELECTION_MISSING", scope: "DESIGN", message: "missing sel" });
      c.add({ kind: "MISSING_PARAM", scope: "SELECTION", message: "missing param", locus: { fieldKey: "x" } });
      c.add({ kind: "UNIT_MISMATCH", scope: "INVENTORY", message: "unit mismatch", expectedUnit: "metres", actualUnit: "pieces" });
      c.add({ kind: "NON_FINITE_QUANTITY", scope: "FORMULA_SET", message: "nan" });
    });
  });
});

describe("ProblemCollector — deduplication", () => {
  test("two identical problems (same kind, code, selectionId, fieldKey) → dedupe to one with occurrenceCount:2", () => {
    const c = new ProblemCollector();
    const p = makeProblem();
    c.add(p);
    c.add(p);
    const r = c.report();
    assert.equal(r.problems.length, 1);
    assert.equal(r.problems[0].occurrenceCount, 2);
  });

  test("different code → two separate problems", () => {
    const c = new ProblemCollector();
    c.add(makeProblem({ code: "A", locus: { selectionId: "s1", fieldKey: "k1" } }));
    c.add(makeProblem({ code: "B", locus: { selectionId: "s1", fieldKey: "k1" } }));
    const r = c.report();
    assert.equal(r.problems.length, 2);
  });

  test("occurrences[] capped at 5 when 6 occurrences of same key are added", () => {
    const c = new ProblemCollector();
    for (let i = 0; i < 6; i++) {
      c.add(
        makeProblem({
          occurrences: [{ roomName: `Room ${i}`, partitionLabel: `P-${i}`, fieldKey: "glassCode" }],
        }),
      );
    }
    const r = c.report();
    assert.equal(r.problems.length, 1);
    assert.equal(r.problems[0].occurrenceCount, 6);
    assert.ok((r.problems[0].occurrences?.length ?? 0) <= 5, "occurrences must be capped at 5");
  });
});

describe("ProblemCollector — sort order", () => {
  test("shuffled input → report().problems sorted by scope (DESIGN < SELECTION < INVENTORY < FORMULA_SET), then kind", () => {
    const c = new ProblemCollector();
    // Add in reverse scope order
    c.add({ kind: "NON_FINITE_QUANTITY", scope: "FORMULA_SET", message: "nan" });
    c.add({ kind: "UNRESOLVED_CODE", scope: "INVENTORY", message: "inv", code: "X", locus: { selectionId: "s1", fieldKey: "f1" } });
    c.add({ kind: "MISSING_PARAM", scope: "SELECTION", message: "sel", locus: { selectionId: "s2", fieldKey: "f2" } });
    c.add({ kind: "CELL_UNASSIGNED", scope: "DESIGN", message: "des", locus: { selectionId: "s3", fieldKey: "f3" } });

    const r = c.report();
    const scopes = r.problems.map((p) => p.scope);
    assert.deepEqual(scopes, ["DESIGN", "SELECTION", "INVENTORY", "FORMULA_SET"]);
  });

  test("within the same scope, problems sort by kind (alphabetically)", () => {
    const c = new ProblemCollector();
    // SELECTION scope — add out of order
    c.add({ kind: "SELECTION_TYPE_UNKNOWN", scope: "DESIGN", message: "m1", locus: { selectionId: "s1", fieldKey: "f1" } });
    c.add({ kind: "CELL_UNASSIGNED", scope: "DESIGN", message: "m2", locus: { selectionId: "s2", fieldKey: "f2" } });

    const r = c.report();
    const kinds = r.problems.map((p) => p.kind);
    // CELL_UNASSIGNED < SELECTION_TYPE_UNKNOWN alphabetically
    assert.deepEqual(kinds, ["CELL_UNASSIGNED", "SELECTION_TYPE_UNKNOWN"]);
  });

  test("collector remains open after report() — add() still works", () => {
    const c = new ProblemCollector();
    c.add(makeProblem({ code: "X", locus: { selectionId: "s1", fieldKey: "f1" } }));
    const r1 = c.report();
    assert.equal(r1.problems.length, 1);

    c.add(makeProblem({ code: "Y", locus: { selectionId: "s2", fieldKey: "f2" } }));
    const r2 = c.report();
    assert.equal(r2.problems.length, 2);
  });
});
