/**
 * Unit tests for lib/formula-compat.ts (Stage 23 Batch 3) — pure, no DB.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { keysReferencedBySet, checkStructuralCompatibility } from "../../lib/formula-compat";
import type { ConfigSnapshot } from "../../lib/config-snapshot";
import type { FormulaSetBody } from "../../lib/summary/types";

const body: FormulaSetBody = {
  slots: {
    GLASS: { role: "glass", requiredParams: [], summaryParams: { glassType: "glassType", thickness: "thickness" } },
    DOOR: { role: "door", requiredParams: [], summaryParams: { category: "category", doorType: "doorType" } },
  },
  formulas: [],
};

const f = (key: string, required = true) => ({ key, label: key, type: "text", required });

function snap(types: Array<{ code: string; active?: boolean; keys: Array<[string, boolean?]> }>): ConfigSnapshot {
  return {
    takenAt: "2026-09-21T00:00:00.000Z",
    componentTypes: types.map((t, i) => ({
      id: `id-${i}`,
      code: t.code,
      name: t.code,
      active: t.active ?? true,
      fieldsSchema: t.keys.map(([k, r]) => f(k, r ?? true)),
      fieldOptionsConfig: {},
    })),
  };
}

const good = () =>
  snap([
    { code: "GLASS", keys: [["glassType"], ["thickness"]] },
    { code: "DOOR", keys: [["category"], ["doorType"]] },
  ]);

describe("keysReferencedBySet", () => {
  test("summaryParams values, with empty requiredParams (v1 shape)", () => {
    assert.deepEqual(keysReferencedBySet(body, "GLASS").sort(), ["glassType", "thickness"]);
  });
  test("union of requiredParams (strings or {key}) and summaryParams values, deduped", () => {
    const b = {
      slots: { X: { role: "glass", requiredParams: ["a", { key: "b" }, "glassType"], summaryParams: { glassType: "glassType" } } },
    } as unknown as FormulaSetBody;
    assert.deepEqual(keysReferencedBySet(b, "X").sort(), ["a", "b", "glassType"]);
  });
  test("unknown code / missing body -> []", () => {
    assert.deepEqual(keysReferencedBySet(body, "NOPE"), []);
    assert.deepEqual(keysReferencedBySet(null, "GLASS"), []);
    assert.deepEqual(keysReferencedBySet(body, "toString"), []);
  });
});

describe("checkStructuralCompatibility", () => {
  test("compatible", () => {
    assert.deepEqual(checkStructuralCompatibility(body, good()), { ok: true });
  });
  test("missing slot code", () => {
    const r = checkStructuralCompatibility(body, snap([{ code: "GLASS", keys: [["glassType"], ["thickness"]] }]));
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(r.missingCodes, ["DOOR"]);
  });
  test("inactive slot code is reported as missing", () => {
    const r = checkStructuralCompatibility(
      body,
      snap([
        { code: "GLASS", active: false, keys: [["glassType"], ["thickness"]] },
        { code: "DOOR", keys: [["category"], ["doorType"]] },
      ]),
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(r.missingCodes, ["GLASS"]);
  });
  test("missing summaryParams key", () => {
    const r = checkStructuralCompatibility(
      body,
      snap([
        { code: "GLASS", keys: [["glassType"]] },
        { code: "DOOR", keys: [["category"], ["doorType"]] },
      ]),
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(r.missingParams, [{ code: "GLASS", key: "thickness" }]);
  });
  test("summaryParams key present but required:false is still compatible", () => {
    const r = checkStructuralCompatibility(
      body,
      snap([
        { code: "GLASS", keys: [["glassType", false], ["thickness", false]] },
        { code: "DOOR", keys: [["category", false], ["doorType"]] },
      ]),
    );
    assert.deepEqual(r, { ok: true });
  });
  test("slot with empty requiredParams (v1) is compatible", () => {
    const b: FormulaSetBody = { slots: { GLASS: { role: "glass", requiredParams: [] } }, formulas: [] };
    assert.deepEqual(checkStructuralCompatibility(b, snap([{ code: "GLASS", keys: [] }])), { ok: true });
  });
  test("empty snapshot -> every slot code missing", () => {
    const r = checkStructuralCompatibility(body, snap([]));
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(r.missingCodes.sort(), ["DOOR", "GLASS"]);
  });
  test("null snapshot fails cleanly (no throw)", () => {
    const r = checkStructuralCompatibility(body, null);
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(r.missingCodes.sort(), ["DOOR", "GLASS"]);
  });
  test("malformed fieldsSchema is treated as no keys", () => {
    const s = good();
    s.componentTypes[0].fieldsSchema = null;
    const r = checkStructuralCompatibility(body, s);
    assert.equal(r.ok, false);
  });
});
