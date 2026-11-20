/**
 * Parsing and checking the editable money inputs of a quotation (PATCH body; Q-D12, Q-D19, Q-D33). PURE.
 * Amounts are integer cents; the discount is hundredths of a percent for PERCENT and cents for FIXED (the same
 * grammar: non-negative, at most 2 dp), so one parsed integer serves both types.
 */
import { centsToFixed, parseMoneyToCents, parsePercentToHundredths } from "@/lib/money";
import type { DiscountType } from "./types";

export interface QuotationInputPatch {
  transport?: number;
  otherCharges?: number;
  discount?: number;
  discountType?: DiscountType;
  taxHundredths?: number;
}

const KEYS = ["transport", "otherCharges", "discount", "discountType", "taxPercent"];

export type PatchParse = { ok: true; patch: QuotationInputPatch } | { ok: false; error: string };

/** Shape and range validation that needs no stored state. `checkDiscount` then fits the discount to the subtotal. */
export function parseQuotationPatch(body: unknown): PatchParse {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "Body must be a JSON object" };
  const b = body as Record<string, unknown>;
  const unknownKey = Object.keys(b).find((k) => !KEYS.includes(k));
  if (unknownKey) return { ok: false, error: `Unknown field: ${unknownKey}` };
  if (Object.keys(b).length === 0) return { ok: false, error: "Nothing to update" };

  const patch: QuotationInputPatch = {};
  for (const k of ["transport", "otherCharges"] as const) {
    if (b[k] === undefined) continue;
    const c = parseMoneyToCents(b[k]);
    if (c === null) return { ok: false, error: `${k} must be a non-negative amount with at most 2 decimal places` };
    patch[k] = c;
  }
  if (b.taxPercent !== undefined) {
    const h = parsePercentToHundredths(b.taxPercent);
    if (h === null) return { ok: false, error: "taxPercent must be between 0 and 100 with at most 2 decimal places" };
    patch.taxHundredths = h;
  }
  if (b.discountType !== undefined) {
    if (b.discountType !== "PERCENT" && b.discountType !== "FIXED") return { ok: false, error: "discountType must be PERCENT or FIXED" };
    patch.discountType = b.discountType;
  }
  if (b.discount !== undefined) {
    const c = parseMoneyToCents(b.discount);
    if (c === null) return { ok: false, error: "discount must be a non-negative amount with at most 2 decimal places" };
    patch.discount = c;
  }
  return { ok: true, patch };
}

/**
 * The typed discount against its type and the current subtotal (Q-D33): a PERCENT is 0 to 100; a FIXED amount
 * above the subtotal is refused (equal is fine). Returns an error message, or null when it fits.
 */
export function checkDiscount(type: DiscountType, discount: number, subtotal: number): string | null {
  if (type === "PERCENT") return discount > 10000 ? "A percentage discount cannot exceed 100" : null;
  return discount > subtotal ? `The discount cannot exceed the subtotal (${centsToFixed(subtotal)})` : null;
}
