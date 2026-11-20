/**
 * The API shape of a quotation (Stage 38). PURE: takes the stored row (Decimal columns as anything with
 * `toString()`), the live flags' inputs and `now`, returns plain JSON. Totals are recomputed from `lines` and the
 * stored inputs (S38-3: the client never sends totals), so a stored fixed discount above a lowered subtotal shows
 * capped (S38-7).
 */
import { centsToFixed, decimalToCents, toFixed2 } from "@/lib/money";
import { anyLineEdited } from "./lines";
import { deriveStatus, formatQuotationNumber, isDesignChanged } from "./meta";
import { computeTotals, type Totals } from "./totals";
import type { DiscountType, QuotationLine, QuotationStatus } from "./types";

type Dec = { toString(): string };

/** What the DAL selects (explicit select; `materialByRoom` never involved). */
export interface QuotationRow {
  id: string;
  projectId: string;
  externalCompanyId: string | null;
  createdByUserId: string | null;
  quotationNumber: number;
  status: string;
  currency: string;
  lines: unknown;
  transport: Dec;
  otherCharges: Dec;
  discount: Dec;
  discountType: string;
  discountAppliedAt: Date | null;
  taxPercent: Dec;
  subtotal: Dec;
  grandTotal: Dec;
  pricedAt: Date;
  quantitiesAt: Date;
  validUntil: Date;
  createdAt: Date;
  updatedAt: Date;
}

export function rowLines(row: Pick<QuotationRow, "lines">): QuotationLine[] {
  return Array.isArray(row.lines) ? (row.lines as QuotationLine[]) : [];
}

function cents(v: Dec): number {
  const c = decimalToCents(v);
  if (c === null) throw new RangeError(`Invalid stored amount ${v.toString()}`);
  return c;
}

/** The totals of a stored row (cents). */
export function rowTotals(row: Pick<QuotationRow, "lines" | "transport" | "otherCharges" | "discount" | "discountType" | "taxPercent">): Totals {
  return computeTotals({
    lines: rowLines(row),
    transport: cents(row.transport),
    otherCharges: cents(row.otherCharges),
    discountType: row.discountType as DiscountType,
    discount: cents(row.discount),
    taxHundredths: cents(row.taxPercent),
  });
}

export interface ViewContext {
  projectCurrency: string;
  /** `ProjectCalculation.computedAt`, or null when the project has no calculation. */
  calcComputedAt: Date | null;
  now: Date;
  /** Who created the quotation: `User.name`, else the username; null when that user no longer exists (M-1). */
  createdByName?: string | null;
  /**
   * Staff only (Q-D34): when false, each line omits `defaultPrice`, `minPrice` and `allowAbove`, so an external user
   * never receives the org's price floor. `anyLineEdited` stays (the Reset button state).
   */
  showRange: boolean;
}

/** A line as the API returns it: the range fields are present for staff only. */
export type QuotationLineView = Omit<QuotationLine, "defaultPrice" | "minPrice" | "allowAbove"> &
  Partial<Pick<QuotationLine, "defaultPrice" | "minPrice" | "allowAbove">>;

function lineView(line: QuotationLine, showRange: boolean): QuotationLineView {
  if (showRange) return line;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaultPrice, minPrice, allowAbove, ...rest } = line;
  return rest;
}

export interface QuotationView {
  id: string;
  projectId: string;
  quotationNumber: number;
  number: string;
  status: QuotationStatus;
  currency: string;
  projectCurrency: string;
  currencyDiffers: boolean;
  lines: QuotationLineView[];
  transport: string;
  otherCharges: string;
  discountType: DiscountType;
  discount: string;
  taxPercent: string;
  totals: Record<keyof Totals, string>;
  anyLineEdited: boolean;
  designChanged: boolean;
  /** The quoting user's full name (M-1: "Prepared by"); null when the user was removed. */
  createdByName: string | null;
  pricedAt: Date;
  quantitiesAt: Date;
  validUntil: Date;
  discountAppliedAt: Date | null;
  createdAt: Date;
}

export function serializeQuotation(row: QuotationRow, ctx: ViewContext): QuotationView {
  const lines = rowLines(row);
  const t = rowTotals(row);
  return {
    id: row.id,
    projectId: row.projectId,
    quotationNumber: row.quotationNumber,
    number: formatQuotationNumber(row.quotationNumber, row.createdAt),
    status: deriveStatus(row.status, row.validUntil, ctx.now),
    currency: row.currency,
    projectCurrency: ctx.projectCurrency,
    currencyDiffers: row.currency !== ctx.projectCurrency,
    lines: lines.map((l) => lineView(l, ctx.showRange)),
    transport: toFixed2(row.transport),
    otherCharges: toFixed2(row.otherCharges),
    discountType: row.discountType as DiscountType,
    discount: toFixed2(row.discount),
    taxPercent: toFixed2(row.taxPercent),
    totals: {
      linesTotal: centsToFixed(t.linesTotal),
      subtotal: centsToFixed(t.subtotal),
      discountAmount: centsToFixed(t.discountAmount),
      discountedAmount: centsToFixed(t.discountedAmount),
      taxAmount: centsToFixed(t.taxAmount),
      grandTotal: centsToFixed(t.grandTotal),
    },
    anyLineEdited: anyLineEdited(lines),
    designChanged: isDesignChanged(ctx.calcComputedAt, row.quantitiesAt),
    createdByName: ctx.createdByName ?? null,
    pricedAt: row.pricedAt,
    quantitiesAt: row.quantitiesAt,
    validUntil: row.validUntil,
    discountAppliedAt: row.discountAppliedAt,
    createdAt: row.createdAt,
  };
}
