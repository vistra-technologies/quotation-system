/**
 * Unit tests for the seeded v1 FormulaSet document (Stage 23 Batch 2).
 *
 * Pure — no DB. Covers the stage doc's Batch 2 acceptance checklist items that are checkable
 * without a live database: the JSON document itself, its cross-references into
 * lib/component-catalog-seed.ts's starter catalog, and the "no expr-eval yet" static check.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import formulaSetDoc from "../../prisma/formula-sets/glass-partition-standard-v1.json";
import { COMPONENT_TYPE_DEFS, COMPONENT_TYPE_ORG_CONFIG_DEFS } from "../../lib/component-catalog-seed";
import { isComponentTypeFullyConfigured } from "../../lib/configurator-gating";
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

describe("expr-eval is not installed (decision 10 deferred to Stage 25)", () => {
  test("package.json has no expr-eval dependency", () => {
    const pkgPath = path.resolve(__dirname, "../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    assert.ok(!pkg.dependencies?.["expr-eval"]);
    assert.ok(!pkg.devDependencies?.["expr-eval"]);
  });
});

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
