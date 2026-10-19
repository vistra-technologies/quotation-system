/**
 * Unit tests for the pure planner of prisma/backfill-default-glass.ts (Stage 34 S34-7, runbook R2).
 * No DB: only the classification of a project from its status, glass presence and stored designs.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { countNullGlassCells, planProjectFill } from "../../prisma/backfill-default-glass";

const v2 = (...cells: { selectionId: string | null; hinging?: "left" | "right" }[][]) => ({
  schemaVersion: 2,
  sections: cells.map((cs, i) => ({
    id: `s${i}`,
    widthMm: 900,
    cells: cs.map((c, j) => ({ id: `c${i}${j}`, heightMm: 1000, ...c })),
  })),
});

describe("planProjectFill", () => {
  const design = v2([{ selectionId: null }], [{ selectionId: "G" }], [{ selectionId: null }, { selectionId: null, hinging: "left" }]);

  test("DRAFT project with glass and null glass cells is eligible (door cell not counted)", () => {
    const r = planProjectFill("DRAFT", true, [design]);
    assert.equal(r.cls, "ELIGIBLE");
    assert.equal(r.nullGlassCells, 2);
  });

  test("non-DRAFT project is listed, not touched", () => {
    assert.equal(planProjectFill("SUBMITTED", true, [design]).cls, "SKIP_NOT_DRAFT");
  });

  test("project without a glass Selection is listed, not touched", () => {
    assert.equal(planProjectFill("DRAFT", false, [design]).cls, "SKIP_NO_GLASS");
  });

  test("v1 design is listed, not touched", () => {
    const r = planProjectFill("DRAFT", true, [{ panels: [{ id: "p", selectionId: null }] }]);
    assert.equal(r.cls, "SKIP_V1");
    assert.equal(r.v1Designs, 1);
  });

  test("a fully filled design needs nothing (a second plan after apply is 0)", () => {
    const filled = v2([{ selectionId: "G" }], [{ selectionId: "G" }, { selectionId: null, hinging: "right" }]);
    assert.equal(planProjectFill("DRAFT", true, [filled]).cls, "NOTHING");
    assert.equal(countNullGlassCells(filled).cells, 0);
  });

  test("empty / missing designs need nothing", () => {
    assert.equal(planProjectFill("DRAFT", true, [null, {}]).cls, "NOTHING");
  });
});
