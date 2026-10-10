import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFieldsSchemaForWrite } from "../../lib/validate-fields-schema";
import type { FieldEntry } from "../../lib/types/field-entry";

const f = (over: Record<string, unknown>) =>
  ({ key: "a", label: "A", type: "dropdown", required: false, basic: true, ...over }) as FieldEntry;

test("a valid schema passes", () => {
  assert.deepEqual(checkFieldsSchemaForWrite([f({}), f({ key: "b", dependsOn: "a" })]), { valid: true });
  assert.deepEqual(checkFieldsSchemaForWrite([]), { valid: true });
});

test("any options key is rejected, even an empty array", () => {
  for (const options of [["x"], []]) {
    const r = checkFieldsSchemaForWrite([f({ options })]);
    assert.equal(r.valid, false);
    if (!r.valid) assert.match(r.error, /"options" is no longer accepted here/);
  }
});

test("a dangling dependsOn is rejected", () => {
  const r = checkFieldsSchemaForWrite([f({ dependsOn: "missing" })]);
  assert.equal(r.valid, false);
  if (!r.valid) assert.match(r.error, /unknown field key "missing"/);
});

test("junk entries are rejected, not thrown", () => {
  assert.equal(checkFieldsSchemaForWrite([{ bogus: 1 } as unknown as FieldEntry]).valid, false);
  assert.equal(checkFieldsSchemaForWrite([null as unknown as FieldEntry]).valid, false);
});
