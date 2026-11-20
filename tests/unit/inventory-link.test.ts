import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addUnlinkedCodeProblems,
  inventoryLinkIssues,
  producibleValues,
  usedSelectionIds,
} from "@/lib/inventory-link";
import { ProblemCollector } from "@/lib/materials/problems";
import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";

const f = (key: string, over: Partial<FieldEntry> = {}): FieldEntry => ({
  key, label: key, type: "dropdown", required: false, basic: true, ...over,
});

const SCHEMA = [
  f("kind"),
  f("code", { dependsOn: "kind", inventoryLinked: true }),
  f("fin", { dependsOn: "code", inventoryLinked: true }),
  f("note", { type: "field" }),
];
const CONFIG: FieldOptionsConfig = {
  kind: { options: ["A", "B"] },
  code: { valueMap: { A: ["a1", "a2"], B: ["b1", "a2"], Z: ["unreachable"] } },
  fin: { valueMap: { a1: ["f1"], b1: ["f2"], a2: ["f1", "f3"] } },
};

test("producibleValues: roots, branches in parent order, de-duplicated, unreachable branch ignored, multi-hop", () => {
  const p = producibleValues(SCHEMA, CONFIG);
  assert.deepEqual(p.get("kind"), ["A", "B"]);
  assert.deepEqual(p.get("code"), ["a1", "a2", "b1"]); // Z is not a value `kind` can produce
  assert.deepEqual(p.get("fin"), ["f1", "f3", "f2"]);
  assert.equal(p.has("note"), false); // not a choice field
});

test("producibleValues: unconfigured field produces nothing; null config is empty", () => {
  assert.deepEqual(producibleValues(SCHEMA, null).get("kind"), []);
  assert.deepEqual(producibleValues(SCHEMA, { kind: { options: ["A"] } }).get("code"), []);
});

test("inventoryLinkIssues: only linked fields, missing values in branch order, hidden-only branches included", () => {
  const present = new Set(["a1", "f1"]);
  const gated = [
    f("kind"),
    f("code", { dependsOn: "kind", inventoryLinked: true, showWhen: { field: "kind", in: ["A"] } }), // B branch is hidden-only
    f("fin", { dependsOn: "code", inventoryLinked: true }),
  ];
  const issues = inventoryLinkIssues(gated, CONFIG, (c) => present.has(c));
  assert.deepEqual(issues, { code: ["a2", "b1"], fin: ["f3", "f2"] });
});

test("inventoryLinkIssues: nothing flagged, or everything linked, gives {}", () => {
  assert.deepEqual(inventoryLinkIssues([f("kind")], CONFIG, () => false), {});
  assert.deepEqual(inventoryLinkIssues(SCHEMA, CONFIG, () => true), {});
});

test("usedSelectionIds: cells in stored order, de-duplicated, blanks skipped", () => {
  const floors = [{
    rooms: [{
      partitions: [
        { design: { sections: [{ cells: [{ selectionId: "s2" }, { selectionId: null }] }, { cells: [{ selectionId: "s1" }, { selectionId: "s2" }] }] } },
        { design: null },
      ],
    }],
  }];
  assert.deepEqual(usedSelectionIds(floors), ["s2", "s1"]);
});

// ── addUnlinkedCodeProblems ────────────────────────────────────────────────────
const TYPE = {
  id: "t1", code: "DOOR", name: "Door",
  fieldsSchema: [
    { key: "hasLeaf", label: "Has leaf", type: "radio", required: true, basic: true },
    { key: "frameCode", label: "Frame", type: "dropdown", required: false, basic: false, inventoryLinked: true },
    { key: "leafCode", label: "Leaf", type: "dropdown", required: false, basic: false, inventoryLinked: true, showWhen: { field: "hasLeaf", in: ["Yes"] } },
    { key: "free", label: "Free", type: "field", required: false, basic: false },
  ],
};
const run = (config: Record<string, unknown>, isLinked: (t: string, c: string) => boolean, pre?: (c: ProblemCollector) => void) => {
  const c = new ProblemCollector();
  pre?.(c);
  addUnlinkedCodeProblems(c, {
    selections: [{ id: "s1", componentTypeId: "t1", config }],
    usedSelectionIds: ["s1", "missing-selection"],
    snapshotTypes: [TYPE],
    isLinked,
  });
  return c.report().problems;
};

