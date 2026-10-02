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
