import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyFieldTypeChange,
  checkFieldsSchemaForWrite,
  normalizeFieldsSchemaForStore,
  validateFieldsSchema,
} from "@/lib/validate-fields-schema";
import { parseFieldsSchema as parseOrgFieldsSchema } from "@/lib/parse-field-config";
import { parseFieldsSchema as parseSuperAdminFieldsSchema } from "@/lib/data/superadmin/component-types";
import { diffConfigs } from "@/lib/config-update";
import { generateCombinations } from "@/lib/quick-estimate/palette";
import { specFieldList, countProductSpecs } from "@/lib/product-pricing/spec-fields";
import { combinationKey } from "@/lib/product-pricing/combination";
import type { FieldEntry } from "@/lib/types/field-entry";

// Stage 36 Batch 1: the productSpec flag (S36-1, S36-2, S36-4) and the O-2 generator edge case (AC6).

const f = (key: string, over: Partial<FieldEntry> = {}): FieldEntry => ({
  key, label: key, type: "dropdown", required: false, basic: true, ...over,
});

// ─── AC1: both parsers, normalize, retype ────────────────────────────────────

for (const [name, parse] of [
  ["org parseFieldsSchema", parseOrgFieldsSchema],
  ["SuperAdmin parseFieldsSchema", parseSuperAdminFieldsSchema],
] as const) {
  test(`${name} passes productSpec true through and drops false and junk`, () => {
    const out = parse([
      { key: "a", label: "A", type: "dropdown", required: false, basic: true, productSpec: true },
      { key: "b", label: "B", type: "dropdown", required: false, basic: true, productSpec: false },
      { key: "c", label: "C", type: "dropdown", required: false, basic: true, productSpec: "yes" },
      { key: "d", label: "D", type: "dropdown", required: false, basic: true },
    ]);
    assert.equal(out[0].productSpec, true);
    assert.ok(!("productSpec" in out[1]));
    assert.ok(!("productSpec" in out[2]));
    assert.ok(!("productSpec" in out[3]));
  });
}

test("normalizeFieldsSchemaForStore stores productSpec false as absent and keeps true", () => {
  const out = normalizeFieldsSchemaForStore([
    f("a", { productSpec: false }),
    f("b", { productSpec: true }),
    f("c", { productSpec: false, inventoryLinked: false }),
    f("d", { inventoryLinked: true }),
  ]);
  assert.ok(!("productSpec" in out[0]));
  assert.equal(out[1].productSpec, true);
  assert.ok(!("productSpec" in out[2]) && !("inventoryLinked" in out[2]));
  assert.equal(out[3].inventoryLinked, true);
});

test("applyFieldTypeChange to field or checkbox removes productSpec, radio keeps it", () => {
  const spec = f("a", { productSpec: true });
  assert.ok(!("productSpec" in applyFieldTypeChange(spec, "field")));
  assert.ok(!("productSpec" in applyFieldTypeChange(spec, "checkbox")));
  assert.equal(applyFieldTypeChange(spec, "radio").productSpec, true);
  // the retyped result no longer 400s on Save
  assert.equal(validateFieldsSchema([applyFieldTypeChange(spec, "field")]).valid, true);
});

// ─── AC3: validator ──────────────────────────────────────────────────────────

test("productSpec true is accepted on dropdown and radio, false is accepted anywhere", () => {
  assert.equal(checkFieldsSchemaForWrite([f("a", { productSpec: true }), f("b", { type: "radio", productSpec: true })]).valid, true);
  assert.equal(checkFieldsSchemaForWrite([f("a", { type: "field", productSpec: false })]).valid, true);
});

test("productSpec true on a field or checkbox is rejected", () => {
  for (const type of ["field", "checkbox"] as const) {
    const r = validateFieldsSchema([f("a", { type, productSpec: true })]);
    assert.equal(r.valid, false);
    if (!r.valid) assert.match(r.error, /productSpec.*dropdown\/radio/);
  }
});

test("a non-boolean productSpec is rejected", () => {
  for (const bad of ["true", 1, null, {}]) {
    const r = validateFieldsSchema([f("a", { productSpec: bad as unknown as boolean })]);
    assert.equal(r.valid, false);
    if (!r.valid) assert.match(r.error, /must be a boolean/);
  }
});