test("a visible linked value with no matching item -> one INVENTORY UNLINKED_CODE naming value and type", () => {
  const p = run({ hasLeaf: "Yes", frameCode: "F1", leafCode: "L1" }, (_t, code) => code === "L1");
  assert.equal(p.length, 1);
  assert.deepEqual({ kind: p[0].kind, scope: p[0].scope, code: p[0].code, message: p[0].message }, {
    kind: "UNLINKED_CODE", scope: "INVENTORY", code: "F1", message: "F1 is not an active Door inventory item",
  });
  assert.deepEqual(p[0].locus, { selectionId: "s1", componentTypeCode: "DOOR", fieldKey: "frameCode" });
});

test("a hidden linked value is not reported (hasLeaf = No hides leafCode even with a stale value)", () => {
  const p = run({ hasLeaf: "No", frameCode: "F1", leafCode: "STALE" }, () => true);
  assert.deepEqual(p, []);
  const q = run({ hasLeaf: "No", frameCode: "F1", leafCode: "STALE" }, (_t, c) => c === "F1");
  assert.deepEqual(q, []);
});

test("blank / non-string values and non-linked fields are skipped; the type id is passed to isLinked", () => {
  const seen: string[] = [];
  const p = run({ hasLeaf: "Yes", frameCode: "", leafCode: 5, free: "whatever" }, (t, c) => { seen.push(`${t}:${c}`); return false; });
  assert.deepEqual(p, []);
  assert.deepEqual(seen, []);
  const seen2: string[] = [];
  run({ frameCode: "F9" }, (t, c) => { seen2.push(`${t}:${c}`); return true; });
  assert.deepEqual(seen2, ["t1:F9"]);
});

