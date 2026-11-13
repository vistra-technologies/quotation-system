import { test } from "node:test";
import assert from "node:assert/strict";
import { bandsOf, neverShownKeys, relatedIds } from "@/app/[orgSlug]/admin/catalog/catalog-model";
import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";

const f = (key: string, over: Partial<FieldEntry> = {}): FieldEntry => ({
  key, label: key, type: "dropdown", required: false, basic: true, ...over,
});
const sw = (field: string, ...values: string[]) => ({ showWhen: { field, in: values } });

const SCHEMA = [
  f("hasLeaf"),
  f("leafCode", sw("hasLeaf", "Yes")),
  f("gasket", sw("hasLeaf", "Yes")),
  f("bottomRack", sw("hasLeaf", "No")),
  f("hinge"),
];
const CONFIG: FieldOptionsConfig = {
  hasLeaf: { options: ["Yes", "No"] },
  leafCode: { options: ["L1"] },
  gasket: { options: ["G1"] },
  bottomRack: { options: ["R1"] },
  hinge: { options: ["H1"] },
};

test("bandsOf: one band per (controller, value set): Yes and No are two bands; same set shares a band", () => {
  const bands = bandsOf(SCHEMA, CONFIG);
  assert.equal(bands.length, 2);
  assert.deepEqual(bands.map((b) => [b.controller, b.values, b.fieldKeys]), [
    ["hasLeaf", ["Yes"], ["leafCode", "gasket"]],
    ["hasLeaf", ["No"], ["bottomRack"]],
  ]);
  assert.ok(bands.every((b) => b.badValues.length === 0 && !b.allNever));
});

test("bandsOf: a value set is order-insensitive and de-duplicated", () => {
  const schema = [f("c"), f("a", sw("c", "X", "Y")), f("b", sw("c", "Y", "X", "Y"))];
  const bands = bandsOf(schema, { c: { options: ["X", "Y"] } });
  assert.equal(bands.length, 1);
  assert.deepEqual(bands[0].fieldKeys, ["a", "b"]);
});

test("bandsOf/neverShownKeys: an `in` value the controller cannot produce is flagged (warn-only)", () => {
  const schema = [f("hasLeaf"), f("a", sw("hasLeaf", "Partial")), f("b", sw("hasLeaf", "Partial")), f("c", sw("hasLeaf", "Yes", "Partial"))];
  const bands = bandsOf(schema, { hasLeaf: { options: ["Yes", "No"] } });
  const partial = bands.find((b) => b.values.join() === "Partial")!;
  assert.deepEqual(partial.badValues, ["Partial"]);
  assert.equal(partial.allNever, true);
  const mixed = bands.find((b) => b.values.join() === "Yes,Partial")!;
  assert.deepEqual(mixed.badValues, ["Partial"]);
  assert.equal(mixed.allNever, false); // Yes is producible
  assert.deepEqual([...neverShownKeys(schema, { hasLeaf: { options: ["Yes", "No"] } })].sort(), ["a", "b"]);
});

test("neverShownKeys: cascades through a never-shown controller; a controller with no values yet is not judged", () => {
  const schema = [f("c"), f("mid", sw("c", "Nope")), f("leaf", sw("mid", "x"))];
  const cfg: FieldOptionsConfig = { c: { options: ["A"] }, mid: { options: ["x"] }, leaf: { options: ["z"] } };
  assert.deepEqual([...neverShownKeys(schema, cfg)].sort(), ["leaf", "mid"]);
  assert.equal(neverShownKeys(schema, { c: { options: [] } }).size, 0);
});

test("neverShownKeys: a dependent controller's values are the union over its parent's groups", () => {
  const schema = [f("p"), f("ctl", { dependsOn: "p" }), f("g", sw("ctl", "v2"))];
  const cfg: FieldOptionsConfig = { p: { options: ["a", "b"] }, ctl: { valueMap: { a: ["v1"], b: ["v2"] } }, g: { options: ["z"] } };
  assert.equal(neverShownKeys(schema, cfg).size, 0);
});

test("relatedIds: a controller lights everything it gates (both bands); a gated card lights its controller group", () => {
  const ctl = relatedIds(SCHEMA, "hasLeaf")!;
  for (const k of ["hasLeaf", "leafCode", "gasket", "bottomRack"]) assert.ok(ctl.has(k), k);
  assert.ok(!ctl.has("hinge"));
  const member = relatedIds(SCHEMA, "gasket")!;
  for (const k of ["gasket", "hasLeaf", "leafCode", "bottomRack"]) assert.ok(member.has(k), k);
  assert.ok(!member.has("hinge"));
});

test("relatedIds: keeps the dependsOn trace and the independent-lane behaviour", () => {
  const schema = [f("a"), f("b", { dependsOn: "a" }), f("solo")];
  assert.deepEqual([...relatedIds(schema, "b")!].sort(), ["a", "b", "root"]);
  assert.deepEqual([...relatedIds(schema, "solo")!].sort(), ["hub", "rail", "root", "solo"]);
  assert.equal(relatedIds(schema, "root"), null);
});
