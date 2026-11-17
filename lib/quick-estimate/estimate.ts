/**
 * Quick Estimate: value-only maths and line validation (Stage 33, S33-6 / S33-7).
 *
 * Deliberately imports NOTHING (no palette types, no prisma/next, no DOM): this is the server-safe layer that
 * Batch 2 (the Inquiry snapshot) reuses. A line here is a pure value snapshot (name, variant text, unit, qty,
 * price) with no component reference.
 */

export const UNIT_AREA = "m²" as const;
export const UNIT_PIECE = "pcs" as const;
export const ESTIMATE_UNITS = [UNIT_AREA, UNIT_PIECE] as const;
export type EstimateUnit = (typeof ESTIMATE_UNITS)[number];

export type DiscountMode = "pct" | "amount";

/** The discount as entered: a percentage of the subtotal, or a fixed amount (D-6). */
export interface Discount {
  mode: DiscountMode;
  value: number;
}

/** Stage 36 S36-14: the unit a product price was entered in (the pricing API's unit vocabulary). */
export const SUGGESTED_UNITS = ["m2", "sqft", "pcs"] as const;
export type SuggestedUnit = (typeof SUGGESTED_UNITS)[number];

export interface ValueLine {
  itemName: string;
  variantText: string;
  unit: EstimateUnit;
  qty: number;
  unitPrice: number;
  /**
   * Stage 36 S36-14, all optional and additive: a Stage 33 line has none of them and stays valid. The estimate is
   * a self-contained snapshot, so none of these is re-checked against live pricing.
   */
  suggestedUnitPrice?: number | null;
  suggestedUnit?: SuggestedUnit | null;
  combinationKey?: string | null;
  description?: string | null;
  descriptionEdited?: boolean;
  attachDescription?: boolean;
}

