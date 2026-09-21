/**
 * Unit tests for lib/data/calculations.ts's checkDesignReadyForSubmit() (Stage 23 Batch 5, decision 13b).
 * Pure — no DB. Verifies a null/incomplete design is caught here, BEFORE it would ever reach
 * lib/summary's buildSummary() (worklog review-4 carry-forward (b)).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkDesignReadyForSubmit } from "../../lib/data/calculations";
import type { SummaryInput } from "../../lib/summary/types";

function floors(partitions: SummaryInput["floors"][number]["rooms"][number]["partitions"]): SummaryInput["floors"] {
  return [{ id: "f1", label: "Floor 1", rooms: [{ id: "r1", label: "Room 1", partitions }] }];
}

const cell = (id: string, selectionId: string | null) => ({ id, heightMm: 2400, selectionId });
const section = (id: string, cells: ReturnType<typeof cell>[]) => ({ id, widthMm: 1000, cells });

describe("checkDesignReadyForSubmit", () => {
  test("fully assigned design -> no violations", () => {
    const p = { id: "p1", label: "Wall A", widthMm: 1000, heightMm: 2400, design: { schemaVersion: 2, sections: [section("s1", [cell("c1", "sel-1")])] } };
    const violations = checkDesignReadyForSubmit(floors([p]), new Set(["sel-1"]));
    assert.deepEqual(violations, []);
  });

  test("null design -> one violation naming the partition, not a builder crash", () => {
    const p = { id: "p1", label: "Wall A", widthMm: 1000, heightMm: 2400, design: null };
    const violations = checkDesignReadyForSubmit(floors([p]), new Set());
    assert.equal(violations.length, 1);
    assert.match(violations[0].message, /Wall A.*design has not been started/);
    assert.equal(violations[0].partitionId, "p1");
  });

  test("design with no sections[] -> violation, not a crash", () => {
    const p = { id: "p1", label: "Wall A", widthMm: 1000, heightMm: 2400, design: {} };
    const violations = checkDesignReadyForSubmit(floors([p]), new Set());
    assert.equal(violations.length, 1);
    assert.match(violations[0].message, /design has not been started/);
  });

  test("empty sections array -> violation", () => {
    const p = { id: "p1", label: "Wall A", widthMm: 1000, heightMm: 2400, design: { schemaVersion: 2, sections: [] } };
    const violations = checkDesignReadyForSubmit(floors([p]), new Set());
    assert.equal(violations.length, 1);
  });

  test("null selectionId on a cell -> violation naming partition + cell", () => {
    const p = { id: "p1", label: "Wall A", widthMm: 1000, heightMm: 2400, design: { schemaVersion: 2, sections: [section("s1", [cell("c1", null)])] } };
    const violations = checkDesignReadyForSubmit(floors([p]), new Set());
    assert.equal(violations.length, 1);
    assert.match(violations[0].message, /Wall A.*cell c1.*no selection assigned/);
    assert.equal(violations[0].cellId, "c1");
  });

  test("blank string selectionId -> treated the same as null", () => {
    const p = { id: "p1", label: "Wall A", widthMm: 1000, heightMm: 2400, design: { schemaVersion: 2, sections: [section("s1", [cell("c1", "")])] } };
    const violations = checkDesignReadyForSubmit(floors([p]), new Set());
    assert.equal(violations.length, 1);
  });

  test("selectionId that doesn't resolve to a loaded Selection -> violation", () => {
    const p = { id: "p1", label: "Wall A", widthMm: 1000, heightMm: 2400, design: { schemaVersion: 2, sections: [section("s1", [cell("c1", "ghost")])] } };
    const violations = checkDesignReadyForSubmit(floors([p]), new Set(["sel-1"]));
    assert.equal(violations.length, 1);
    assert.match(violations[0].message, /does not resolve within this project/);
  });

  test("multiple partitions/cells -> collects every violation, not just the first", () => {
    const p1 = { id: "p1", label: "Wall A", widthMm: 1000, heightMm: 2400, design: null };
    const p2 = { id: "p2", label: "Wall B", widthMm: 1000, heightMm: 2400, design: { schemaVersion: 2, sections: [section("s1", [cell("c1", null), cell("c2", "sel-1")])] } };
    const violations = checkDesignReadyForSubmit(floors([p1, p2]), new Set(["sel-1"]));
    assert.equal(violations.length, 2);
    assert.equal(violations[0].partitionId, "p1");
    assert.equal(violations[1].partitionId, "p2");
  });
});
