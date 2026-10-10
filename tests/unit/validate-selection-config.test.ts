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
  assert.deepEqual(validateSelectionConfig(schema, cfg, { category: "Single", finish: "Matt" }), { ok: true });
});

test("a child set under a blank or missing parent is rejected", () => {
  for (const config of [{ finish: "Matt" } as Record<string, string | null>, { category: "", finish: "Matt" }, { category: null, finish: "Matt" }]) {
    const r = validateSelectionConfig(schema, cfg, config);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.key, "finish");
  }
});

test("blank values pass", () => {
  assert.deepEqual(validateSelectionConfig(schema, cfg, { category: "", finish: null, note: "" }), { ok: true });
  assert.deepEqual(validateSelectionConfig(schema, cfg, {}), { ok: true });
});

test("required is not enforced; non-choice values are not type-checked", () => {
  assert.deepEqual(validateSelectionConfig(schema, cfg, { note: "anything", flag: true }), { ok: true });
  assert.deepEqual(validateSelectionConfig(schema, cfg, { note: 5 }), { ok: true });
});

test("a choice field with no configured options rejects any value; null config behaves as empty", () => {
  assert.equal(validateSelectionConfig(schema, null, { category: "Single" }).ok, false);
  assert.equal(validateSelectionConfig(schema, cfg, { category: true }).ok, false);
});
