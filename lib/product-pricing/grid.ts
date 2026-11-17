import { generateCombinations, type EstimateField } from "@/lib/quick-estimate/palette";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";
import { combinationKey } from "./combination";
import { findOrphans } from "./orphans";
import type { PriceEntry } from "./price-entries";

/**
 * Stage 36 (S36-15): the Product Pricing page's combination grid, pure. Combinations come from the one shared
 * generator (S36-7, `generateCombinations`), never a page-local walk. Prisma-free, client-safe.
 */

/** One stored `ProductPricing` row as `GET .../product-pricing` returns it. */
export interface StoredPricingRow {
  id: string;
  componentTypeId: string;
  combinationKey: string;
  combinationLabel: string;
  prices: PriceEntry[];
  description: string | null;
}

export interface GridRow {
  key: string;
  label: string;
  /** Chosen value by field key (a hidden field has no entry, so its cell is blank). */
  values: Record<string, string>;
  row: StoredPricingRow | null;
}

/** PP-11: display cap per type. */
export const MAX_GRID_ROWS = 500;

export interface PricingGrid {
  /** Generated combinations sorted by label, at most MAX_GRID_ROWS. */
  rows: GridRow[];
  /** Number of generated combinations before the cap (the "M" of "N / M priced"). */
  total: number;
  capped: boolean;
  /** Stored rows whose key the current config no longer produces (never capped). */
  orphans: GridRow[];
  /** Generated combinations with at least one price entry. Orphans are excluded (PP-25). */
  pricedCount: number;
}

export function isPriced(row: StoredPricingRow | null | undefined): boolean {
  return !!row && row.prices.length > 0;
}

function parseKeyValues(key: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(key);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function byLabel(a: { label: string; key: string }, b: { label: string; key: string }): number {
  return a.label.localeCompare(b.label) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/** `stored` must already be the rows of this one component type. */
export function buildPricingGrid(
  fields: EstimateField[],
  config: FieldOptionsConfig,
  stored: readonly StoredPricingRow[],
): PricingGrid {
  const byKey = new Map(stored.map((r) => [r.combinationKey, r]));
  const seen = new Set<string>();
  const all: GridRow[] = [];
  for (const opt of generateCombinations(fields, config)) {
    const key = combinationKey(opt.values);
    if (seen.has(key)) continue;
    seen.add(key);
    all.push({ key, label: opt.text, values: opt.values, row: byKey.get(key) ?? null });
  }
  all.sort(byLabel);

  const orphanKeys = new Set(findOrphans(stored.map((r) => r.combinationKey), seen));
  const orphans: GridRow[] = stored
    .filter((r) => orphanKeys.has(r.combinationKey))
    .map((r) => ({ key: r.combinationKey, label: r.combinationLabel, values: parseKeyValues(r.combinationKey), row: r }))
    .sort(byLabel);

  return {
    rows: all.slice(0, MAX_GRID_ROWS),
    total: all.length,
    capped: all.length > MAX_GRID_ROWS,
    orphans,
    pricedCount: all.filter((g) => isPriced(g.row)).length,
  };
}
