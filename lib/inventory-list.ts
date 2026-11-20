/**
 * Stage 37 Batch 3: pure logic behind the Inventory page (grouping, filtering, sorting, "Also matched by").
 *
 * No React, no I/O, client-safe: the list component and the unit tests share it. Type-only imports plus the
 * pure Matches helpers from `lib/inventory-matches`.
 */
import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";
import { identicalMatchSet, readMatchRows } from "@/lib/inventory-matches";

/** One row of GET /api/v1/orgs/[orgSlug]/inventory, the fields the page reads. */
export interface ListItem {
  id: string;
  code: string;
  name: string;
  componentTypeId: string | null;
  measurementUnit: string;
  /** Prisma Decimal serialises as a string. */
  perUnitQuantity: string | number;
  soldInWholePacks: boolean;
  /** FieldEntry.key of an `inventoryLinked` field of the item's type, or null (Other). */
  partKey: string | null;
  /** Matches rows: a JSON object of string values; anything else reads as "no rows". */
  attributes: unknown;
  active: boolean;
  createdAt: string;
}

/** The slice of a ComponentType (GET .../component-types) the page needs. */
export interface ListType {
  id: string;
  code: string;
  name: string;
  fieldsSchema: FieldEntry[];
  fieldOptionsConfig: FieldOptionsConfig | null;
}

export type TabId = "all" | "none" | string;

export interface ListFilters {
  tab: TabId;
  q: string;
  /** Both on or both off means no status filter (mockup `filtered`). */
  active: boolean;
  inactive: boolean;
}

export type SortKey = "code" | "name" | "comp" | "part" | "pack" | "status";
export interface SortState {
  key: SortKey;
  dir: 1 | -1;
}

export const DEFAULT_SORT: SortState = { key: "code", dir: 1 };

/** The Part fields of a type, in Catalog order: its `inventoryLinked` fields. */
export function partFields(type: ListType | undefined): FieldEntry[] {
  return (type?.fieldsSchema ?? []).filter((f) => f.inventoryLinked === true);
}

/**
 * The item's Part key, or null for Other. A stored key that is no longer an `inventoryLinked` field of the
 * item's type (field removed, flag removed, type changed) and an untyped item both read Other.
 */
export function partKeyOf(item: ListItem, type: ListType | undefined): string | null {
  if (!type || !item.partKey) return null;
  return partFields(type).some((f) => f.key === item.partKey) ? item.partKey : null;
}

/** The Part label (the field's label), or null for Other. */
export function partLabelOf(item: ListItem, type: ListType | undefined): string | null {
  const key = partKeyOf(item, type);
  if (!key) return null;
  return partFields(type).find((f) => f.key === key)?.label ?? null;
}

export interface PartGroup {
  /** null = Other. */
  key: string | null;
  /** null = Other (the caller renders the translated "Other"). */
  label: string | null;
  items: ListItem[];
}

/** Q-D21: rows of one type grouped by Part, Catalog order, Other last, empty groups hidden. */
export function groupByPart(rows: ListItem[], type: ListType | undefined): PartGroup[] {
  const groups: PartGroup[] = partFields(type).map((f) => ({ key: f.key, label: f.label, items: [] }));
  const other: PartGroup = { key: null, label: null, items: [] };
  for (const row of rows) {
    const key = partKeyOf(row, type);
    (groups.find((g) => g.key === key) ?? other).items.push(row);
  }
  return [...groups, other].filter((g) => g.items.length > 0);
}

/** Tab, search (code or name, case-insensitive) and the Active/Inactive chips. */
export function filterItems(items: ListItem[], f: ListFilters): ListItem[] {
  let rows = items;
  if (f.tab === "none") rows = rows.filter((i) => !i.componentTypeId);
  else if (f.tab !== "all") rows = rows.filter((i) => i.componentTypeId === f.tab);
  const q = f.q.trim().toLowerCase();
  if (q) rows = rows.filter((i) => i.code.toLowerCase().includes(q) || i.name.toLowerCase().includes(q));
  if (f.active !== f.inactive) rows = rows.filter((i) => i.active === f.active);
  return rows;
}

export function tabCounts(items: ListItem[], types: ListType[]): Record<string, number> {
  const counts: Record<string, number> = { all: items.length, none: 0 };
  for (const t of types) counts[t.id] = 0;
  for (const i of items) {
    if (!i.componentTypeId) counts.none += 1;
    else if (i.componentTypeId in counts) counts[i.componentTypeId] += 1;
  }
  return counts;
}

function compare(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

/** Sort a copy. Ties fall back to the code so the order is stable. Other sorts last on Part (ascending). */
export function sortItems(items: ListItem[], sort: SortState, types: ListType[]): ListItem[] {
  const typeById = new Map(types.map((t) => [t.id, t] as const));
  const keyOf: Record<SortKey, (i: ListItem) => string | number> = {
    code: (i) => i.code,
    name: (i) => i.name,
    comp: (i) => (i.componentTypeId ? (typeById.get(i.componentTypeId)?.name ?? "zz") : "zz"),
    part: (i) => partLabelOf(i, i.componentTypeId ? typeById.get(i.componentTypeId) : undefined) ?? "\uffff",
    pack: (i) => Number(i.perUnitQuantity),
    status: (i) => (i.active ? 0 : 1),
  };
  const key = keyOf[sort.key];
  return [...items].sort((x, y) => compare(key(x), key(y)) * sort.dir || compare(x.code, y.code));
}

/**
 * "Also matched by": the OTHER active items of the same type whose Matches rows are identical to these rows
 * (rev 5, duplicates are allowed). Empty unless the item is active, typed and has at least one row.
 */
export function alsoMatchedBy(
  item: Pick<ListItem, "id" | "active" | "componentTypeId">,
  rows: Record<string, string>,
  all: ListItem[],
): ListItem[] {
  if (!item.active || !item.componentTypeId || Object.keys(rows).length === 0) return [];
  return all.filter(
    (o) =>
      o.id !== item.id &&
      o.active &&
      o.componentTypeId === item.componentTypeId &&
      identicalMatchSet(readMatchRows(o.attributes), rows),
  );
}