test("a flagged dependsOn child needs a flagged parent (S36-2), the message names both", () => {
  const bad = validateFieldsSchema([f("glassType", { label: "Glass type" }), f("thickness", { label: "Thickness", dependsOn: "glassType", productSpec: true })]);
  assert.equal(bad.valid, false);
  if (!bad.valid) {
    assert.match(bad.error, /Thickness/);
    assert.match(bad.error, /Glass type/);
  }
  assert.equal(
    validateFieldsSchema([f("glassType", { productSpec: true }), f("thickness", { dependsOn: "glassType", productSpec: true })]).valid,
    true,
  );
  // an unflagged child of an unflagged parent, and an unflagged child of a flagged parent, are fine
  assert.equal(validateFieldsSchema([f("p"), f("c", { dependsOn: "p" })]).valid, true);
  assert.equal(validateFieldsSchema([f("p", { productSpec: true }), f("c", { dependsOn: "p" })]).valid, true);
});

test("O-2 (b): a productSpec field gated by a non-spec showWhen controller is accepted", () => {
  const r = validateFieldsSchema([
    f("category"),
    f("glassType", { productSpec: true, showWhen: { field: "category", in: ["Partition"] } }),
  ]);
  assert.equal(r.valid, true);
});

// ─── AC4: not a project change (S36-4) ───────────────────────────────────────

test("a productSpec change produces no diffConfigs line (so no update banner from it)", () => {
  const type = (fields: FieldEntry[]) => ({
    id: "t1", code: "GLASS", name: "Glass", active: true, fieldsSchema: fields, fieldOptionsConfig: {},
  });
  const before = type([f("a"), f("b")]);
  const after = type([f("a", { productSpec: true }), f("b", { productSpec: true })]);
  assert.deepEqual(diffConfigs([before], [after]), []);
  assert.deepEqual(diffConfigs([after], [before]), []);
});

// ─── AC6: O-2 edge case in the combination generator ─────────────────────────

test("a spec field gated by a non-spec controller appears in every combination, deterministic keys and labels", () => {
  const schema: FieldEntry[] = [
    f("category"), // not a product spec
    f("glassType", { productSpec: true, showWhen: { field: "category", in: ["Partition"] } }),
    f("thickness", { productSpec: true, dependsOn: "glassType" }),
  ];
  const fields = specFieldList(schema);
  assert.deepEqual(fields.map((x) => x.key), ["glassType", "thickness"]);
  assert.equal(fields[0].showWhen, undefined, "the unknown controller is dropped: always visible");
  assert.equal(fields[1].dependsOn, "glassType");

  const config = {
    glassType: { options: ["Clear", "Frosted"] },
    thickness: { valueMap: { Clear: ["10 mm", "12 mm"], Frosted: ["12 mm"] } },
  };
  const first = generateCombinations(fields, config);
  assert.equal(first.length, 3);
  for (const o of first) {
    assert.ok(o.values.glassType !== undefined, "glassType is in every combination");
    assert.ok(o.values.thickness !== undefined);
  }
  assert.deepEqual(first.map((o) => o.text), ["Clear · 10 mm", "Clear · 12 mm", "Frosted · 12 mm"]);

  // deterministic: a second run gives identical keys and labels, and the key ignores property order
  const second = generateCombinations(fields, config);
  assert.deepEqual(second.map((o) => combinationKey(o.values)), first.map((o) => combinationKey(o.values)));
  assert.equal(
    combinationKey({ thickness: "12 mm", glassType: "Clear" }),
    combinationKey({ glassType: "Clear", thickness: "12 mm" }),
  );
  assert.equal(combinationKey(first[0].values), '{"glassType":"Clear","thickness":"10 mm"}');
});

test("specFieldList keeps a showWhen whose controller is itself a spec field, and skips non-choice and unflagged fields", () => {
  const fields = specFieldList([
    f("a", { productSpec: true }),
    f("b", { productSpec: true, showWhen: { field: "a", in: ["x"] } }),
    f("c"), // unflagged
    f("d", { type: "field" }), // not a choice field
  ]);
  assert.deepEqual(fields.map((x) => x.key), ["a", "b"]);
  assert.deepEqual(fields[1].showWhen, { field: "a", in: ["x"] });
  // and the generator honours it: b is only offered when a is "x"
  const out = generateCombinations(fields, { a: { options: ["x", "y"] }, b: { options: ["1"] } });
  assert.deepEqual(out.map((o) => o.text), ["x · 1", "y"]);
});

test("countProductSpecs counts only flagged dropdown/radio fields (the SuperAdmin list column)", () => {
  assert.equal(countProductSpecs([f("a", { productSpec: true }), f("b"), f("c", { type: "radio", productSpec: true }), f("d", { type: "field", productSpec: true })]), 2);
  assert.equal(countProductSpecs([]), 0);
});
