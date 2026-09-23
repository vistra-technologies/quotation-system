/**
 * Unit tests for validateFormulaSetBody() (Stage 24 Batch 2).
 *
 * Pure — no DB. Covers every case in the Batch 2 acceptance checklist, including the v1 regression
 * case (existing glass-partition-standard-v1.json must still validate without errors).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import formulaSetV1Doc from "../../prisma/formula-sets/glass-partition-standard-v1.json";
import { validateFormulaSetBody } from "../../lib/formula-set/validate";

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────────

/** Minimal valid v2 body with one formula. */
function minimalV2(overrides?: Record<string, unknown>) {
  return {
    schemaVersion: 2,
    slots: {
      GLASS: {
        role: "glass",
        requiredParams: [{ key: "glassCode" }],
      },
    },
    formulas: [
      {
        id: "glassPanel",
        slot: "GLASS",
        grain: "CELL",
        materialCode: "{param.glassCode}",
        unit: "pieces",
        quantity: "1",
        ...overrides,
      },
    ],
  };
}

// ── v1 regression ─────────────────────────────────────────────────────────────────────────────

describe("v1 regression (Stage 23 seeded document)", () => {
  test("glass-partition-standard-v1.json validates and loads without errors", () => {
    const result = validateFormulaSetBody(formulaSetV1Doc);
    assert.equal(result.ok, true, `expected ok:true but got errors: ${result.ok ? "" : (result as { ok: false; errors: string[] }).errors.join(", ")}`);
  });
});

// ── v2 — Validator 1: undeclared param.* ──────────────────────────────────────────────────────

describe("Validator 1 — undeclared param.*", () => {
  test("undeclared param.x in condition → rejected", () => {
    const body = minimalV2({ condition: "param.x > 0" });
    const result = validateFormulaSetBody(body);
    assert.equal(result.ok, false);
    assert.ok(
      (result as { ok: false; errors: string[] }).errors.some((e) => e.includes("param.x") && e.includes("glassPanel")),
      `expected error mentioning param.x and formula id, got: ${(result as { ok: false; errors: string[] }).errors.join("; ")}`,
    );
  });

  test("undeclared param.x in quantity → rejected", () => {
    const body = minimalV2({ quantity: "param.x * 2" });
    const result = validateFormulaSetBody(body);
    assert.equal(result.ok, false);
    assert.ok(
      (result as { ok: false; errors: string[] }).errors.some((e) => e.includes("param.x") && e.includes("glassPanel")),
    );
  });

  test("undeclared param.x in materialCode → rejected", () => {
    const body = minimalV2({ materialCode: "{param.x}" });
    const result = validateFormulaSetBody(body);
    assert.equal(result.ok, false);
    assert.ok(
      (result as { ok: false; errors: string[] }).errors.some((e) => e.includes("param.x") && e.includes("glassPanel")),
    );
  });
});

// ── v2 — Validator 2: calc.* references ──────────────────────────────────────────────────────

