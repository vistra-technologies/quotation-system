import { test } from "node:test";
import assert from "node:assert/strict";
import { missingCount, offenderKeys, tiersOf } from "@/app/[orgSlug]/admin/catalog/catalog-model";
import type { FieldEntry } from "@/lib/types/field-entry";
import { inventoryLinkIssues } from "@/lib/inventory-link";

const f = (key: string, over: Partial<FieldEntry> = {}): FieldEntry => ({
  key, label: key, type: "dropdown", required: false, basic: true, ...over,
});

// chain: door -> frame -> gasket (tier 1..3) plus a second tier-2 child; independent: hinge (listed FIRST in the schema)
const SCHEMA = [
  f("hinge", { inventoryLinked: true }),
  f("door"),
  f("gasket", { dependsOn: "frame", inventoryLinked: true }),
  f("frame", { dependsOn: "door", inventoryLinked: true }),
  f("lock", { dependsOn: "door", inventoryLinked: true }),
];

test("tiersOf: columns by depth, ordered by parent position then schema order", () => {
  assert.deepEqual(tiersOf(SCHEMA).map((t) => t.map((x) => x.key)), [["door"], ["frame", "lock"], ["gasket"]]);
});

test("offenderKeys: tree order (tiers, then the independent lane), only fields with a missing value", () => {
  const issues = { hinge: ["H1"], gasket: ["G1", "G2"], frame: ["F1"] };
  assert.deepEqual(offenderKeys(SCHEMA, issues), ["frame", "gasket", "hinge"]);
  assert.deepEqual(offenderKeys(SCHEMA, {}), []);
  assert.deepEqual(offenderKeys(SCHEMA, { frame: [] }), []);
});

test("missingCount sums the missing values across fields", () => {
  assert.equal(missingCount({ a: ["x", "y"], b: ["z"] }), 3);
  assert.equal(missingCount({}), 0);
});

// Stage 35 B8: the editor evaluates the DRAFT config with the server's own rule against the type's active codes.
test("draft evaluation (Batch 8): an added or renamed value is missing at once; a code in the active set is not", () => {
  const active = new Set(["H1"]);
  const isLinked = (c: string) => active.has(c);
  const fields = [f("hinge", { inventoryLinked: true }), f("plain")];
  assert.deepEqual(inventoryLinkIssues(fields, { hinge: { options: ["H1"] } }, isLinked), {});
  assert.deepEqual(inventoryLinkIssues(fields, { hinge: { options: ["H1", "NEW"] } }, isLinked), { hinge: ["NEW"] });
  assert.deepEqual(inventoryLinkIssues(fields, { hinge: { options: ["H2"] } }, isLinked), { hinge: ["H2"] });
  active.add("NEW");
  assert.deepEqual(inventoryLinkIssues(fields, { hinge: { options: ["H1", "NEW"] } }, isLinked), {});
});
