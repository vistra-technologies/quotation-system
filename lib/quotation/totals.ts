/**
 * The totals chain (Stage 38 Q-D12, S38-7), all in integer cents. PURE.
 *   lines total + Transport + Other charges = Subtotal
 *   Subtotal - Discount (percent of the subtotal, or a fixed amount capped at the subtotal)
 *   + Tax % on the discounted amount = Grand total
 * Percent values are hundredths of a percent (18.50 % = 1850). A stored fixed discount above the subtotal is
 * capped here, the stored input is kept (S38-7).
 */
import { percentOfCents } from "@/lib/money";
import { lineCents } from "./lines";
import type { DiscountType, QuotationLine } from "./types";

export interface TotalsInput {
  lines: ReadonlyArray<Pick<QuotationLine, "amount">>;
  /** Cents. */
  transport: number;
  /** Cents. */
  otherCharges: number;
  discountType: DiscountType;
  /** Hundredths of a percent for PERCENT, cents for FIXED. */
  discount: number;
  /** Hundredths of a percent. */
  taxHundredths: number;
}

export interface Totals {
  linesTotal: number;
  subtotal: number;
  discountAmount: number;
  discountedAmount: number;
  taxAmount: number;
  grandTotal: number;
}

export function discountAmountOf(type: DiscountType, discount: number, subtotal: number): number {
  return type === "PERCENT" ? percentOfCents(subtotal, discount) : Math.min(discount, subtotal);
}

export function linesTotalOf(lines: ReadonlyArray<Pick<QuotationLine, "amount">>): number {
  return lines.reduce((sum, l) => sum + lineCents(l.amount), 0);
}

export function computeTotals(input: TotalsInput): Totals {
  const linesTotal = linesTotalOf(input.lines);
  const subtotal = linesTotal + input.transport + input.otherCharges;
  const discountAmount = discountAmountOf(input.discountType, input.discount, subtotal);
  const discountedAmount = subtotal - discountAmount;
  const taxAmount = percentOfCents(discountedAmount, input.taxHundredths);
  return { linesTotal, subtotal, discountAmount, discountedAmount, taxAmount, grandTotal: discountedAmount + taxAmount };
}
