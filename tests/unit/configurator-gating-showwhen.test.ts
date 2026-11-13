import { test } from "node:test";
import assert from "node:assert/strict";
import { isComponentTypeFullyConfigured } from "@/lib/configurator-gating";
import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";

// Stage 35 G0-b: a gated field with an empty/missing branch fails the type only if it can actually be visible with no options.
const f = (key: string, over: Partial<FieldEntry> = {}): FieldEntry => ({
  key, label: key, type: "dropdown", required: false, basic: true, ...over,
});
const yesOnly = f("extra", { showWhen: { field: "leaf", in: ["Yes"] } });

test("non-gated schemas keep the existing rule", () => {
  assert.equal(isComponentTypeFullyConfigured([f("a")], { a: { options: ["x"] } }), true);
  assert.equal(isComponentTypeFullyConfigured([f("a")], {}), false);
  assert.equal(
    isComponentTypeFullyConfigured([f("a"), f("b", { dependsOn: "a" })], { a: { options: ["1", "2"] }, b: { valueMap: { "1": ["x"] } } }),
    false,
  );
});

test("a gated root field with no options fails only when it can be visible", () => {
  const schema = [f("leaf"), yesOnly];
  assert.equal(isComponentTypeFullyConfigured(schema, { leaf: { options: ["Yes", "No"] } }), false); // Yes can show it
  assert.equal(isComponentTypeFullyConfigured(schema, { leaf: { options: ["No"] } }), true); // never visible
  assert.equal(isComponentTypeFullyConfigured(schema, { leaf: { options: ["Yes"] }, extra: { options: ["z"] } }), true);
});

test("gated and dependsOn the same controller: only branches for values in `in` are required", () => {
  const schema = [f("leaf"), f("extra", { dependsOn: "leaf", showWhen: { field: "leaf", in: ["Yes"] } })];
  const cfg = (valueMap: Record<string, string[]>): FieldOptionsConfig => ({ leaf: { options: ["Yes", "No"] }, extra: { valueMap } });
  assert.equal(isComponentTypeFullyConfigured(schema, cfg({ Yes: ["a"] })), true); // No branch missing, allowed
  assert.equal(isComponentTypeFullyConfigured(schema, cfg({ No: ["a"] })), false); // Yes branch missing, visible
  assert.equal(isComponentTypeFullyConfigured(schema, cfg({ Yes: [], No: ["a"] })), false);
});

test("gated with a different dependsOn parent: every parent value needs a branch when it can be visible", () => {
  const schema = [f("p"), f("leaf"), f("x", { dependsOn: "p", showWhen: { field: "leaf", in: ["Yes"] } })];
  const base = { p: { options: ["1", "2"] }, leaf: { options: ["Yes", "No"] } };
  assert.equal(isComponentTypeFullyConfigured(schema, { ...base, x: { valueMap: { "1": ["a"] } } }), false);
  assert.equal(isComponentTypeFullyConfigured(schema, { ...base, x: { valueMap: { "1": ["a"], "2": ["b"] } } }), true);
  assert.equal(isComponentTypeFullyConfigured(schema, { ...base, leaf: { options: ["No"] } }), true); // never visible
});

test("a cascade of hidden fields needs no configuration", () => {
  const schema = [f("leaf"), f("g1", { showWhen: { field: "leaf", in: ["Yes"] } }), f("g2", { showWhen: { field: "g1", in: ["z"] } })];
  assert.equal(isComponentTypeFullyConfigured(schema, { leaf: { options: ["No"] } }), true);
  // g1 visible but never produces "z": g2 cannot be visible, so an unconfigured g2 is fine
  assert.equal(isComponentTypeFullyConfigured(schema, { leaf: { options: ["Yes"] }, g1: { options: ["q"] } }), true);
  assert.equal(isComponentTypeFullyConfigured(schema, { leaf: { options: ["Yes"] }, g1: { options: ["z"] } }), false);
});

test("a non-gated dependent of a never-visible parent fails closed", () => {
  const schema = [f("leaf"), f("g", { showWhen: { field: "leaf", in: ["Yes"] } }), f("child", { dependsOn: "g" })];
  assert.equal(isComponentTypeFullyConfigured(schema, { leaf: { options: ["No"] }, child: { valueMap: {} } }), false);
});
