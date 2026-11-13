import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { applyFieldChoice, diffConfigs, validateSelectionConfig, type DiffType } from "../../lib/config-update";
import type { FieldEntry } from "../../lib/types/field-entry";

const schema: FieldEntry[] = [
  { key: "category", label: "Category", type: "dropdown", required: true, basic: true },
  { key: "doorType", label: "Door Type", type: "dropdown", required: true, basic: true, dependsOn: "category" },
  { key: "note", label: "Note", type: "field", required: false, basic: false },
];
const cfg = {
  category: { options: ["Single", "Double"] },
  doorType: { valueMap: { Single: ["Flush"], Double: ["Glass"] } },
};

describe("validateSelectionConfig", () => {
  test("valid config has no issues", () => {
    const r = validateSelectionConfig(schema, cfg, { category: "Single", doorType: "Flush" });
    assert.deepEqual(r.issues, []);
  });
  test("removed option is flagged invalid; dependent checked against parent", () => {
    const r = validateSelectionConfig(schema, cfg, { category: "Single", doorType: "Glass" });
    assert.deepEqual(r.issues.map((i) => [i.key, i.kind, i.oldValue]), [["doorType", "invalid", "Glass"]]);
  });
  test("new required field is missing; unknown keys are dropped", () => {
    const r = validateSelectionConfig(schema, cfg, { category: "Single", legacy: "x" });
    assert.deepEqual(r.dropped, ["legacy"]);
    assert.deepEqual(r.issues.map((i) => [i.key, i.kind]), [["doorType", "missing"]]);
    assert.equal("legacy" in r.cleaned, false);
  });
});

describe("applyFieldChoice", () => {
  test("changing a parent clears its dependents", () => {
    const next = applyFieldChoice(schema, { category: "Single", doorType: "Flush" }, "category", "Double");
    assert.equal(next.category, "Double");
    assert.equal("doorType" in next, false);
  });
});

describe("diffConfigs", () => {
  const mk = (fieldsSchema: FieldEntry[], fieldOptionsConfig: DiffType["fieldOptionsConfig"]): DiffType => ({
    id: "t1", code: "DOOR", name: "Door", active: true, fieldsSchema, fieldOptionsConfig,
  });
  test("reports removed option and added required field", () => {
    const oldT = mk(schema, cfg);
    const newT = mk(
      [...schema, { key: "x", label: "Finish", type: "field", required: true, basic: true }],
      { ...cfg, category: { options: ["Single"] } },
    );
    const items = diffConfigs([oldT], [newT])[0]!.items;
    assert.ok(items.includes('"Category": option "Double" removed'));
    assert.ok(items.includes('Field "Finish" added (required)'));
  });
  test("identical configs produce no changes", () => {
    assert.deepEqual(diffConfigs([mk(schema, cfg)], [mk(schema, cfg)]), []);
  });
});

// ─── Stage 35 S35-6 ──────────────────────────────────────────────────────────
describe("validateSelectionConfig — field visibility", () => {
  const gated: FieldEntry[] = [
    { key: "hasLeaf", label: "Has Leaf", type: "dropdown", required: true, basic: false },
    { key: "leafCode", label: "Leaf Code", type: "dropdown", required: true, basic: false, showWhen: { field: "hasLeaf", in: ["Yes"] } },
  ];
  const gcfg = { hasLeaf: { options: ["Yes", "No"] }, leafCode: { options: ["L1"] } };

  test("a hidden required field is not missing", () => {
    const r = validateSelectionConfig(gated, gcfg, { hasLeaf: "No" });
    assert.deepEqual(r.issues, []);
    assert.deepEqual(r.dropped, []);
  });
  test("a stored hidden key is dropped as stale, even with an invalid value (no issue)", () => {
    const r = validateSelectionConfig(gated, gcfg, { hasLeaf: "No", leafCode: "OLD" });
    assert.deepEqual(r.dropped, ["leafCode"]);
    assert.deepEqual(r.cleaned, { hasLeaf: "No" });
    assert.deepEqual(r.issues, []);
  });
  test("a visible required field is missing; a visible invalid value is flagged", () => {
    assert.deepEqual(validateSelectionConfig(gated, gcfg, { hasLeaf: "Yes" }).issues.map((i) => [i.key, i.kind]), [["leafCode", "missing"]]);
    assert.deepEqual(validateSelectionConfig(gated, gcfg, { hasLeaf: "Yes", leafCode: "OLD" }).issues.map((i) => [i.key, i.kind]), [["leafCode", "invalid"]]);
  });
  test("applyFieldChoice: changing the controller clears the gated field", () => {
    assert.equal("leafCode" in applyFieldChoice(gated, { hasLeaf: "Yes", leafCode: "L1" }, "hasLeaf", "No"), false);
  });
});

describe("diffConfigs — showWhen / inventoryLinked", () => {
  const base: FieldEntry[] = [
    { key: "hasLeaf", label: "Has Leaf", type: "dropdown", required: false, basic: false },
    { key: "leafCode", label: "Leaf Code", type: "dropdown", required: false, basic: false },
  ];
  const mk = (fields: FieldEntry[]): DiffType => ({ id: "t1", code: "DOOR", name: "Door", active: true, fieldsSchema: fields, fieldOptionsConfig: {} });
  const withLeaf = (over: Partial<FieldEntry>): FieldEntry[] => [base[0], { ...base[1], ...over }];
  const items = (a: FieldEntry[], b: FieldEntry[]) => diffConfigs([mk(a)], [mk(b)])[0]?.items ?? [];

  test("showWhen added / changed / removed", () => {
    const gated = withLeaf({ showWhen: { field: "hasLeaf", in: ["Yes"] } });
    assert.deepEqual(items(base, gated), ['Field "Leaf Code" is now shown only when "Has Leaf" is Yes']);
    assert.deepEqual(items(gated, withLeaf({ showWhen: { field: "hasLeaf", in: ["Yes", "Maybe"] } })), ['Field "Leaf Code" visibility rule changed: now shown only when "Has Leaf" is Yes, Maybe']);
    assert.deepEqual(items(gated, base), ['Field "Leaf Code" is now always shown']);
  });
  test("a reordered `in` list is not a change", () => {
    const a = withLeaf({ showWhen: { field: "hasLeaf", in: ["Yes", "No"] } });
    const b = withLeaf({ showWhen: { field: "hasLeaf", in: ["No", "Yes"] } });
    assert.deepEqual(items(a, b), []);
  });
  test("inventoryLinked on / off", () => {
    assert.deepEqual(items(base, withLeaf({ inventoryLinked: true })), ['Field "Leaf Code" is now linked to inventory']);
    assert.deepEqual(items(withLeaf({ inventoryLinked: true }), base), ['Field "Leaf Code" is no longer linked to inventory']);
  });
});
