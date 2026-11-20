/**
 * Unit tests for lib/inventory-draft.ts (Stage 37 Batch 3, commit 3): the drawer's payload diffing, the Matches row
 * editor reducer and per-row issues, stale detection wiring and the form validation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blankDraft,
  buildSavePayload,
  canAddRow,
  canonicalRows,
  draftFromItem,
  isDirty,
  parsePack,
  pickableFields,
  rowIssues,
  rowsReducer,
  rowsToMatchObject,
  serverRowsValid,
  staleIssue,
  valueOptions,
  validateDraft,
  type DraftRow,
} from "../../lib/inventory-draft";
import type { ListItem, ListType } from "../../lib/inventory-list";

const f = (key: string, label: string, type: string, extra: Record<string, unknown> = {}) => ({
  key,
  label,
  type,
  required: false,
  basic: true,
  ...extra,
});

const GLASS: ListType = {
  id: "t-glass",
  code: "GLASS",
  name: "Glass",
  fieldsSchema: [
    f("glassType", "Glass type", "dropdown", { inventoryLinked: true }),
    f("thickness", "Thickness", "field"),
    f("tempered", "Tempered", "checkbox"),
  ] as ListType["fieldsSchema"],
  fieldOptionsConfig: { glassType: { options: ["NT2", "ID6"] } } as unknown as ListType["fieldOptionsConfig"],
};
const DOOR: ListType = {
  id: "t-door",
  code: "DOOR",
  name: "Door",
  fieldsSchema: [f("hinge", "Hinge", "dropdown", { inventoryLinked: true })] as ListType["fieldsSchema"],
  fieldOptionsConfig: null,
};

function item(over: Partial<ListItem> = {}): ListItem {
  return {
    id: "i1",
    code: "GL-1",
    name: "Glass one",
    componentTypeId: GLASS.id,
    measurementUnit: "m²",
    perUnitQuantity: "1.0000",
    soldInWholePacks: false,
    partKey: "glassType",
    attributes: { glassType: "NT2", thickness: "15.2" },
    active: true,
    createdAt: "2026-11-20T00:00:00Z",
    ...over,
  };
}

test("draftFromItem reads the item and isDirty is false until something changes", () => {
  const d = draftFromItem(item());
  assert.equal(d.pack, "1");
  assert.deepEqual(d.rows, [
    { key: "glassType", value: "NT2" },
    { key: "thickness", value: "15.2" },
  ]);
  assert.equal(isDirty(d, draftFromItem(item())), false);
  assert.equal(isDirty(d, { ...d, name: "x" }), true);
  assert.equal(isDirty(d, { ...d, rows: [...d.rows, { key: "", value: "" }] }), true);
  assert.equal(isDirty(d, { ...d, pack: " 1 " }), false);
});

test("rowsReducer: add, setKey resets the value, setValue, remove", () => {
  let rows: DraftRow[] = [{ key: "thickness", value: "15.2" }];
  rows = rowsReducer(rows, { type: "add" });
  assert.deepEqual(rows[1], { key: "", value: "" });
  rows = rowsReducer(rows, { type: "setKey", index: 1, key: "glassType" });
  rows = rowsReducer(rows, { type: "setValue", index: 1, value: "NT2" });
  assert.deepEqual(rows[1], { key: "glassType", value: "NT2" });
  rows = rowsReducer(rows, { type: "setKey", index: 1, key: "tempered" });
  assert.deepEqual(rows[1], { key: "tempered", value: "" });
  const same = rowsReducer(rows, { type: "setKey", index: 0, key: "thickness" });
  assert.equal(same[0], rows[0], "choosing the same field keeps the row");
  rows = rowsReducer(rows, { type: "remove", index: 0 });
  assert.deepEqual(rows, [{ key: "tempered", value: "" }]);
});

test("pickableFields excludes keys other rows use but keeps the row's own; canAddRow", () => {
  const rows: DraftRow[] = [
    { key: "glassType", value: "NT2" },
    { key: "thickness", value: "1" },
  ];
  assert.deepEqual(pickableFields(GLASS, rows, 0).map((x) => x.key), ["glassType", "tempered"]);
  assert.deepEqual(pickableFields(GLASS, rows, 1).map((x) => x.key), ["thickness", "tempered"]);
  assert.equal(canAddRow(GLASS, rows), true);
  assert.equal(canAddRow(GLASS, [...rows, { key: "tempered", value: "Yes" }]), false, "every field used");
  assert.equal(canAddRow(GLASS, [...rows, { key: "", value: "" }]), false, "a blank row is pending");
  assert.equal(canAddRow(undefined, []), false);
});

test("valueOptions: checkbox Yes/No, choice from the org options, free text none", () => {
  assert.deepEqual(valueOptions(GLASS, "tempered"), ["Yes", "No"]);
  assert.deepEqual(valueOptions(GLASS, "glassType"), ["NT2", "ID6"]);
  assert.deepEqual(valueOptions(GLASS, "thickness"), []);
  assert.deepEqual(valueOptions(GLASS, "gone"), []);
});

test("rowIssues: stale field and value, empty, duplicate, blank field, canonical text is fine", () => {
  const issues = rowIssues(
    [
      { key: "glassType", value: "XX" },
      { key: "gone", value: "1" },
      { key: "thickness", value: "12.760" },
      { key: "tempered", value: "" },
      { key: "", value: "" },
      { key: "glassType", value: "NT2" },
    ],
    GLASS,
  );
  assert.deepEqual(issues, ["VALUE_NOT_OFFERED", "FIELD_REMOVED", null, "NOT_BOOLEAN_WORD", "NO_FIELD", "DUPLICATE"]);
  assert.equal(staleIssue("VALUE_NOT_OFFERED"), true);
  assert.equal(staleIssue("FIELD_REMOVED"), true);
  assert.equal(staleIssue("EMPTY"), false);
  assert.equal(staleIssue(null), false);
  assert.deepEqual(rowIssues([{ key: "thickness", value: "  " }], GLASS), ["EMPTY"]);
});

test("the editor's rule is the server's: no row issue iff the shared array validator passes", () => {
  const samples: DraftRow[][] = [
    [],
    [{ key: "glassType", value: "NT2" }],
    [
      { key: "glassType", value: "NT2" },
      { key: "thickness", value: "15.20" },
    ],
    [{ key: "glassType", value: "ZZ" }],
    [{ key: "gone", value: "a" }],
    [{ key: "tempered", value: "Maybe" }],
    [{ key: "thickness", value: "" }],
    [
      { key: "glassType", value: "NT2" },
      { key: "glassType", value: "NT2" },
    ],
  ];
  for (const rows of samples) {
    const clean = rowIssues(rows, GLASS).every((i) => i === null);
    assert.equal(clean, serverRowsValid(rows, GLASS), JSON.stringify(rows));
  }
});

test("canonicalRows and rowsToMatchObject write free text canonically and skip incomplete rows", () => {
  assert.deepEqual(canonicalRows([{ key: "thickness", value: " 12.760 " }], GLASS), [{ key: "thickness", value: "12.76" }]);
  assert.deepEqual(
    rowsToMatchObject(
      [
        { key: "thickness", value: "12.760" },
        { key: "glassType", value: "" },
        { key: "", value: "x" },
      ],
      GLASS,
    ),
    { thickness: "12.76" },
  );
});

test("parsePack: blank is 1, positive numbers pass, zero/negative/text fail", () => {
  assert.equal(parsePack(""), 1);
  assert.equal(parsePack(" 2.5 "), 2.5);
  assert.equal(parsePack("0"), null);
  assert.equal(parsePack("-1"), null);
  assert.equal(parsePack("abc"), null);
});

test("validateDraft: required fields on create, unassigned legacy item may stay so on edit", () => {
  const blank = blankDraft();
  const v = validateDraft(blank, blank, undefined, "create", 2);
  assert.deepEqual(v.fields, {
    code: "codeRequired",
    name: "nameRequired",
    component: "componentRequired",
    unit: "unitRequired",
  });
  assert.equal(v.ok, false);
  const legacy = draftFromItem(item({ componentTypeId: null, partKey: null, attributes: {} }));
  assert.equal(validateDraft(legacy, { ...legacy, name: "New" }, undefined, "edit", 2).ok, true);
  assert.equal(validateDraft(legacy, { ...legacy, pack: "0" }, undefined, "edit", 2).fields.pack, "packPositive");
});

test("validateDraft: stale rows block only when the rows (or the type) changed", () => {
  const stale = item({ attributes: { gone: "x" }, partKey: null });
  const o = draftFromItem(stale);
  assert.equal(validateDraft(o, { ...o, name: "Renamed" }, GLASS, "edit", 2).ok, true, "unrelated edit");
  const added = { ...o, rows: [...o.rows, { key: "thickness", value: "1" }] };
  assert.equal(validateDraft(o, added, GLASS, "edit", 2).ok, false, "rows changed, stale row still there");
  const fixed = { ...o, rows: [{ key: "thickness", value: "1" }] };
  assert.equal(validateDraft(o, fixed, GLASS, "edit", 2).ok, true, "stale row removed");
});

test("buildSavePayload (edit): no partKey and no attributes on an unrelated edit, even with a stale key", () => {
  const o = draftFromItem(item({ partKey: "removedKey" }));
  const body = buildSavePayload(o, { ...o, name: "Renamed", active: false }, GLASS, "edit");
  assert.equal("partKey" in body, false);
  assert.equal("attributes" in body, false);
  assert.deepEqual(
    { code: body.code, name: body.name, active: body.active, perUnitQuantity: body.perUnitQuantity },
    { code: "GL-1", name: "Renamed", active: false, perUnitQuantity: 1 },
  );
});

test("buildSavePayload (edit): changed Part sends the key, a move to Other sends null (also from a stale key)", () => {
  const o = draftFromItem(item({ partKey: "glassType" }));
  assert.equal(buildSavePayload(o, { ...o, partKey: "thickness" }, GLASS, "edit").partKey, "thickness");
  assert.equal(buildSavePayload(o, { ...o, partKey: null }, GLASS, "edit").partKey, null);
  const stale = draftFromItem(item({ partKey: "removedKey" }));
  const body = buildSavePayload(stale, { ...stale, partKey: null }, GLASS, "edit");
  assert.ok("partKey" in body && body.partKey === null);
});

test("buildSavePayload (edit): changed rows send the full canonical object; removing the last row sends {}", () => {
  const o = draftFromItem(item());
  const edited = { ...o, rows: [o.rows[0], { key: "thickness", value: "15.20" }] };
  assert.deepEqual(buildSavePayload(o, edited, GLASS, "edit").attributes, { glassType: "NT2", thickness: "15.2" });
  assert.deepEqual(buildSavePayload(o, { ...o, rows: [] }, GLASS, "edit").attributes, {});
});

test("buildSavePayload (edit): a type change sends only a newly chosen Part and newly entered rows", () => {
  const o = draftFromItem(item());
  const moved = { ...o, componentTypeId: DOOR.id, partKey: null, rows: [] };
  const body = buildSavePayload(o, moved, DOOR, "edit");
  assert.equal(body.componentTypeId, DOOR.id);
  assert.equal("partKey" in body, false, "server clears it");
  assert.deepEqual(body.attributes, {}, "rows changed (cleared) so the empty object goes out");
  const none = draftFromItem(item({ componentTypeId: null, partKey: null, attributes: {} }));
  const typed = { ...none, componentTypeId: DOOR.id, partKey: "hinge", rows: [] };
  const b2 = buildSavePayload(none, typed, DOOR, "edit");
  assert.equal(b2.partKey, "hinge");
  assert.equal("attributes" in b2, false);
});

test("buildSavePayload (create): full body, partKey and attributes only when present", () => {
  const d = {
    ...blankDraft(),
    code: " GL-9 ",
    name: "Nine",
    componentTypeId: GLASS.id,
    measurementUnit: "m²",
    pack: "",
    soldInWholePacks: false,
  };
  const bare = buildSavePayload(blankDraft(), d, GLASS, "create");
  assert.deepEqual(bare, {
    code: "GL-9",
    name: "Nine",
    componentTypeId: GLASS.id,
    measurementUnit: "m²",
    perUnitQuantity: 1,
    soldInWholePacks: false,
    active: true,
  });
  const full = buildSavePayload(
    blankDraft(),
    { ...d, partKey: "glassType", rows: [{ key: "glassType", value: "NT2" }] },
    GLASS,
    "create",
  );
  assert.equal(full.partKey, "glassType");
  assert.deepEqual(full.attributes, { glassType: "NT2" });
});