test("dedupe: a code the engine already reported as UNRESOLVED_CODE or INACTIVE_ITEM is not reported twice", () => {
  for (const kind of ["UNRESOLVED_CODE", "INACTIVE_ITEM"] as const) {
    const p = run({ hasLeaf: "Yes", frameCode: "F1", leafCode: "L1" }, () => false, (c) =>
      c.add({ kind, scope: "INVENTORY", message: "engine", code: "F1" }));
    assert.deepEqual(p.map((x) => [x.kind, x.code]), [[kind, "F1"], ["UNLINKED_CODE", "L1"]].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  }
  // UNIT_MISMATCH is not a dedupe partner
  const m = run({ frameCode: "F1" }, () => false, (c) => c.add({ kind: "UNIT_MISMATCH", scope: "INVENTORY", message: "m", code: "F1" }));
  assert.deepEqual(m.map((x) => x.kind).sort(), ["UNIT_MISMATCH", "UNLINKED_CODE"]);
});

test("the same bad code on two Selections is one problem with occurrenceCount 2", () => {
  const c = new ProblemCollector();
  addUnlinkedCodeProblems(c, {
    selections: [
      { id: "s1", componentTypeId: "t1", config: { frameCode: "F1" } },
      { id: "s2", componentTypeId: "t1", config: { frameCode: "F1" } },
    ],
    usedSelectionIds: ["s1", "s2"],
    snapshotTypes: [TYPE],
    isLinked: () => false,
  });
  const p = c.report().problems;
  assert.equal(p.length, 1);
  assert.equal(p[0].occurrenceCount, 2);
});

test("ProblemCollector.hasCode matches by code and kind", () => {
  const c = new ProblemCollector();
  c.add({ kind: "UNRESOLVED_CODE", scope: "INVENTORY", message: "x", code: "A" });
  assert.equal(c.hasCode("A", ["UNRESOLVED_CODE"]), true);
  assert.equal(c.hasCode("A", ["INACTIVE_ITEM"]), false);
  assert.equal(c.hasCode("B", ["UNRESOLVED_CODE"]), false);
});

// ── Stage 37 B2: match-linked fields (Q1) and the combination check (Q-D27) ──────────────────────────────────
import { inventoryCombinationIssues, matchLinkedKeys, matchRowKeysByType } from "@/lib/inventory-link";

const GLASS = [
  f("glassType", { inventoryLinked: true }),
  f("thickness", { dependsOn: "glassType", inventoryLinked: true }),
  f("hingeCode", { inventoryLinked: true }),
  f("film", { type: "checkbox" }),
];
const GLASS_CFG: FieldOptionsConfig = {
  glassType: { options: ["ID1", "ID2"] },
  thickness: { valueMap: { ID1: ["12.76"], ID2: ["10", "12"] } },
  hingeCode: { options: ["H1"] },
};
const item = (rows: Record<string, string>, active = true) => ({ active, rows });

test("matchLinkedKeys: only linked choice fields that are a row key; a field no item has rows for stays a code field", () => {
  const keys = matchLinkedKeys(GLASS, new Set(["glassType", "thickness", "film"]));
  assert.deepEqual([...keys], ["glassType", "thickness"]); // hingeCode has no rows; film is not linked
});

test("matchRowKeysByType collects keys per type, active or inactive, ignoring typeless items", () => {
  const m = matchRowKeysByType([
    { componentTypeId: "t1", rows: { a: "1" } },
    { componentTypeId: "t1", rows: { b: "2" } },
    { componentTypeId: null, rows: { c: "3" } },
    { componentTypeId: "t2" },
  ]);
  assert.deepEqual([...(m.get("t1") ?? [])].sort(), ["a", "b"]);
  assert.equal(m.has("t2"), false);
});

test("inventoryLinkIssues skips match-linked fields (skipKeys) and still reports code fields", () => {
  const all = inventoryLinkIssues(GLASS, GLASS_CFG, () => false);
  assert.deepEqual(Object.keys(all).sort(), ["glassType", "hingeCode", "thickness"]);
  const skipped = inventoryLinkIssues(GLASS, GLASS_CFG, () => false, new Set(["glassType", "thickness"]));
  assert.deepEqual(Object.keys(skipped), ["hingeCode"]);
});

test("combination check: covered by a plain item, not by a film-only item, covered by a broader item", () => {
  const rows = (g: string, t: string) => ({ glassType: g, thickness: t });
  const full = [
    item(rows("ID1", "12.76")), item(rows("ID2", "10")), item(rows("ID2", "12")),
  ];
  assert.deepEqual(inventoryCombinationIssues(GLASS, GLASS_CFG, full), []);

  // only a film item for ID2/12: reported (the Film row is not a linked field, so it does not cover)
  const filmOnly = [item(rows("ID1", "12.76")), item(rows("ID2", "10")), item({ ...rows("ID2", "12"), film: "Yes" })];
  assert.deepEqual(inventoryCombinationIssues(GLASS, GLASS_CFG, filmOnly), [{ glassType: "ID2", thickness: "12" }]);

  // a broader item (fewer rows) covers every thickness of ID2
  const broad = [item(rows("ID1", "12.76")), item({ glassType: "ID2" })];
  assert.deepEqual(inventoryCombinationIssues(GLASS, GLASS_CFG, broad), []);

  // an inactive item covers nothing
  const inactive = [item(rows("ID1", "12.76")), item(rows("ID2", "10")), item(rows("ID2", "12"), false)];
  assert.deepEqual(inventoryCombinationIssues(GLASS, GLASS_CFG, inactive), [{ glassType: "ID2", thickness: "12" }]);
});

test("combination check: only the row-key fields form combinations; no rows anywhere means no combination fields", () => {
  // thickness is not a row key here, so only glassType is match-linked: one combination per glassType value
  const out = inventoryCombinationIssues(GLASS, GLASS_CFG, [item({ glassType: "ID9" })]);
  assert.deepEqual(out, [{ glassType: "ID1" }, { glassType: "ID2" }]);
  assert.deepEqual(inventoryCombinationIssues(GLASS, GLASS_CFG, []), []);
});

test("addUnlinkedCodeProblems skips a match-linked field (its value is matched, not a code)", () => {
  const c = new ProblemCollector();
  addUnlinkedCodeProblems(c, {
    selections: [{ id: "s1", componentTypeId: "t1", config: { hasLeaf: "No", frameCode: "ID1" } }],
    usedSelectionIds: ["s1"],
    snapshotTypes: [TYPE],
    isLinked: () => false,
    matchRowKeys: () => new Set(["frameCode"]),
  });
  assert.equal(c.hasAny(), false);
});