describe("Validator 2 — calc.* references", () => {
  test("forward calc.* reference (formula later in array) → rejected", () => {
    const body = {
      schemaVersion: 2,
      slots: {
        GLASS: { role: "glass", requiredParams: [] },
      },
      formulas: [
        // first formula references the second — forward reference
        {
          id: "aaa",
          slot: "GLASS",
          grain: "CELL",
          materialCode: "GLASS-001",
          unit: "pieces",
          quantity: "calc.bbb + 1",
        },
        {
          id: "bbb",
          slot: "GLASS",
          grain: "CELL",
          materialCode: "GLASS-002",
          unit: "pieces",
          quantity: "1",
        },
      ],
    };
    const result = validateFormulaSetBody(body);
    assert.equal(result.ok, false);
    assert.ok(
      (result as { ok: false; errors: string[] }).errors.some((e) => e.includes("calc.bbb") && e.includes("aaa")),
      `expected error mentioning calc.bbb and formula aaa, got: ${(result as { ok: false; errors: string[] }).errors.join("; ")}`,
    );
  });

  test("cross-grain calc.* reference (PARTITION-grain refs CELL-grain id) → rejected", () => {
    const body = {
      schemaVersion: 2,
      slots: {
        GLASS: { role: "glass", requiredParams: [] },
      },
      formulas: [
        {
          id: "cellBase",
          slot: "GLASS",
          grain: "CELL",
          materialCode: "GLASS-001",
          unit: "pieces",
          quantity: "1",
        },
        {
          id: "partTotal",
          slot: "GLASS",
          grain: "PARTITION",
          materialCode: "GLASS-002",
          unit: "metres",
          quantity: "calc.cellBase + 1",  // cross-grain: CELL id referenced from PARTITION
        },
      ],
    };
    const result = validateFormulaSetBody(body);
    assert.equal(result.ok, false);
    assert.ok(
      (result as { ok: false; errors: string[] }).errors.some((e) => e.includes("calc.cellBase") && e.includes("partTotal")),
      `expected error mentioning calc.cellBase and partTotal, got: ${(result as { ok: false; errors: string[] }).errors.join("; ")}`,
    );
  });

  test("self-referencing calc.<own-id> → rejected (not a backward reference)", () => {
    // A formula whose own quantity references calc.<its own id> must be rejected.
    // Confirmed empirically in review-b2-1: the original code accepted this because it registered
    // the id before scanning the formula's own expressions.
    const body = {
      schemaVersion: 2,
      slots: { GLASS: { role: "glass", requiredParams: [] } },
      formulas: [
        {
          id: "selfRef",
          slot: "GLASS",
          grain: "CELL",
          materialCode: "GLASS-001",
          unit: "pieces",
          quantity: "calc.selfRef + 1",  // self-reference — must be rejected
        },
      ],
    };
    const result = validateFormulaSetBody(body);
    assert.equal(result.ok, false);
    assert.ok(
      (result as { ok: false; errors: string[] }).errors.some((e) => e.includes("calc.selfRef") && e.includes("selfRef")),
      `expected error mentioning calc.selfRef and formula id, got: ${(result as { ok: false; errors: string[] }).errors.join("; ")}`,
    );
  });

  test("backward same-grain calc.* reference → accepted", () => {
    const body = {
      schemaVersion: 2,
      slots: {
        GLASS: { role: "glass", requiredParams: [] },
      },
      formulas: [
        {
          id: "base",
          slot: "GLASS",
          grain: "CELL",
          materialCode: "GLASS-001",
          unit: "pieces",
          quantity: "2",
        },
        {
          id: "derived",
          slot: "GLASS",
          grain: "CELL",
          materialCode: "GLASS-002",
          unit: "pieces",
          quantity: "calc.base * 3",  // backward reference, same grain — valid
        },
      ],
    };
    const result = validateFormulaSetBody(body);
    assert.equal(result.ok, true, `expected ok:true but got: ${result.ok ? "" : (result as { ok: false; errors: string[] }).errors.join("; ")}`);
  });
});

// ── v2 — hygiene checks ──────────────────────────────────────────────────────────────────────

