import { UNIT_AREA, UNIT_SQFT, round2, type EstimateUnit } from "./estimate";

/**
 * Stage 36 Batch 5 (S36-13, S36-18): the one area-unit conversion helper. It converts a QUANTITY only: a rate is
 * never converted (it resets to the exact product price or empty, PP-27), so there is deliberately no rate maths here.
 */

export type AreaUnit = typeof UNIT_AREA | typeof UNIT_SQFT;

/** 1 m² in sq ft (the only conversion factor in the Quick Estimate code). */
export const SQFT_PER_M2 = 10.7639;

export function isAreaUnit(u: EstimateUnit | null): u is AreaUnit {
  return u === UNIT_AREA || u === UNIT_SQFT;
}

/** Converts a quantity between area units, rounded once to 2 decimals from the given value. */
export function convertAreaQty(qty: number, from: AreaUnit, to: AreaUnit): number {
  if (from === to) return round2(qty);
  return round2(from === UNIT_AREA ? qty * SQFT_PER_M2 : qty / SQFT_PER_M2);
}

/** The same for a typed quantity string: blank, non-numeric and non-positive input is left exactly as typed. */
export function convertAreaQtyString(raw: string, from: AreaUnit, to: AreaUnit): string {
  if (from === to) return raw;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return raw;
  return String(convertAreaQty(n, from, to));
}
