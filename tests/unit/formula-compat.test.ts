/**
 * Unit tests for lib/formula-compat.ts (Stage 23 Batch 3) — pure, no DB.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  keysReferencedBySet,
  checkStructuralCompatibility,
  slotForCode,
  removedReferencedKeys,
  checkComponentTypeGuard,
  describeGuardViolation,
} from "../../lib/formula-compat";
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

// ─── Batch 6 — key-edit + type-lifecycle guard ────────────────────────────────

const oldGlassSchema = [f("glassType"), f("thickness")];
const oldDoorSchema = [f("category"), f("doorType")];

describe("slotForCode", () => {
  test("returns the slot for a known code", () => {
    assert.deepEqual(slotForCode(body, "GLASS"), body.slots.GLASS);
  });
  test("undefined for unknown code, or when there is no body", () => {
    assert.equal(slotForCode(body, "NOPE"), undefined);
    assert.equal(slotForCode(null, "GLASS"), undefined);
    assert.equal(slotForCode(undefined, "GLASS"), undefined);
  });
});

describe("removedReferencedKeys", () => {
  test("empty when nothing referenced disappears", () => {
    assert.deepEqual(removedReferencedKeys(body, "GLASS", oldGlassSchema, oldGlassSchema), []);
  });
  test("a referenced key removed from fieldsSchema is flagged, tagged by summaryParams", () => {
    const newSchema = [f("thickness")]; // glassType dropped
    assert.deepEqual(removedReferencedKeys(body, "GLASS", oldGlassSchema, newSchema), [
      { key: "glassType", paramKind: "summary" },
    ]);
  });
  test("a referenced key renamed (old key gone, new one added) is flagged the same as a removal", () => {
    const newSchema = [f("thickness"), f("glassTypeRenamed")];
    assert.deepEqual(removedReferencedKeys(body, "GLASS", oldGlassSchema, newSchema), [
      { key: "glassType", paramKind: "summary" },
    ]);
  });
  test("removing a DOOR key is tagged too (D-24: category is a summary param there as well)", () => {
    const newSchema = [f("doorType")]; // category dropped
    assert.deepEqual(removedReferencedKeys(body, "DOOR", oldDoorSchema, newSchema), [
      { key: "category", paramKind: "summary" },
    ]);
  });
  test("empty when the set has no slot for the code", () => {
    assert.deepEqual(removedReferencedKeys(body, "NOPE", oldGlassSchema, []), []);
  });
  test("empty when the slot has no referenced keys (empty requiredParams, no summaryParams)", () => {
    const b: FormulaSetBody = { slots: { X: { role: "glass", requiredParams: [] } }, formulas: [] };
    assert.deepEqual(removedReferencedKeys(b, "X", [f("a")], []), []);
  });
});

describe("checkComponentTypeGuard", () => {
  test("no active set (null body) -> always allow", () => {
    assert.deepEqual(
      checkComponentTypeGuard(null, { code: "GLASS", fieldsSchema: oldGlassSchema, patch: { active: false } }),
      { ok: true },
    );
  });
  test("no slot for this code -> always allow", () => {
    assert.deepEqual(
      checkComponentTypeGuard(body, { code: "CUSTOM", fieldsSchema: [], patch: { active: false }, isDelete: true }),
      { ok: true },
    );
  });
  test("case 1: removing a referenced key -> blocked", () => {
    const r = checkComponentTypeGuard(body, {
      code: "GLASS",
      fieldsSchema: oldGlassSchema,
      patch: { fieldsSchema: [f("thickness")] },
    });
    assert.deepEqual(r, {
      ok: false,
      violation: { kind: "KEY_REMOVED", code: "GLASS", key: "glassType", paramKind: "summary" },
    });
  });
  test("editing a non-referenced aspect of fieldsSchema (label/hint/options) is allowed", () => {
    const relabeled = [{ ...oldGlassSchema[0], label: "Glass Type (renamed)" }, oldGlassSchema[1]];
    assert.deepEqual(
      checkComponentTypeGuard(body, { code: "GLASS", fieldsSchema: oldGlassSchema, patch: { fieldsSchema: relabeled } }),
      { ok: true },
    );
  });
  test("adding a new field alongside the existing ones is allowed", () => {
    const withExtra = [...oldGlassSchema, f("newField", false)];
    assert.deepEqual(
      checkComponentTypeGuard(body, { code: "GLASS", fieldsSchema: oldGlassSchema, patch: { fieldsSchema: withExtra } }),
      { ok: true },
    );
  });
  test("case 2: changing the code away from the slot's code -> blocked", () => {
    const r = checkComponentTypeGuard(body, {
      code: "GLASS",
      fieldsSchema: oldGlassSchema,
      patch: { code: "GLASS2" },
    });
    assert.deepEqual(r, { ok: false, violation: { kind: "CODE_CHANGED", oldCode: "GLASS", newCode: "GLASS2" } });
  });
  test("changing code to the same value is a no-op, not blocked", () => {
    assert.deepEqual(
      checkComponentTypeGuard(body, { code: "GLASS", fieldsSchema: oldGlassSchema, patch: { code: "GLASS" } }),
      { ok: true },
    );
  });
  test("case 3: active:false on a slot type -> blocked", () => {
    const r = checkComponentTypeGuard(body, { code: "DOOR", fieldsSchema: oldDoorSchema, patch: { active: false } });
    assert.deepEqual(r, { ok: false, violation: { kind: "DEACTIVATED", code: "DOOR" } });
  });
  test("active:true (or omitted) is allowed", () => {
    assert.deepEqual(
      checkComponentTypeGuard(body, { code: "DOOR", fieldsSchema: oldDoorSchema, patch: { active: true } }),
      { ok: true },
    );
    assert.deepEqual(checkComponentTypeGuard(body, { code: "DOOR", fieldsSchema: oldDoorSchema, patch: {} }), {
      ok: true,
    });
  });
  test("isDelete on a slot type -> blocked regardless of patch", () => {
    const r = checkComponentTypeGuard(body, { code: "GLASS", isDelete: true });
    assert.deepEqual(r, { ok: false, violation: { kind: "DELETED", code: "GLASS" } });
  });
  test("v1 slot with empty requiredParams and no summaryParams key removed is unaffected", () => {
    const b: FormulaSetBody = { slots: { X: { role: "glass", requiredParams: [] } }, formulas: [] };
    assert.deepEqual(
      checkComponentTypeGuard(b, { code: "X", fieldsSchema: [f("a")], patch: { fieldsSchema: [] } }),
      { ok: true },
    );
  });
});

describe("describeGuardViolation", () => {
  test("KEY_REMOVED names set, version, slot and param", () => {
    const msg = describeGuardViolation(
      { kind: "KEY_REMOVED", code: "GLASS", key: "glassType", paramKind: "summary" },
      { name: "Standard", version: 1 },
    );
    assert.match(msg, /Standard v1/);
    assert.match(msg, /glassType/);
    assert.match(msg, /GLASS/);
    assert.match(msg, /summary/);
  });
  test("CODE_CHANGED, DEACTIVATED, DELETED each name the set version and the slot code", () => {
    const set = { name: "Standard", version: 2 };
    const codeChanged = describeGuardViolation({ kind: "CODE_CHANGED", oldCode: "GLASS", newCode: "G2" }, set);
    assert.match(codeChanged, /GLASS/);
    assert.match(codeChanged, /Standard v2/);
    const deactivated = describeGuardViolation({ kind: "DEACTIVATED", code: "DOOR" }, set);
    assert.match(deactivated, /DOOR/);
    assert.match(deactivated, /Standard v2/);
    const deleted = describeGuardViolation({ kind: "DELETED", code: "DOOR" }, set);
    assert.match(deleted, /DOOR/);
    assert.match(deleted, /Standard v2/);
  });
});