describe("v2 hygiene checks", () => {
  test("grain: ROOM_SIDE → rejected as not implemented", () => {
    const body = minimalV2({ grain: "ROOM_SIDE" });
    const result = validateFormulaSetBody(body);
    assert.equal(result.ok, false);
    assert.ok(
      (result as { ok: false; errors: string[] }).errors.some((e) => /ROOM_SIDE.*not yet implemented|not yet implemented.*ROOM_SIDE/i.test(e)),
      `expected not-implemented error, got: ${(result as { ok: false; errors: string[] }).errors.join("; ")}`,
    );
  });

  test("hyphenated id (frame-profile) → rejected", () => {
    const body = minimalV2({ id: "frame-profile" });
    const result = validateFormulaSetBody(body);
    assert.equal(result.ok, false);
    assert.ok(
      (result as { ok: false; errors: string[] }).errors.some((e) => e.includes("frame-profile") && /camelCase/i.test(e)),
    );
  });

  test("non-camelCase id starting with uppercase (FrameProfile) → rejected", () => {
    const body = minimalV2({ id: "FrameProfile" });
    const result = validateFormulaSetBody(body);
    assert.equal(result.ok, false);
    assert.ok(
      (result as { ok: false; errors: string[] }).errors.some((e) => e.includes("FrameProfile") && /camelCase/i.test(e)),
    );
  });

  test("duplicate id → rejected", () => {
    const body = {
      schemaVersion: 2,
      slots: { GLASS: { role: "glass", requiredParams: [] } },
      formulas: [
        { id: "glassPanel", slot: "GLASS", grain: "CELL", materialCode: "G1", unit: "pieces", quantity: "1" },
        { id: "glassPanel", slot: "GLASS", grain: "CELL", materialCode: "G2", unit: "pieces", quantity: "2" },
      ],
    };
    const result = validateFormulaSetBody(body);
    assert.equal(result.ok, false);
    assert.ok(
      (result as { ok: false; errors: string[] }).errors.some((e) => /duplicate/i.test(e) && e.includes("glassPanel")),
    );
  });

  test("bad unit (cm) → rejected", () => {
    const body = minimalV2({ unit: "cm" });
    const result = validateFormulaSetBody(body);
    assert.equal(result.ok, false);
    assert.ok(
      (result as { ok: false; errors: string[] }).errors.some((e) => e.includes("glassPanel") && /unit/i.test(e)),
    );
  });

  test("unparseable quantity expression → rejected", () => {
    const body = minimalV2({ quantity: "((( not valid" });
    const result = validateFormulaSetBody(body);
    assert.equal(result.ok, false);
    assert.ok(
      (result as { ok: false; errors: string[] }).errors.some((e) => e.includes("glassPanel") && /quantity/i.test(e)),
    );
  });

  test("cell.* reference in a PARTITION-grain formula → rejected", () => {
    const body = minimalV2({ grain: "PARTITION", quantity: "cell.width * 2" });
    const result = validateFormulaSetBody(body);
    assert.equal(result.ok, false);
    assert.ok(
      (result as { ok: false; errors: string[] }).errors.some((e) => e.includes("glassPanel") && /cell\.\*/i.test(e)),
    );
  });

  test("minimal well-formed v2 body → accepted", () => {
    const result = validateFormulaSetBody(minimalV2());
    assert.equal(result.ok, true, `expected ok:true, got: ${result.ok ? "" : (result as { ok: false; errors: string[] }).errors.join("; ")}`);
  });

  test("body that is not an object → rejected with one error", () => {
    const result = validateFormulaSetBody("not an object");
    assert.equal(result.ok, false);
    assert.equal((result as { ok: false; errors: string[] }).errors.length, 1);
  });
});

// ── Forbidden logical operators (||, &&, !) ───────────────────────────────────────────────────

