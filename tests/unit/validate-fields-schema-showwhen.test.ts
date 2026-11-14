import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFieldsSchemaForWrite, clearDependentsOf, normalizeFieldsSchemaForStore } from "@/lib/validate-fields-schema";
import type { FieldEntry } from "@/lib/types/field-entry";

const f = (key: string, over: Record<string, unknown> = {}) =>
  ({ key, label: key.toUpperCase(), type: "dropdown", required: false, basic: true, ...over }) as FieldEntry;
const bad = (schema: unknown[], re: RegExp) => {
  const r = checkFieldsSchemaForWrite(schema as FieldEntry[]);
  assert.equal(r.valid, false);
  if (!r.valid) assert.match(r.error, re);
};

test("a valid showWhen (any field type) and inventoryLinked pass", () => {
  assert.deepEqual(
    checkFieldsSchemaForWrite([
      f("a", { inventoryLinked: true }),
      f("b", { type: "field", showWhen: { field: "a", in: ["X"] } }),
      f("c", { type: "checkbox", showWhen: { field: "a", in: ["X", "Y"] } }),
      f("d", { type: "radio", inventoryLinked: false }),
    ]),
    { valid: true },
  );
});

test("controller later, itself, unknown, or a field/checkbox is rejected", () => {
  bad([f("b", { showWhen: { field: "a", in: ["x"] } }), f("a")], /must reference a field earlier/);
  bad([f("a", { showWhen: { field: "a", in: ["x"] } })], /cannot reference the field itself/);
  bad([f("a", { showWhen: { field: "zz", in: ["x"] } })], /unknown field key "zz"/);
  bad([f("a", { type: "field" }), f("b", { showWhen: { field: "a", in: ["x"] } })], /must be a dropdown\/radio field/);
  bad([f("a", { type: "checkbox" }), f("b", { showWhen: { field: "a", in: ["x"] } })], /must be a dropdown\/radio field/);
});

test("`in` must be a non-empty array of unique non-empty strings", () => {
  for (const inn of [[], "x", undefined, [1], [""], ["x", "x"]]) {
    bad([f("a"), f("b", { showWhen: { field: "a", in: inn } })], /showWhen\.in/);
  }
});

test("any shape other than { field, in[] } is rejected (G0-a: one controller)", () => {
  bad([f("a"), f("b", { showWhen: [{ field: "a", in: ["x"] }] })], /must be an object/);
  bad([f("a"), f("b", { showWhen: "a" })], /must be an object/);
  bad([f("a"), f("b", { showWhen: null })], /must be an object/);
  bad([f("a"), f("c"), f("b", { showWhen: { field: "a", in: ["x"], and: { field: "c", in: ["y"] } } })], /exactly one controller/);
  bad([f("a"), f("b", { showWhen: { field: ["a"], in: ["x"] } })], /showWhen\.field/);
});

test("inventoryLinked only on dropdown/radio, and must be boolean", () => {
  bad([f("a", { type: "field", inventoryLinked: true })], /only valid on dropdown\/radio/);
  bad([f("a", { type: "checkbox", inventoryLinked: true })], /only valid on dropdown\/radio/);
  bad([f("a", { inventoryLinked: "yes" })], /must be a boolean/);
});

test("clearDependentsOf clears dependsOn and showWhen pointing at the key, nothing else", () => {
  const schema = [
    f("a"),
    f("b", { dependsOn: "a" }),
    f("c", { showWhen: { field: "a", in: ["x"] } }),
    f("d", { dependsOn: "a", showWhen: { field: "a", in: ["x"] } }),
    f("e", { showWhen: { field: "b", in: ["x"] } }),
  ];
  const out = clearDependentsOf(schema, "a");
  assert.equal(out[1].dependsOn, undefined);
  assert.equal(out[2].showWhen, undefined);
  assert.equal(out[3].dependsOn, undefined);
  assert.equal(out[3].showWhen, undefined);
  assert.deepEqual(out[4].showWhen, { field: "b", in: ["x"] });
});

test("the reorder guard (validate on the candidate array) blocks moving a controller after its gated field", () => {
  const ok = [f("a"), f("b", { type: "field", showWhen: { field: "a", in: ["x"] } })];
  assert.equal(checkFieldsSchemaForWrite(ok).valid, true);
  assert.equal(checkFieldsSchemaForWrite([ok[1], ok[0]]).valid, false);
});

test("normalizeFieldsSchemaForStore drops inventoryLinked false only", () => {
  const out = normalizeFieldsSchemaForStore([f("a", { inventoryLinked: false }), f("b", { inventoryLinked: true }), f("c")]);
  assert.equal("inventoryLinked" in out[0], false);
  assert.equal(out[1].inventoryLinked, true);
  assert.equal("inventoryLinked" in out[2], false);
});

// Stage 35 G0-e: a dependsOn child of a gated parent must never be visible while the parent is hidden.
const parentGated = () => [
  f("ctl"),
  f("parent", { showWhen: { field: "ctl", in: ["Yes", "No"] } }),
];

test("G0-e accepted shape (a): the child is gated on its dependsOn parent", () => {
  assert.deepEqual(
    checkFieldsSchemaForWrite([...parentGated(), f("child", { dependsOn: "parent", showWhen: { field: "parent", in: ["P"] } })]),
    { valid: true },
  );
});

test("G0-e accepted shape (b): same controller, `in` a subset of the parent's (equal counts)", () => {
  for (const inn of [["Yes"], ["No", "Yes"]]) {
    assert.deepEqual(
      checkFieldsSchemaForWrite([...parentGated(), f("child", { dependsOn: "parent", showWhen: { field: "ctl", in: inn } })]),
      { valid: true },
    );
  }
});

test("G0-e rejected: no showWhen, a different controller, a non-subset `in`; the message names child and parent", () => {
  const re = /Field "CHILD".*dependsOn parent "parent"/;
  bad([...parentGated(), f("child", { dependsOn: "parent" })], re);
  bad([f("other"), ...parentGated(), f("child", { dependsOn: "parent", showWhen: { field: "other", in: ["Yes"] } })], re);
  bad([...parentGated(), f("child", { dependsOn: "parent", showWhen: { field: "ctl", in: ["Yes", "Maybe"] } })], re);
});

test("G0-e: an ungated parent places no constraint; cascade holds through a gated grandparent", () => {
  assert.deepEqual(checkFieldsSchemaForWrite([f("p"), f("c", { dependsOn: "p" })]), { valid: true });
  // child gated on the same controller as a parent that is itself gated on it: hidden together
  assert.deepEqual(
    checkFieldsSchemaForWrite([
      f("ctl"),
      f("mid", { showWhen: { field: "ctl", in: ["Yes"] } }),
      f("leaf", { dependsOn: "mid", showWhen: { field: "ctl", in: ["Yes"] } }),
      f("tip", { dependsOn: "leaf", showWhen: { field: "ctl", in: ["Yes"] } }),
    ]),
    { valid: true },
  );
  // a grandchild that skips the gate is rejected against its direct parent
  bad([
    f("ctl"),
    f("mid", { showWhen: { field: "ctl", in: ["Yes"] } }),
    f("leaf", { dependsOn: "mid", showWhen: { field: "ctl", in: ["Yes"] } }),
    f("tip", { dependsOn: "leaf", showWhen: { field: "ctl", in: ["No"] } }),
  ], /dependsOn parent "leaf"/);
});
