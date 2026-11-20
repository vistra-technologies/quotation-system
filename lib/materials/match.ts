/**
 * `materialMatch` matcher (Stage 37 Batch 2, S37-1).
 *
 * PURE: no Prisma, no lib/data/* calls (type-only imports). Given the org's candidate items and one Selection's
 * stored values, returns every ACTIVE item whose Matches rows all equal the Selection's visible values, plus the
 * INACTIVE items that would have matched. Value canonicalisation is `canonicalMatchValue`, shared with the save checks.
 *
 * Candidate rules: same ComponentType, same measurement unit (strict, Q-D23), at least one Matches row (an item
 * without rows is never a candidate). A row on a hidden, blank or unknown field never matches; a stale row (value
 * no longer equal to anything the Selection holds) simply does not match, never throws (S37-6).
 */
import type { InventoryRow } from "@/lib/data/inventory";
import { canonicalMatchValue } from "@/lib/inventory-matches";
import type { MatchRows } from "@/lib/inventory-matches";

export interface MatchCandidate {
  code: string;
  componentTypeId: string | null;
  measurementUnit: string;
  active: boolean;
  rows: MatchRows;
}

/** One candidate per inventory item that has at least one Matches row. */
export function matchCandidatesFrom(map: Map<string, InventoryRow>): MatchCandidate[] {
  const out: MatchCandidate[] = [];
  for (const [code, item] of map) {
    const rows = item.rows ?? {};
    if (Object.keys(rows).length === 0) continue;
    out.push({
      code,
      componentTypeId: item.componentTypeId,
      measurementUnit: item.measurementUnit,
      active: item.active,
      rows,
    });
  }
  return out;
}

export interface MatchQuery {
  typeId: string;
  unit: string;
  /** The Selection's stored config with hidden keys already removed. */
  values: Record<string, unknown>;
  /** Field keys visible for these values (lib/field-visibility pass). */
  visibleKeys: ReadonlySet<string>;
  /** fieldKey -> field type of the Selection's (snapshot) schema. */
  fieldTypes: ReadonlyMap<string, string>;
}

export function matchItems(
  candidates: ReadonlyArray<MatchCandidate>,
  q: MatchQuery,
): { matched: MatchCandidate[]; inactive: MatchCandidate[] } {
  const matched: MatchCandidate[] = [];
  const inactive: MatchCandidate[] = [];
  for (const c of candidates) {
    if (c.componentTypeId !== q.typeId || c.measurementUnit !== q.unit) continue;
    const entries = Object.entries(c.rows);
    if (entries.length === 0) continue;
    const all = entries.every(([key, want]) => {
      const type = q.fieldTypes.get(key);
      if (type === undefined || !q.visibleKeys.has(key)) return false;
      return canonicalMatchValue(q.values[key], type) === want;
    });
    if (!all) continue;
    (c.active ? matched : inactive).push(c);
  }
  return { matched, inactive };
}
