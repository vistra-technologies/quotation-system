import { test } from "node:test";
import assert from "node:assert/strict";
import { firstSelectionFormIssue, visibleSelectionValues } from "@/lib/selection-form-check";
import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";

const f = (key: string, over: Partial<FieldEntry> = {}): FieldEntry => ({
  key, label: key.toUpperCase(), type: "dropdown", required: false, basic: true, ...over,
});

const SCHEMA = [
  f("hasLeaf", { required: true }),
  f("leafCode", { required: true, showWhen: { field: "hasLeaf", in: ["Yes"] } }),
  f("note", { type: "field", showWhen: { field: "hasLeaf", in: ["Yes"] } }),
];
const CONFIG: FieldOptionsConfig = {
  hasLeaf: { options: ["Yes", "No"] },
  leafCode: { options: ["L1", "L2"] },
};

test("visibleSelectionValues: a hidden key never reaches the saved config", () => {
  assert.deepEqual(visibleSelectionValues(SCHEMA, { hasLeaf: "No", leafCode: "L1", note: "x" }), { hasLeaf: "No" });
  assert.deepEqual(visibleSelectionValues(SCHEMA, { hasLeaf: "Yes", leafCode: "L1" }), { hasLeaf: "Yes", leafCode: "L1" });
});

test("a hidden required field does not block; the same field visible and blank does", () => {
  assert.equal(firstSelectionFormIssue(SCHEMA, { hasLeaf: "No" }, CONFIG), null);
  assert.equal(firstSelectionFormIssue(SCHEMA, { hasLeaf: "Yes" }, CONFIG), '"LEAFCODE" is required.');
  assert.equal(firstSelectionFormIssue(SCHEMA, { hasLeaf: "Yes", leafCode: "L2" }, CONFIG), null);
});

test("a stale value for a hidden field is ignored (not required, not an error)", () => {
  assert.equal(firstSelectionFormIssue(SCHEMA, { hasLeaf: "No", leafCode: "gone" }, CONFIG), null);
});

test("a visible choice field with empty resolved options refuses: No values configured for <label>", () => {
  const cfg: FieldOptionsConfig = { hasLeaf: { options: ["Yes", "No"] }, leafCode: { options: [] } };
  assert.equal(firstSelectionFormIssue(SCHEMA, { hasLeaf: "Yes" }, cfg), "No values configured for LEAFCODE");
  // hidden -> not checked
  assert.equal(firstSelectionFormIssue(SCHEMA, { hasLeaf: "No" }, cfg), null);
  // a null config (nothing configured) is the same refusal for the root field
  assert.equal(firstSelectionFormIssue(SCHEMA, {}, null), "No values configured for HASLEAF");
});

test("a dependent field with a chosen parent and an empty branch refuses; with a blank parent it does not", () => {
  const schema = [f("type"), f("finish", { dependsOn: "type" })];
  const cfg: FieldOptionsConfig = { type: { options: ["A", "B"] }, finish: { valueMap: { A: ["x"], B: [] } } };
  assert.equal(firstSelectionFormIssue(schema, { type: "B" }, cfg), "No values configured for FINISH");
  assert.equal(firstSelectionFormIssue(schema, { type: "A" }, cfg), null);
  assert.equal(firstSelectionFormIssue(schema, {}, cfg), null); // parent blank: options are empty only because of that
});

test("a required dependent field with a blank parent still reports required (today's behaviour)", () => {
  const schema = [f("type"), f("finish", { dependsOn: "type", required: true })];
  const cfg: FieldOptionsConfig = { type: { options: ["A"] }, finish: { valueMap: { A: ["x"] } } };
  assert.equal(firstSelectionFormIssue(schema, {}, cfg), '"FINISH" is required.');
});

test("a non-gated child of a hidden (stripped) parent counts as a blank parent, not as 'no values'", () => {
  const schema = [
    f("hasLeaf"),
    f("parent", { showWhen: { field: "hasLeaf", in: ["Yes"] } }),
    f("child", { dependsOn: "parent" }),
  ];
  const cfg: FieldOptionsConfig = {
    hasLeaf: { options: ["Yes", "No"] },
    parent: { options: ["P"] },
    child: { valueMap: { P: ["c"] } },
  };
  assert.equal(firstSelectionFormIssue(schema, { hasLeaf: "No", parent: "P" }, cfg), null);
});

test("checkbox required: unchecked is empty; text field required works", () => {
  const schema = [f("agree", { type: "checkbox", required: true }), f("t", { type: "field", required: true })];
  assert.equal(firstSelectionFormIssue(schema, { agree: false, t: "x" }, null), '"AGREE" is required.');
  assert.equal(firstSelectionFormIssue(schema, { agree: true, t: "" }, null), '"T" is required.');
  assert.equal(firstSelectionFormIssue(schema, { agree: true, t: "x" }, null), null);
});