describe("Forbidden logical operators in condition/quantity", () => {
  test("condition containing || → rejected with error naming formula id and recommending 'or'", () => {
    const body = minimalV2({ condition: "param.glassCode == 'A' || param.glassCode == 'B'" });
    const result = validateFormulaSetBody(body);
    assert.equal(result.ok, false);
    const errors = (result as { ok: false; errors: string[] }).errors;
    assert.ok(errors.some(e => e.includes("glassPanel") && e.includes("||") && e.includes("or")),
      `expected error naming "glassPanel", "||", and "or"; got: ${errors.join("; ")}`);
  });

  test("quantity containing || → rejected", () => {
    const body = minimalV2({ quantity: "1 || 2" });
    const result = validateFormulaSetBody(body);
    assert.equal(result.ok, false);
    assert.ok(
      (result as { ok: false; errors: string[] }).errors.some(e => e.includes("||")),
    );
  });

  test("condition containing && → rejected with error recommending 'and'", () => {
    const body = minimalV2({ condition: "param.glassCode == 'A' && param.glassCode != 'B'" });
    const result = validateFormulaSetBody(body);
    assert.equal(result.ok, false);
    const errors = (result as { ok: false; errors: string[] }).errors;
    assert.ok(errors.some(e => e.includes("&&") && e.includes("and")),
      `expected error naming "&&" and "and"; got: ${errors.join("; ")}`);
  });

  test("condition containing ! (prefix logical-not attempt) → rejected with error recommending 'not'", () => {
    // "!param.glassCode" — likely written as logical NOT; in expr-eval "!" is factorial
    const body = minimalV2({ condition: "!param.glassCode" });
    const result = validateFormulaSetBody(body);
    assert.equal(result.ok, false);
    const errors = (result as { ok: false; errors: string[] }).errors;
    assert.ok(errors.some(e => e.includes("!") && e.includes("not")),
      `expected error naming "!" and "not"; got: ${errors.join("; ")}`);
  });

  test("condition using != (valid inequality) → accepted", () => {
    // "!=" is a valid comparison operator; should NOT be caught by the ! guard
    const body = minimalV2({ condition: "param.glassCode != 'X'" });
    const result = validateFormulaSetBody(body);
    assert.equal(result.ok, true, `expected ok:true, got: ${result.ok ? "" : (result as { ok: false; errors: string[] }).errors.join("; ")}`);
  });

  test("condition using 'or'/'and'/'not' keywords → accepted", () => {
    const body = {
      schemaVersion: 2,
      slots: { GLASS: { role: "glass", requiredParams: [{ key: "glassCode" }, { key: "otherCode" }] } },
      formulas: [{
        id: "glassPanel",
        slot: "GLASS", grain: "CELL",
        condition: "param.glassCode == 'A' or param.otherCode == 'B'",
        materialCode: "{param.glassCode}", unit: "pieces", quantity: "1",
      }],
    };
    const result = validateFormulaSetBody(body);
    assert.equal(result.ok, true, `expected ok:true, got: ${result.ok ? "" : (result as { ok: false; errors: string[] }).errors.join("; ")}`);
  });
});

// ── Validator 2: cross-slot calc.* reference ─────────────────────────────────────────────────

describe("Validator 2 — cross-slot calc.* reference rejected", () => {
  test("DOOR formula referencing calc.glassPanel (GLASS slot, same grain) → rejected", () => {
    const body = {
      schemaVersion: 2,
      slots: {
        GLASS: { role: "glass", requiredParams: [{ key: "glassCode" }] },
        DOOR: { role: "door", requiredParams: [{ key: "frameCode" }] },
      },
      formulas: [
        {
          id: "glassPanel",
          slot: "GLASS", grain: "CELL",
          materialCode: "{param.glassCode}", unit: "pieces", quantity: "1",
        },
        {
          id: "doorFrame",
          slot: "DOOR", grain: "CELL",
          materialCode: "{param.frameCode}", unit: "pieces",
          quantity: "calc.glassPanel * 2",  // cross-slot reference
        },
      ],
    };
    const result = validateFormulaSetBody(body);
    assert.equal(result.ok, false);
    const errors = (result as { ok: false; errors: string[] }).errors;
    assert.ok(errors.some(e => e.includes("doorFrame") && e.includes("calc.glassPanel") && e.includes("cross-slot")),
      `expected cross-slot error for doorFrame; got: ${errors.join("; ")}`);
  });

  test("same-slot backward calc.* reference → still accepted", () => {
    const body = {
      schemaVersion: 2,
      slots: { GLASS: { role: "glass", requiredParams: [{ key: "glassCode" }, { key: "frameCode" }] } },
      formulas: [
        {
          id: "glassPanel",
          slot: "GLASS", grain: "CELL",
          materialCode: "{param.glassCode}", unit: "pieces", quantity: "1",
        },
        {
          id: "glassGasket",
          slot: "GLASS", grain: "CELL",
          materialCode: "{param.frameCode}", unit: "metres",
          quantity: "calc.glassPanel * 0.5",  // same-slot backward ref — valid
        },
      ],
    };
    const result = validateFormulaSetBody(body);
    assert.equal(result.ok, true, `expected ok:true, got: ${result.ok ? "" : (result as { ok: false; errors: string[] }).errors.join("; ")}`);
  });
});
