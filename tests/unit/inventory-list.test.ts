/**
 * Unit tests for lib/inventory-list.ts (Stage 37 Batch 3): Part grouping, tab/search/chip filtering, sorting,
 * tab counts and "Also matched by".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alsoMatchedBy,
  filterItems,
  groupByPart,
  partKeyOf,
  partLabelOf,
  sortItems,
  tabCounts,
  type ListItem,
  type ListType,
} from "../../lib/inventory-list";

const f = (key: string, label: string, extra: Record<string, unknown> = {}) => ({
  key,
  label,
  type: "dropdown" as const,
  required: false,
  basic: true,
  ...extra,
});

const DOOR: ListType = {
  id: "t-door",
  code: "DOOR",
  name: "Door",
  fieldsSchema: [f("category", "Category"), f("leaf", "Leaf", { inventoryLinked: true }), f("hinge", "Hinge", { inventoryLinked: true })],
  fieldOptionsConfig: null,
};
const GLASS: ListType = {
  id: "t-glass",
  code: "GLASS",
  name: "Glass",
  fieldsSchema: [f("glassType", "Glass type")],
  fieldOptionsConfig: null,
};
const TYPES = [DOOR, GLASS];

let n = 0;
function item(over: Partial<ListItem>): ListItem {
  n += 1;
  return {
    id: `i${n}`,
    code: `C${n}`,
    name: `Name ${n}`,
    componentTypeId: null,
    measurementUnit: "pieces",
    perUnitQuantity: "1",
    soldInWholePacks: true,
    partKey: null,
    attributes: {},
    active: true,
    createdAt: "2026-11-20T00:00:00Z",
    ...over,
  };
}

test("partKeyOf: stale, unflagged, untyped and null keys all read Other", () => {
  assert.equal(partKeyOf(item({ componentTypeId: DOOR.id, partKey: "hinge" }), DOOR), "hinge");
  assert.equal(partKeyOf(item({ componentTypeId: DOOR.id, partKey: "gone" }), DOOR), null);
  assert.equal(partKeyOf(item({ componentTypeId: DOOR.id, partKey: "category" }), DOOR), null, "not inventoryLinked");
  assert.equal(partKeyOf(item({ partKey: "hinge" }), undefined), null, "untyped");
  assert.equal(partKeyOf(item({ componentTypeId: DOOR.id }), DOOR), null);
  assert.equal(partLabelOf(item({ componentTypeId: DOOR.id, partKey: "leaf" }), DOOR), "Leaf");
});

test("groupByPart: Catalog order, Other last, empty groups hidden", () => {
  const rows = [
    item({ code: "A", componentTypeId: DOOR.id, partKey: "hinge" }),
    item({ code: "B", componentTypeId: DOOR.id, partKey: null }),
    item({ code: "C", componentTypeId: DOOR.id, partKey: "hinge" }),
    item({ code: "D", componentTypeId: DOOR.id, partKey: "stale" }),
  ];
  const groups = groupByPart(rows, DOOR);
  assert.deepEqual(groups.map((g) => g.key), ["hinge", null], "Leaf has no rows so it is hidden; Other is last");
  assert.deepEqual(groups[0].items.map((i) => i.code), ["A", "C"]);
  assert.deepEqual(groups[1].items.map((i) => i.code), ["B", "D"], "a stale key joins Other");
  assert.deepEqual(groupByPart([], DOOR), []);
});

test("filterItems: tab, search on code or name, status chips", () => {
  const a = item({ code: "GL-NT2", name: "Frosted", componentTypeId: GLASS.id });
  const b = item({ code: "DR-HNG", name: "Hinge steel", componentTypeId: DOOR.id, active: false });
  const c = item({ code: "XX-1", name: "Legacy glass thing" });
  const all = [a, b, c];
  const base = { tab: "all", q: "", active: false, inactive: false };
  assert.equal(filterItems(all, base).length, 3);
  assert.deepEqual(filterItems(all, { ...base, tab: GLASS.id }), [a]);
  assert.deepEqual(filterItems(all, { ...base, tab: "none" }), [c]);
  assert.deepEqual(filterItems(all, { ...base, q: "  HINGE " }), [b], "case-insensitive, trimmed, name match");
  assert.deepEqual(filterItems(all, { ...base, q: "gl-" }), [a], "code match");
  assert.deepEqual(filterItems(all, { ...base, inactive: true }), [b]);
  assert.deepEqual(filterItems(all, { ...base, active: true }), [a, c]);
  assert.equal(filterItems(all, { ...base, active: true, inactive: true }).length, 3, "both chips = no filter");
  assert.deepEqual(filterItems(all, { ...base, tab: DOOR.id, active: true }), [], "no results");
});

test("tabCounts", () => {
  const rows = [
    item({ componentTypeId: DOOR.id }),
    item({ componentTypeId: DOOR.id }),
    item({ componentTypeId: GLASS.id }),
    item({}),
    item({ componentTypeId: "t-unknown" }),
  ];
  assert.deepEqual(tabCounts(rows, TYPES), { all: 5, none: 1, "t-door": 2, "t-glass": 1 });
});

test("sortItems: code default, numeric-aware, desc, part puts Other last, status, pack", () => {
  const a = item({ code: "B10", name: "x", componentTypeId: DOOR.id, partKey: "hinge", perUnitQuantity: "10" });
  const b = item({ code: "B2", name: "y", componentTypeId: DOOR.id, partKey: null, perUnitQuantity: "2", active: false });
  const c = item({ code: "A1", name: "z", componentTypeId: DOOR.id, partKey: "leaf", perUnitQuantity: "3.5" });
  const codes = (rows: ListItem[]) => rows.map((r) => r.code);
  assert.deepEqual(codes(sortItems([a, b, c], { key: "code", dir: 1 }, TYPES)), ["A1", "B2", "B10"]);
  assert.deepEqual(codes(sortItems([a, b, c], { key: "code", dir: -1 }, TYPES)), ["B10", "B2", "A1"]);
  assert.deepEqual(codes(sortItems([a, b, c], { key: "part", dir: 1 }, TYPES)), ["B10", "A1", "B2"], "Hinge, Leaf, Other");
  assert.deepEqual(codes(sortItems([a, b, c], { key: "pack", dir: 1 }, TYPES)), ["B2", "A1", "B10"], "numeric not text");
  assert.deepEqual(codes(sortItems([a, b, c], { key: "status", dir: 1 }, TYPES)), ["A1", "B10", "B2"], "active first, code tiebreak");
  assert.deepEqual(codes([a, b, c]), ["B10", "B2", "A1"], "input not mutated");
});

test("alsoMatchedBy: active, same type, identical non-empty rows only", () => {
  const rows = { glassType: "NT2", thickness: "15.2" };
  const me = item({ componentTypeId: GLASS.id, attributes: rows });
  const twin = item({ componentTypeId: GLASS.id, attributes: { thickness: "15.2", glassType: "NT2" } });
  const inactiveTwin = item({ componentTypeId: GLASS.id, attributes: rows, active: false });
  const otherType = item({ componentTypeId: DOOR.id, attributes: rows });
  const subset = item({ componentTypeId: GLASS.id, attributes: { glassType: "NT2" } });
  const all = [me, twin, inactiveTwin, otherType, subset];
  assert.deepEqual(alsoMatchedBy(me, rows, all), [twin], "order-insensitive; inactive, other type, subset excluded");
  assert.deepEqual(alsoMatchedBy({ ...me, active: false }, rows, all), [], "an inactive item shows nothing");
  assert.deepEqual(alsoMatchedBy({ ...me, componentTypeId: null }, rows, all), [], "untyped shows nothing");
  assert.deepEqual(alsoMatchedBy(me, {}, [item({ componentTypeId: GLASS.id, attributes: {} }), me]), [], "no rows, no match");
  assert.deepEqual(alsoMatchedBy(me, { glassType: "NT2" }, all), [subset], "computed against the given (draft) rows");
});