export const MAX_ITEM_NAME = 120;
export const MAX_VARIANT_TEXT = 200;
export const MAX_LINE_DESCRIPTION = 500;
/** Same cap as `MAX_KEY_LENGTH` in lib/product-pricing/combination.ts (this layer imports nothing). */
export const MAX_COMBINATION_KEY = 1000;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** A finite number above 0, else 0 (blank, negative, NaN and Infinity all mean 0). */
function positive(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function clampPct(n: number): number {
  return Math.min(100, positive(n));
}

/**
 * Quantity rules (S33-4 / S33-6): blank/negative/invalid is 0; pcs must be a whole number (a fraction is
 * invalid, so 0); m² keeps at most 2 decimals.
 */
export function normalizeQty(qty: number, unit: EstimateUnit): number {
  const q = positive(qty);
  if (unit === UNIT_PIECE) return Number.isInteger(q) ? q : 0;
  return round2(q);
}

export function parseQty(raw: string | number, unit: EstimateUnit): number {
  return normalizeQty(typeof raw === "number" ? raw : parseFloat(raw), unit);
}

export function parseUnitPrice(raw: string | number): number {
  return positive(typeof raw === "number" ? raw : parseFloat(raw));
}

/** True when a typed pcs quantity is non-blank but not a whole number (the invalid style). */
export function isInvalidQty(raw: string, unit: EstimateUnit): boolean {
  if (raw.trim() === "") return false;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return true;
  return unit === UNIT_PIECE && !Number.isInteger(n);
}

export interface EstimateLineResult {
  /** `round2(qty × unitPrice)`; 0 when unpriced. */
  total: number;
  /** qty > 0 and unit price > 0 (the line shows an amount and goes on the PDF). */
  priced: boolean;
}

export interface EstimateResult {
  lines: EstimateLineResult[];
  subtotal: number;
  discountMode: DiscountMode;
  /** The effective value: pct clamped to 0-100; amount as entered (>= 0). */
  discountValue: number;
  /** The applied discount amount. */
  discount: number;
  taxPct: number;
  tax: number;
  grandTotal: number;
  /** How many lines are priced. */
  priced: number;
}

/**
 * S33-7. subtotal = round2(sum of line totals); discount = pct: round2(subtotal x d%), amount:
 * round2(min(value, subtotal)); tax = round2((subtotal - discount) x t%); total = round2(subtotal - discount + tax).
 * Percentages clamp to 0-100; blank/negative/non-numeric is 0. Every step is rounded.
 */
export function computeEstimate(lines: ValueLine[], discount: Discount, taxPct: number): EstimateResult {
  const results: EstimateLineResult[] = lines.map((l) => {
    const qty = normalizeQty(l.qty, l.unit);
    const price = positive(l.unitPrice);
    const priced = qty > 0 && price > 0;
    return { total: priced ? round2(qty * price) : 0, priced };
  });
  const subtotal = round2(results.reduce((sum, r) => sum + r.total, 0));

  const discountMode = discount.mode;
  const discountValue = discountMode === "pct" ? clampPct(discount.value) : positive(discount.value);
  const discountAmount =
    discountMode === "pct" ? round2((subtotal * discountValue) / 100) : round2(Math.min(discountValue, subtotal));

  const t = clampPct(taxPct);
  const tax = round2(((subtotal - discountAmount) * t) / 100);

  return {
    lines: results,
    subtotal,
    discountMode,
    discountValue,
    discount: discountAmount,
    taxPct: t,
    tax,
    grandTotal: round2(subtotal - discountAmount + tax),
    priced: results.filter((r) => r.priced).length,
  };
}

export type ValueLineCheck = { ok: true; line: ValueLine } | { ok: false; error: string };

/**
 * Strict check of one stored/received line (rejects, never clamps). Shared by the sessionStorage restore
 * (Batch 1) and, by design, Batch 2's server parser. Strings are trimmed.
 */
export function validateValueLine(raw: unknown): ValueLineCheck {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: "line must be an object" };
  const o = raw as Record<string, unknown>;

  if (typeof o.itemName !== "string") return { ok: false, error: "itemName must be a string" };
  const itemName = o.itemName.trim();
  if (itemName.length < 1 || itemName.length > MAX_ITEM_NAME) {
    return { ok: false, error: `itemName must be 1 to ${MAX_ITEM_NAME} characters` };
  }

  let variantText = "";
  if (o.variantText !== undefined && o.variantText !== null) {
    if (typeof o.variantText !== "string") return { ok: false, error: "variantText must be a string" };
    variantText = o.variantText.trim();
    if (variantText.length > MAX_VARIANT_TEXT) return { ok: false, error: `variantText must be at most ${MAX_VARIANT_TEXT} characters` };
  }

  if (o.unit !== UNIT_AREA && o.unit !== UNIT_PIECE) return { ok: false, error: `unit must be "${UNIT_AREA}" or "${UNIT_PIECE}"` };
  const unit: EstimateUnit = o.unit;

  const qty = o.qty;
  if (typeof qty !== "number" || !Number.isFinite(qty) || qty < 0) return { ok: false, error: "qty must be a finite number >= 0" };
  if (unit === UNIT_PIECE && !Number.isInteger(qty)) return { ok: false, error: "qty must be a whole number for pcs" };
  if (unit === UNIT_AREA && round2(qty) !== qty) return { ok: false, error: "qty must have at most 2 decimals for m²" };

  const unitPrice = o.unitPrice;
  if (typeof unitPrice !== "number" || !Number.isFinite(unitPrice) || unitPrice < 0) {
    return { ok: false, error: "unitPrice must be a finite number >= 0" };
  }

  const line: ValueLine = { itemName, variantText, unit, qty, unitPrice };

  // Stage 36 S36-14 optional keys. Absent (undefined) stays absent, so a Stage 33 line is returned unchanged.
  if (o.suggestedUnitPrice !== undefined) {
    const p = o.suggestedUnitPrice;
    if (p !== null && (typeof p !== "number" || !Number.isFinite(p) || p < 0 || round2(p) !== p)) {
      return { ok: false, error: "suggestedUnitPrice must be null or a number >= 0 with at most 2 decimals" };
    }
    line.suggestedUnitPrice = p;
  }
  if (o.suggestedUnit !== undefined) {
    const u = o.suggestedUnit;
    if (u !== null && !(SUGGESTED_UNITS as readonly unknown[]).includes(u)) {
      return { ok: false, error: 'suggestedUnit must be null, "m2", "sqft" or "pcs"' };
    }
    line.suggestedUnit = u as SuggestedUnit | null;
  }
  if (o.combinationKey !== undefined) {
    const k = o.combinationKey;
    if (k !== null && (typeof k !== "string" || k.length > MAX_COMBINATION_KEY)) {
      return { ok: false, error: `combinationKey must be null or a string of at most ${MAX_COMBINATION_KEY} characters` };
    }
    line.combinationKey = k;
  }
  if (o.description !== undefined) {
    const d = o.description;
    if (d === null) line.description = null;
    else {
      if (typeof d !== "string") return { ok: false, error: "description must be null or a string" };
      const trimmed = d.trim();
      if (trimmed.length > MAX_LINE_DESCRIPTION) {
        return { ok: false, error: `description must be at most ${MAX_LINE_DESCRIPTION} characters` };
      }
      line.description = trimmed === "" ? null : trimmed;
    }
  }
  if (o.descriptionEdited !== undefined) {
    if (typeof o.descriptionEdited !== "boolean") return { ok: false, error: "descriptionEdited must be a boolean" };
    line.descriptionEdited = o.descriptionEdited;
  }
  if (o.attachDescription !== undefined) {
    if (typeof o.attachDescription !== "boolean") return { ok: false, error: "attachDescription must be a boolean" };
    line.attachDescription = o.attachDescription;
  }

  return { ok: true, line };
}

/** The Stage 36 optional keys of a line, copied only when present (one place for the stamper and the bridges). */
export function pricingKeysOf(l: ValueLine): Partial<ValueLine> {
  const out: Partial<ValueLine> = {};
  if (l.suggestedUnitPrice !== undefined) out.suggestedUnitPrice = l.suggestedUnitPrice;
  if (l.suggestedUnit !== undefined) out.suggestedUnit = l.suggestedUnit;
  if (l.combinationKey !== undefined) out.combinationKey = l.combinationKey;
  if (l.description !== undefined) out.description = l.description;
  if (l.descriptionEdited !== undefined) out.descriptionEdited = l.descriptionEdited;
  if (l.attachDescription !== undefined) out.attachDescription = l.attachDescription;
  return out;
}

/** S36-14: a description prints/shows only when attached and non-blank. */
export function attachedDescription(l: Pick<ValueLine, "attachDescription" | "description">): string | null {
  if (l.attachDescription !== true) return null;
  const d = (l.description ?? "").trim();
  return d === "" ? null : d;
}
