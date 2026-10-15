/**
 * Quick Estimate stored on an Inquiry (Stage 33 Batch 2, S33-17). Pure: no prisma/next imports.
 *
 * The stored value is a self-contained snapshot of the popup values. It holds no component reference and the
 * server never looks anything up in the catalog. Totals are not stored: a reader runs `computeEstimate`.
 * Validation rejects out-of-range input (it never clamps), so an API caller is told.
 */
import {
  round2,
  validateValueLine,
  type DiscountMode,
  type EstimateUnit,
  type ValueLine,
} from "./estimate";

export const INVALID_QUICK_ESTIMATE = "INVALID_QUICK_ESTIMATE";
export const MAX_ESTIMATE_LINES = 100;

/** Thrown by the stamper; carries the same code the routes map to a 400. */
export class QuickEstimateError extends Error {
  readonly code = INVALID_QUICK_ESTIMATE;
}

/** A validated input, before the server stamps it. `currency` is only present when the client sent one. */
export interface ParsedQuickEstimate {
  currency?: string;
  discountMode: DiscountMode;
  discountValue: number;
  taxPct: number;
  lines: ValueLine[];
}

export interface InquiryQuickEstimateV1 {
  v: 1;
  currency: string;
  discountMode: DiscountMode;
  discountValue: number;
  taxPct: number;
  lines: Array<{ itemName: string; variantText: string; unit: EstimateUnit; qty: number; unitPrice: number }>;
  updatedAt: string;
  updatedByName: string;
}

export type ParseQuickEstimateResult = { ok: true; value: ParsedQuickEstimate } | { ok: false; error: string };

const fail = (error: string): ParseQuickEstimateResult => ({ ok: false, error });

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Parse the `quickEstimate` body value (an object; `null` is handled by the caller as "clear"). */
export function parseQuickEstimateInput(raw: unknown): ParseQuickEstimateResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return fail("quickEstimate must be an object or null");
  }
  const o = raw as Record<string, unknown>;

  if (!Array.isArray(o.lines)) return fail("quickEstimate.lines must be an array");
  if (o.lines.length < 1) return fail("quickEstimate.lines must have at least 1 line (send null to remove the estimate)");
  if (o.lines.length > MAX_ESTIMATE_LINES) return fail(`quickEstimate.lines must have at most ${MAX_ESTIMATE_LINES} lines`);
  const lines: ValueLine[] = [];
  for (let i = 0; i < o.lines.length; i++) {
    const check = validateValueLine(o.lines[i]);
    if (!check.ok) return fail(`quickEstimate.lines[${i}]: ${check.error}`);
    lines.push(check.line);
  }

  let discountMode: DiscountMode = "pct";
  if (o.discountMode !== undefined) {
    if (o.discountMode !== "pct" && o.discountMode !== "amount") return fail('quickEstimate.discountMode must be "pct" or "amount"');
    discountMode = o.discountMode;
  }

  let discountValue = 0;
  if (o.discountValue !== undefined) {
    if (!isNum(o.discountValue)) return fail("quickEstimate.discountValue must be a finite number");
    discountValue = o.discountValue;
    if (discountMode === "pct" && (discountValue < 0 || discountValue > 100)) {
      return fail("quickEstimate.discountValue must be between 0 and 100 for a percentage discount");
    }
    if (discountMode === "amount" && (discountValue < 0 || round2(discountValue) !== discountValue)) {
      return fail("quickEstimate.discountValue must be >= 0 with at most 2 decimals for a fixed-amount discount");
    }
  }

  let taxPct = 0;
  if (o.taxPct !== undefined) {
    if (!isNum(o.taxPct) || o.taxPct < 0 || o.taxPct > 100) return fail("quickEstimate.taxPct must be a number between 0 and 100");
    taxPct = o.taxPct;
  }

  const value: ParsedQuickEstimate = { discountMode, discountValue, taxPct, lines };
  if (o.currency !== undefined) {
    if (typeof o.currency !== "string") return fail("quickEstimate.currency must be a string");
    value.currency = o.currency.trim().toUpperCase();
  }
  return { ok: true, value };
}

/**
 * Build the stored object. The currency is always the inquiry's; a client-sent currency that differs is an error.
 * Unknown keys never reach here (the parser rebuilds the value), and v/updatedAt/updatedByName are server-set.
 */
export function stampQuickEstimate(
  value: ParsedQuickEstimate,
  inquiryCurrency: string,
  byName: string,
  now: Date,
): InquiryQuickEstimateV1 {
  if (value.currency !== undefined && value.currency !== inquiryCurrency) {
    throw new QuickEstimateError(`quickEstimate.currency must match the inquiry currency (${inquiryCurrency})`);
  }
  return {
    v: 1,
    currency: inquiryCurrency,
    discountMode: value.discountMode,
    discountValue: value.discountValue,
    taxPct: value.taxPct,
    lines: value.lines.map((l) => ({
      itemName: l.itemName,
      variantText: l.variantText,
      unit: l.unit,
      qty: l.qty,
      unitPrice: l.unitPrice,
    })),
    updatedAt: now.toISOString(),
    updatedByName: byName,
  };
}
