/**
 * Unit tests for the seeded v1 FormulaSet document (Stage 23 Batch 2).
 *
 * Pure — no DB. Covers the stage doc's Batch 2 acceptance checklist items that are checkable
 * without a live database: the JSON document itself, its cross-references into
 * lib/component-catalog-seed.ts's starter catalog, and the "no expr-eval yet" static check.
 *
 * Stage 24 Batch 3: adds a describe block for cloisons-formula-set-v1.json, with full
 * cross-check tests (materialCode param keys, option value ↔ InventoryItem, unit).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import formulaSetDoc from "../../prisma/formula-sets/glass-partition-standard-v1.json";
import cloisonsDoc from "../../prisma/formula-sets/cloisons-formula-set-v1.json";
import { COMPONENT_TYPE_DEFS, COMPONENT_TYPE_ORG_CONFIG_DEFS } from "../../lib/component-catalog-seed";
import { CLOISONS_INVENTORY_DEFS } from "../../prisma/inventory/cloisons-inventory";
import { isComponentTypeFullyConfigured } from "../../lib/configurator-gating";
import { validateFormulaSetBody } from "../../lib/formula-set/validate";
import type { FieldEntry } from "../../lib/types/field-entry";
import type { FieldOptionsConfig } from "../../lib/types/field-options-config";
import { loadFormulaSetDocs, stableHash } from "../../prisma/seed-formula-sets";

type Slot = {
  role: string;
  requiredParams: unknown[];
  summaryParams: Record<string, string>;
};

describe("glass-partition-standard-v1.json", () => {
  test("parses, and formulas is [] (D-38 — slots-only)", () => {
    assert.deepEqual(formulaSetDoc.formulas, []);
  });

  test("no slot carries a numericType flag anywhere in the document", () => {
    const raw = JSON.stringify(formulaSetDoc);
    assert.ok(!raw.includes("numericType"), "numericType must not appear — decision 11 is deferred");
  });

  test("no slot references PROFILE_STOP (D-35)", () => {
    // Scoped to `slots` only — the JSON header's NOTE legitimately *mentions* PROFILE_STOP as
    // documentation (explaining why there's no such slot), so a whole-document string search
    // would false-positive on that prose.
    assert.ok(!("PROFILE_STOP" in formulaSetDoc.slots));
    const raw = JSON.stringify(formulaSetDoc.slots);
    assert.ok(!raw.includes("PROFILE_STOP"));
  });

  test("every slot declares a role, and role params match D-24's fixed set", () => {
    const slots = formulaSetDoc.slots as Record<string, Slot>;
    assert.equal(slots.GLASS.role, "glass");
    assert.equal(slots.DOOR.role, "door");
    assert.deepEqual(Object.keys(slots.GLASS.summaryParams).sort(), ["glassType", "thickness"]);
    assert.deepEqual(Object.keys(slots.DOOR.summaryParams).sort(), ["category", "doorType"]);
  });

  test("requiredParams is present and empty for every slot (D-38)", () => {
    const slots = formulaSetDoc.slots as Record<string, Slot>;
    for (const [code, slot] of Object.entries(slots)) {
      assert.deepEqual(slot.requiredParams, [], `${code}.requiredParams must be []`);
    }
  });

  test("the JSON header carries a NOTE documenting v1's formula-free status and no-PROFILE_STOP", () => {
    const doc = formulaSetDoc as unknown as { NOTE?: unknown };
    assert.ok(Array.isArray(doc.NOTE) && doc.NOTE.length > 0, "NOTE block must be present");
    const text = (doc.NOTE as string[]).join(" ");
    assert.ok(/formula-free/i.test(text));
    assert.ok(/v2/i.test(text));
    assert.ok(/PROFILE_STOP/.test(text));
  });

  test("every slot code exists in the starter catalog (lib/component-catalog-seed.ts)", () => {
    const catalogCodes = new Set(COMPONENT_TYPE_DEFS.map((d) => d.code));
    for (const code of Object.keys(formulaSetDoc.slots)) {
      assert.ok(catalogCodes.has(code), `slot code "${code}" is not a starter ComponentType code`);
    }
  });

  test("every summaryParams value names a real fieldsSchema key in the matching starter type", () => {
    const byCode = new Map(COMPONENT_TYPE_DEFS.map((d) => [d.code, new Set(d.fieldsSchema.map((f) => f.key))]));
    const slots = formulaSetDoc.slots as Record<string, Slot>;
    for (const [code, slot] of Object.entries(slots)) {
      const keys = byCode.get(code);
      assert.ok(keys, `no starter ComponentType def for slot code "${code}"`);
      for (const fieldKey of Object.values(slot.summaryParams)) {
        assert.ok(keys!.has(fieldKey), `"${code}" starter catalog has no field "${fieldKey}"`);
      }
    }
  });

  test("every summaryParams-referenced key is required:true in the starter catalog", () => {
    const byCode = new Map(
      COMPONENT_TYPE_DEFS.map((d) => [d.code, new Map(d.fieldsSchema.map((f) => [f.key, f.required]))]),
    );
    const slots = formulaSetDoc.slots as Record<string, Slot>;
    for (const [code, slot] of Object.entries(slots)) {
      const requiredByKey = byCode.get(code)!;
      for (const fieldKey of Object.values(slot.summaryParams)) {
        assert.equal(
          requiredByKey.get(fieldKey),
          true,
          `"${code}.${fieldKey}" must be required:true (shipped config must never produce a blank summary column)`,
        );
      }
    }
  });
});

// expr-eval is now installed (Stage 24 Batch 2 — validate.ts uses it for publish-time validation).
// The "not installed" guard that lived here through Stage 23 has been removed.

describe("seed-formula-sets.ts", () => {
  test("loadFormulaSetDocs() returns the v1 doc with slots/formulas only (NOTE stripped)", () => {
    const docs = loadFormulaSetDocs();
    const v1 = docs.find((d) => d.name === "glass-partition-standard" && d.version === 1);
    assert.ok(v1, "expected a glass-partition-standard@1 doc");
    const body = v1!.body as { slots: unknown; formulas: unknown[]; NOTE?: unknown };
    assert.deepEqual(body.formulas, []);
    assert.equal(body.NOTE, undefined, "NOTE is documentation only and must not be stored in body");
  });

  test("stableHash is order-independent and detects a real change", () => {
    const a = { x: 1, y: 2 };
    const b = { y: 2, x: 1 };
    const c = { x: 1, y: 3 };
    assert.equal(stableHash(a), stableHash(b));
    assert.notEqual(stableHash(a), stableHash(c));
  });
});

describe("starter catalog: seeded config is consistent with fieldsSchema (D-34 amended)", () => {
  test("every def has a config, and it satisfies isComponentTypeFullyConfigured against its own schema", () => {
    for (const def of COMPONENT_TYPE_DEFS) {
      const cfg = COMPONENT_TYPE_ORG_CONFIG_DEFS.find((c) => c.code === def.code);
      assert.ok(cfg, `${def.code} has no COMPONENT_TYPE_ORG_CONFIG_DEFS entry`);
      assert.ok(
        isComponentTypeFullyConfigured(def.fieldsSchema as FieldEntry[], cfg.fieldOptionsConfig as FieldOptionsConfig),
        `${def.code}: seeded config leaves the type not fully configured`,
      );
    }
  });

  test("config keys are exactly the schema's dropdown/radio keys (no orphaned or missing entries)", () => {
    for (const def of COMPONENT_TYPE_DEFS) {
      const cfg = COMPONENT_TYPE_ORG_CONFIG_DEFS.find((c) => c.code === def.code)!;
      const choiceKeys = def.fieldsSchema
        .filter((f) => f.type === "dropdown" || f.type === "radio")
        .map((f) => f.key)
        .sort();
      assert.deepEqual(Object.keys(cfg.fieldOptionsConfig).sort(), choiceKeys, def.code);
    }
  });

  test("the check is real: a stale old-shape config fails against the new schema", () => {
    const glass = COMPONENT_TYPE_DEFS.find((d) => d.code === "GLASS")!;
    const stale = { glassType: { options: ["Clear", "Frosted", "Tinted"] } } as FieldOptionsConfig;
    assert.equal(isComponentTypeFullyConfigured(glass.fieldsSchema as FieldEntry[], stale), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Stage 24 Batch 3: cloisons-formula-set-v1.json cross-check tests
// ─────────────────────────────────────────────────────────────────────────────────────────────────

type FormulaDef = {
  id: string;
  slot: string;
  grain: string;
  condition?: string;
  materialCode: string;
  unit: string;
  quantity: string;
};

type SlotDef = {
  role: string;
  summaryParams: Record<string, string>;
  requiredParams: Array<{ key: string }>;
};

/** Extract `{param.x}` substitution keys from a materialCode template string. */
function extractMaterialCodeParamKeys(materialCode: string): string[] {
  const keys: string[] = [];
  const re = /\{param\.([A-Za-z_][A-Za-z0-9_]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(materialCode)) !== null) keys.push(m[1]);
  return keys;
}

