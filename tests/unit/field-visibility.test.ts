import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFieldVisibility } from "@/lib/field-visibility";
import { collectDescendants } from "@/lib/configurator-gating";
import type { FieldEntry } from "@/lib/types/field-entry";

const f = (key: string, over: Partial<FieldEntry> = {}): FieldEntry => ({
  key, label: key, type: "dropdown", required: false, basic: true, ...over,
});
const keys = (s: Set<string>) => [...s].sort();

test("root fields are visible; a gated field is visible only when the controller value is in `in`", () => {
  const schema = [f("leaf"), f("rubber", { type: "field", showWhen: { field: "leaf", in: ["Yes"] } })];
  assert.deepEqual(keys(applyFieldVisibility(schema, { leaf: "Yes" }).visibleKeys), ["leaf", "rubber"]);
  const no = applyFieldVisibility(schema, { leaf: "No", rubber: "stale" });
  assert.deepEqual(keys(no.visibleKeys), ["leaf"]);
  assert.deepEqual(no.values, { leaf: "No" }); // hidden key removed
  assert.deepEqual(keys(applyFieldVisibility(schema, {}).visibleKeys), ["leaf"]); // blank controller hides
});

test("two-level cascade: a hidden controller hides what it gates even if its own value matches", () => {
  const schema = [
    f("a"),
    f("b", { showWhen: { field: "a", in: ["1"] } }),
    f("c", { type: "field", showWhen: { field: "b", in: ["x"] } }),
  ];
  assert.deepEqual(keys(applyFieldVisibility(schema, { a: "1", b: "x", c: "v" }).visibleKeys), ["a", "b", "c"]);
  const r = applyFieldVisibility(schema, { a: "2", b: "x", c: "v" }); // b hidden => c hidden despite b="x"
  assert.deepEqual(keys(r.visibleKeys), ["a"]);
  assert.deepEqual(r.values, { a: "2" });
});

test("a Yes set and a No set on one controller; `in` may list several values", () => {
  const schema = [
    f("hasLeaf"),
    f("yesOnly", { type: "field", showWhen: { field: "hasLeaf", in: ["Yes"] } }),
    f("noOnly", { type: "field", showWhen: { field: "hasLeaf", in: ["No", "N/A"] } }),
  ];
  assert.deepEqual(keys(applyFieldVisibility(schema, { hasLeaf: "Yes" }).visibleKeys), ["hasLeaf", "yesOnly"]);
  assert.deepEqual(keys(applyFieldVisibility(schema, { hasLeaf: "N/A" }).visibleKeys), ["hasLeaf", "noOnly"]);
});

test("a field with a dependsOn parent AND a different showWhen controller follows showWhen only", () => {
  const schema = [f("p"), f("g"), f("x", { dependsOn: "p", showWhen: { field: "g", in: ["on"] } })];
  assert.ok(applyFieldVisibility(schema, { p: "1", g: "on" }).visibleKeys.has("x"));
  assert.ok(!applyFieldVisibility(schema, { p: "1", g: "off" }).visibleKeys.has("x"));
  assert.ok(applyFieldVisibility(schema, { g: "on" }).visibleKeys.has("x")); // dependsOn does not hide
});

test("keys outside the schema are left alone", () => {
  assert.deepEqual(applyFieldVisibility([f("a")], { a: "1", other: "z" }).values, { a: "1", other: "z" });
});

test("collectDescendants includes showWhen children, transitively, de-duplicated", () => {
  const schema = [
    f("a"),
    f("b", { dependsOn: "a" }),
    f("c", { showWhen: { field: "a", in: ["1"] } }),
    f("d", { type: "field", showWhen: { field: "c", in: ["z"] } }),
    f("e", { dependsOn: "b", showWhen: { field: "a", in: ["1"] } }),
  ];
  assert.deepEqual(collectDescendants(schema, "a").sort(), ["b", "c", "d", "e"]);
  assert.deepEqual(collectDescendants(schema, "c"), ["d"]);
  assert.deepEqual(collectDescendants(schema, "d"), []);
});
