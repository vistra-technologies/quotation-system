import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFieldTypeChange, clearDependentsOf, validateFieldsSchema } from "@/lib/validate-fields-schema";
import type { FieldEntry } from "@/lib/types/field-entry";

const f = (key: string, over: Partial<FieldEntry> = {}): FieldEntry => ({
  key, label: key, type: "dropdown", required: false, basic: true, ...over,
});

test("retyping a linked dropdown to a text field clears inventoryLinked (and dependsOn), so Save is not a 400", () => {
  const linked = f("a", { inventoryLinked: true, dependsOn: "c" });
  const retyped = applyFieldTypeChange(linked, "field");
  assert.equal(retyped.type, "field");
  assert.ok(!("inventoryLinked" in retyped));
  assert.ok(!("dependsOn" in retyped));
  assert.equal(validateFieldsSchema([f("c"), retyped]).valid, true);
  // the unfixed shape is the 400 the reviewer found
  assert.equal(validateFieldsSchema([f("c"), { ...linked, type: "field", dependsOn: undefined }]).valid, false);
});

test("retyping dropdown <-> radio keeps inventoryLinked and dependsOn; showWhen survives any retype", () => {
  const e = f("a", { inventoryLinked: true, dependsOn: "c", showWhen: { field: "c", in: ["x"] } });
  const radio = applyFieldTypeChange(e, "radio");
  assert.equal(radio.inventoryLinked, true);
  assert.equal(radio.dependsOn, "c");
  const text = applyFieldTypeChange(e, "checkbox");
  assert.deepEqual(text.showWhen, { field: "c", in: ["x"] });
});

test("removing, renaming or retyping a controller clears the dependent showWhen (clearDependentsOf)", () => {
  const schema = [f("ctl"), f("gated", { type: "field", showWhen: { field: "ctl", in: ["Yes"] } }), f("other", { type: "field", showWhen: { field: "zz", in: ["1"] } })];
  const cleared = clearDependentsOf(schema, "ctl");
  assert.equal(cleared[1].showWhen, undefined);
  assert.deepEqual(cleared[2].showWhen, { field: "zz", in: ["1"] }); // unrelated rule untouched
});
