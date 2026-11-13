import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSelectionConfig } from "../../lib/validate-selection-config";
import type { FieldEntry } from "../../lib/types/field-entry";
import type { FieldOptionsConfig } from "../../lib/types/field-options-config";

const schema: FieldEntry[] = [
  { key: "category", label: "Category", type: "dropdown", required: true, basic: true },
  { key: "finish", label: "Finish", type: "radio", required: true, basic: true, dependsOn: "category" },
  { key: "note", label: "Note", type: "field", required: false, basic: false },
  { key: "flag", label: "Flag", type: "checkbox", required: false, basic: false },
];
const cfg: FieldOptionsConfig = {
  category: { options: ["Single", "Double"] },
  finish: { valueMap: { Single: ["Matt"], Double: ["Gloss"] } },
};

test("unknown key is rejected and named", () => {
  const r = validateSelectionConfig(schema, cfg, { bogus: "x" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.key, "bogus");
});

test("flat option outside the list is rejected", () => {
  const r = validateSelectionConfig(schema, cfg, { category: "Triple" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.key, "category");
});

test("dependent value outside valueMap[parent] is rejected, inside passes", () => {
  const bad = validateSelectionConfig(schema, cfg, { category: "Single", finish: "Gloss" });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.key, "finish");
  assert.deepEqual(validateSelectionConfig(schema, cfg, { category: "Single", finish: "Matt" }), { ok: true, config: { category: "Single", finish: "Matt" } });
});

test("a child set under a blank or missing parent is rejected", () => {
  for (const config of [{ finish: "Matt" } as Record<string, string | null>, { category: "", finish: "Matt" }, { category: null, finish: "Matt" }]) {
    const r = validateSelectionConfig(schema, cfg, config);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.key, "finish");
  }
});

test("blank values pass", () => {
  assert.deepEqual(validateSelectionConfig(schema, cfg, { category: "", finish: null, note: "" }), { ok: true, config: { category: "", finish: null, note: "" } });
  assert.deepEqual(validateSelectionConfig(schema, cfg, {}), { ok: true, config: {} });
});

test("required is not enforced; non-choice values are not type-checked", () => {
  assert.deepEqual(validateSelectionConfig(schema, cfg, { note: "anything", flag: true }), { ok: true, config: { note: "anything", flag: true } });
  assert.deepEqual(validateSelectionConfig(schema, cfg, { note: 5 }), { ok: true, config: { note: 5 } });
});

test("a choice field with no configured options rejects any value; null config behaves as empty", () => {
  assert.equal(validateSelectionConfig(schema, null, { category: "Single" }).ok, false);
  assert.equal(validateSelectionConfig(schema, cfg, { category: true }).ok, false);
});

// ── Stage 35 S35-4 / G0-d: hidden keys are stripped silently, then visible keys are validated as today ──
const gated: FieldEntry[] = [
  { key: "hasLeaf", label: "Has Leaf", type: "dropdown", required: true, basic: false },
  { key: "leafCode", label: "Leaf", type: "dropdown", required: true, basic: false, showWhen: { field: "hasLeaf", in: ["Yes"] } },
  { key: "leafNote", label: "Leaf note", type: "field", required: false, basic: false, showWhen: { field: "leafCode", in: ["L1"] } },
  { key: "rubber", label: "Rubber", type: "dropdown", required: false, basic: false },
];
const gatedCfg: FieldOptionsConfig = {
  hasLeaf: { options: ["Yes", "No"] },
  leafCode: { options: ["L1", "L2"] },
  rubber: { options: ["R1"] },
};

test("a hidden key is stripped, even with an invalid value (no 400); the stripped config is returned", () => {
  const r = validateSelectionConfig(gated, gatedCfg, { hasLeaf: "No", leafCode: "not-an-option", rubber: "R1" });
  assert.deepEqual(r, { ok: true, config: { hasLeaf: "No", rubber: "R1" } });
});

test("a visible gated key keeps today's validation: valid kept, invalid value rejected", () => {
  assert.deepEqual(validateSelectionConfig(gated, gatedCfg, { hasLeaf: "Yes", leafCode: "L2" }), { ok: true, config: { hasLeaf: "Yes", leafCode: "L2" } });
  const bad = validateSelectionConfig(gated, gatedCfg, { hasLeaf: "Yes", leafCode: "L9" });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.key, "leafCode");
});

test("cascade: a hidden controller strips what it gates even when the gated field's own controller value matches", () => {
  const r = validateSelectionConfig(gated, gatedCfg, { hasLeaf: "No", leafCode: "L1", leafNote: "stale" });
  assert.deepEqual(r, { ok: true, config: { hasLeaf: "No" } });
});

test("an unknown key is still rejected next to hidden ones", () => {
  const r = validateSelectionConfig(gated, gatedCfg, { hasLeaf: "No", leafCode: "L1", bogus: "x" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.key, "bogus");
});

test("review-b2-1 MINOR 3: a non-gated dependsOn child of a hidden parent stays visible; a value for it is rejected (parent blank)", () => {
  const schema: FieldEntry[] = [
    { key: "mode", label: "Mode", type: "dropdown", required: false, basic: false },
    { key: "parent", label: "Parent", type: "dropdown", required: false, basic: false, showWhen: { field: "mode", in: ["A"] } },
    { key: "child", label: "Child", type: "dropdown", required: false, basic: false, dependsOn: "parent" },
  ];
  const c: FieldOptionsConfig = { mode: { options: ["A", "B"] }, parent: { options: ["p1"] }, child: { valueMap: { p1: ["c1"] } } };
  const r = validateSelectionConfig(schema, c, { mode: "B", parent: "p1", child: "c1" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.key, "child");
  assert.deepEqual(validateSelectionConfig(schema, c, { mode: "B" }), { ok: true, config: { mode: "B" } });
});