/** Extract `param.<key>` keys from an expression string. */
function extractParamKeys(expr: string): string[] {
  const keys: string[] = [];
  const re = /\bparam\.([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) keys.push(m[1]);
  return keys;
}

/** Extract `calc.<id>` ids from an expression string. */
function extractCalcIds(expr: string): string[] {
  const ids: string[] = [];
  const re = /\bcalc\.([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) ids.push(m[1]);
  return ids;
}

/** Get all option values (flat options array or all values from a valueMap) for a field. */
function getAllOptionValues(
  cfg: Record<string, { options: string[] } | { valueMap: Record<string, string[]> }>,
  fieldKey: string,
): string[] {
  const entry = cfg[fieldKey];
  if (!entry) return [];
  if ("options" in entry) return entry.options;
  // valueMap: collect all values across all parent values
  return Object.values(entry.valueMap).flat();
}

describe("cloisons-formula-set-v1.json", () => {
  const body = {
    schemaVersion: 2,
    slots: cloisonsDoc.slots as Record<string, SlotDef>,
    formulas: cloisonsDoc.formulas as FormulaDef[],
  };

  const glassCfg = COMPONENT_TYPE_ORG_CONFIG_DEFS.find((c) => c.code === "GLASS")!
    .fieldOptionsConfig as Record<string, { options: string[] } | { valueMap: Record<string, string[]> }>;
  const doorCfg = COMPONENT_TYPE_ORG_CONFIG_DEFS.find((c) => c.code === "DOOR")!
    .fieldOptionsConfig as Record<string, { options: string[] } | { valueMap: Record<string, string[]> }>;
  const inventoryCodes = new Set(CLOISONS_INVENTORY_DEFS.map((i) => i.code));
  const inventoryByCode = new Map(CLOISONS_INVENTORY_DEFS.map((i) => [i.code, i]));

  // ── 1. Validation passes ───────────────────────────────────────────────────
  test("validateFormulaSetBody passes (primary gate)", () => {
    const result = validateFormulaSetBody(body);
    if (!result.ok) {
      assert.fail(`Validation failed:\n${result.errors.join("\n")}`);
    }
  });

  // ── 2. schemaVersion ──────────────────────────────────────────────────────
  test("schemaVersion is 2", () => {
    assert.equal(body.schemaVersion, 2);
  });

  // ── 3. Slot codes exist in the starter catalog ────────────────────────────
  test("GLASS and DOOR slot codes exist in COMPONENT_TYPE_DEFS", () => {
    const catalogCodes = new Set(COMPONENT_TYPE_DEFS.map((d) => d.code));
    for (const code of Object.keys(body.slots)) {
      assert.ok(catalogCodes.has(code), `slot code "${code}" not found in COMPONENT_TYPE_DEFS`);
    }
  });

  // ── 4. requiredParams ↔ fieldsSchema cross-check ──────────────────────────
  test("every requiredParams key exists in the matching ComponentType fieldsSchema", () => {
    const fieldsByCode = new Map(
      COMPONENT_TYPE_DEFS.map((d) => [d.code, new Set(d.fieldsSchema.map((f) => f.key))]),
    );
    for (const [slotCode, slotDef] of Object.entries(body.slots)) {
      const schemaKeys = fieldsByCode.get(slotCode);
      assert.ok(schemaKeys, `no COMPONENT_TYPE_DEFS entry for slot "${slotCode}"`);
      for (const { key } of slotDef.requiredParams) {
        assert.ok(
          schemaKeys!.has(key),
          `slot "${slotCode}" requiredParam "${key}" not found in fieldsSchema`,
        );
      }
    }
  });

  // ── 5. materialCode param-key cross-check (⚠️ blocking, both directions) ─
  test("every {param.x} in materialCode is declared in its slot's requiredParams", () => {
    const requiredBySlot = new Map(
      Object.entries(body.slots).map(([code, slot]) => [
        code,
        new Set(slot.requiredParams.map((p) => p.key)),
      ]),
    );
    for (const f of body.formulas) {
      const declared = requiredBySlot.get(f.slot) ?? new Set<string>();
      for (const key of extractMaterialCodeParamKeys(f.materialCode)) {
        assert.ok(
          declared.has(key),
          `formula "${f.id}": materialCode references {param.${key}} which is not in ${f.slot}.requiredParams`,
        );
      }
    }
  });

  test("every requiredParams key appears in at least one formula's materialCode, condition, or quantity", () => {
    // Build a set of all param keys actually referenced across all formula expressions
    const referencedParamKeys = new Set<string>();
    for (const f of body.formulas) {
      for (const key of extractMaterialCodeParamKeys(f.materialCode)) referencedParamKeys.add(key);
      if (f.condition) {
        for (const key of extractParamKeys(f.condition)) referencedParamKeys.add(key);
      }
      for (const key of extractParamKeys(f.quantity)) referencedParamKeys.add(key);
    }
    for (const [slotCode, slotDef] of Object.entries(body.slots)) {
      for (const { key } of slotDef.requiredParams) {
        assert.ok(
          referencedParamKeys.has(key),
          `slot "${slotCode}" requiredParam "${key}" is not referenced in any formula's materialCode, condition, or quantity (orphaned param)`,
        );
      }
    }
  });

  // ── 6. Option value ↔ CLOISONS_INVENTORY_DEFS cross-check (⚠️ blocking) ──
  test("every code-field option value in GLASS config maps to a CLOISONS_INVENTORY_DEFS entry", () => {
    // Code fields = GLASS requiredParams keys (these all have materialCode uses)
    const glassCodeFields = body.slots.GLASS.requiredParams.map((p) => p.key);
    for (const fieldKey of glassCodeFields) {
      const values = getAllOptionValues(glassCfg, fieldKey);
      assert.ok(
        values.length > 0,
        `GLASS field "${fieldKey}" has no option values in COMPONENT_TYPE_ORG_CONFIG_DEFS`,
      );
      for (const v of values) {
        assert.ok(
          inventoryCodes.has(v),
          `GLASS field "${fieldKey}" option value "${v}" not found in CLOISONS_INVENTORY_DEFS`,
        );
      }
    }
  });

  test("every code-field option value in DOOR config maps to a CLOISONS_INVENTORY_DEFS entry (skipping hasFrame/hasLeaf)", () => {
    const conditionFields = new Set(["hasFrame", "hasLeaf"]);
    const doorCodeFields = body.slots.DOOR.requiredParams
      .map((p) => p.key)
      .filter((k) => !conditionFields.has(k));
    for (const fieldKey of doorCodeFields) {
      const values = getAllOptionValues(doorCfg, fieldKey);
      assert.ok(
        values.length > 0,
        `DOOR field "${fieldKey}" has no option values in COMPONENT_TYPE_ORG_CONFIG_DEFS`,
      );
      for (const v of values) {
        assert.ok(
          inventoryCodes.has(v),
          `DOOR field "${fieldKey}" option value "${v}" not found in CLOISONS_INVENTORY_DEFS`,
        );
      }
    }
  });

  test("every CLOISONS_INVENTORY_DEFS item is pointed at by at least one code-field option value", () => {
    // Collect all option values across GLASS + DOOR code fields
    const allOptionValues = new Set<string>();
    const conditionFields = new Set(["hasFrame", "hasLeaf"]);
    const glassCodeFields = body.slots.GLASS.requiredParams.map((p) => p.key);
    for (const fieldKey of glassCodeFields) {
      for (const v of getAllOptionValues(glassCfg, fieldKey)) allOptionValues.add(v);
    }
    const doorCodeFields = body.slots.DOOR.requiredParams
      .map((p) => p.key)
      .filter((k) => !conditionFields.has(k));
    for (const fieldKey of doorCodeFields) {
      for (const v of getAllOptionValues(doorCfg, fieldKey)) allOptionValues.add(v);
    }
    for (const item of CLOISONS_INVENTORY_DEFS) {
      assert.ok(
        allOptionValues.has(item.code),
        `CLOISONS_INVENTORY_DEFS item "${item.code}" is not referenced by any code-field option value (orphaned inventory row)`,
      );
    }
  });

  // ── 7. Unit cross-check (⚠️ blocking) ────────────────────────────────────
  test("every formula's unit matches its resolvable InventoryItem's measurementUnit", () => {
    const conditionFields = new Set(["hasFrame", "hasLeaf"]);
    const cfgBySlot: Record<string, typeof glassCfg> = { GLASS: glassCfg, DOOR: doorCfg };

    for (const f of body.formulas) {
      const paramKeys = extractMaterialCodeParamKeys(f.materialCode);
      // Skip formulas whose materialCode has no {param.x} (none expected, but guard)
      if (paramKeys.length === 0) continue;
      const [paramKey] = paramKeys;
      // Skip condition-only fields
      if (conditionFields.has(paramKey)) continue;

      const cfg = cfgBySlot[f.slot];
      assert.ok(cfg, `no config found for slot "${f.slot}"`);
      const optionValues = getAllOptionValues(cfg, paramKey);
      assert.ok(
        optionValues.length > 0,
        `formula "${f.id}": field "${paramKey}" has no option values — cannot cross-check unit`,
      );
      for (const code of optionValues) {
        const item = inventoryByCode.get(code);
        assert.ok(
          item,
          `formula "${f.id}": option value "${code}" for field "${paramKey}" not found in CLOISONS_INVENTORY_DEFS`,
        );
        assert.equal(
          item!.measurementUnit,
          f.unit,
          `formula "${f.id}": unit mismatch — formula declares "${f.unit}" but InventoryItem "${code}" has measurementUnit "${item!.measurementUnit}"`,
        );
      }
    }
  });

  // ── 8. Every formula has a known slot ────────────────────────────────────
  test("every formula slot is GLASS or DOOR", () => {
    const knownSlots = new Set(Object.keys(body.slots));
    for (const f of body.formulas) {
      assert.ok(
        knownSlots.has(f.slot),
        `formula "${f.id}" has unknown slot "${f.slot}"`,
      );
    }
  });

  // ── 9. No forbidden logic operators ─────────────────────────────────────
  test("no formula condition or quantity contains ||, &&, or bare !", () => {
    for (const f of body.formulas) {
      const exprs: string[] = [];
      if (f.condition) exprs.push(f.condition);
      exprs.push(f.quantity);
      for (const expr of exprs) {
        assert.ok(
          !/\|\|/.test(expr),
          `formula "${f.id}": expression contains "||" — use "or" for logical OR in expr-eval`,
        );
        assert.ok(
          !/&&/.test(expr),
          `formula "${f.id}": expression contains "&&" — use "and" for logical AND in expr-eval`,
        );
        assert.ok(
          !/!(?!=)/.test(expr),
          `formula "${f.id}": expression contains bare "!" — use "not" for logical NOT in expr-eval`,
        );
      }
    }
  });

  // ── 10. Formula ordering respects calc.* backward references ─────────────
  test("every calc.<id> reference points at a formula with a lower array index", () => {
    const idToIndex = new Map<string, number>();
    for (let i = 0; i < body.formulas.length; i++) {
      const f = body.formulas[i];
      const exprs: string[] = [];
      if (f.condition) exprs.push(f.condition);
      exprs.push(f.quantity);
      for (const expr of exprs) {
        for (const refId of extractCalcIds(expr)) {
          const refIdx = idToIndex.get(refId);
          assert.ok(
            refIdx !== undefined,
            `formula "${f.id}" (index ${i}): calc.${refId} is a forward reference or unknown id (not yet registered at index ${i})`,
          );
          assert.ok(
            refIdx! < i,
            `formula "${f.id}" (index ${i}): calc.${refId} at index ${refIdx} is not before index ${i}`,
          );
        }
      }
      idToIndex.set(f.id, i);
    }
  });

  // ── 11. loadFormulaSetDocs registers cloisons_formula_set, NOTE stripped ─
  test("cloisons_formula_set appears in loadFormulaSetDocs() and NOTE is stripped from body", () => {
    const docs = loadFormulaSetDocs();
    const cloisons = docs.find((d) => d.name === "cloisons_formula_set" && d.version === 1);
    assert.ok(cloisons, "expected a cloisons_formula_set@1 doc");
    const storedBody = cloisons!.body as {
      schemaVersion?: number;
      slots?: unknown;
      formulas?: unknown[];
      NOTE?: unknown;
    };
    assert.equal(storedBody.NOTE, undefined, "NOTE is documentation only and must not be stored in body");
    assert.equal(storedBody.schemaVersion, 2, "stored body must have schemaVersion: 2");
    assert.ok(Array.isArray(storedBody.formulas), "stored body must have a formulas array");
    assert.equal(storedBody.formulas!.length, 22, "expected 22 formulas in cloisons_formula_set@1");
  });
});
