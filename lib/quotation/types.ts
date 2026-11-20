/**
 * Quotation types (Stage 38, S38-4). PURE: no Prisma, no lib/data imports.
 * Money inside `QuotationLine` is a 2 dp decimal string (Q-D5); the math runs on integer cents (lib/money.ts).
 */

/** One stored quotation line: a frozen copy of the price range (Q-D13), edits are checked against it. */
export interface QuotationLine {
  code: string;
  name: string;
  /** ComponentType.code(s) whose formula produced the line (material list `slot`). */
  slot: string | string[];
  unit: string;
  /** Pack size of the item (material list `perUnitQuantity`), frozen with the line (the PDF prints it). */
  perUnitQuantity: number;
  /** The material-list quantity as is (Q-D16). */
  quantity: number;
  /** Max price at the time the line was priced (2 dp). */
  defaultPrice: string;
  /** Lowest allowed unit price (2 dp). */
  minPrice: string;
  /** "No upper limit": the unit price may go above defaultPrice. */
  allowAbove: boolean;
  /** Current unit price (2 dp); "edited" is `unitPrice !== defaultPrice`, derived. */
  unitPrice: string;
  /** quantity x unitPrice, half-up to 2 dp. */
  amount: string;
}

/** The Inventory price row for one code in one currency, in integer cents. */
export interface PriceInfo {
  price: number;
  minPrice: number;
  allowAbove: boolean;
}

/** The material-list fields a quotation line is built from. */
export interface MaterialLineInput {
  code: string;
  name: string;
  slot: string | string[];
  unit: string;
  perUnitQuantity: number;
  quantity: number;
}

export type DiscountType = "PERCENT" | "FIXED";

export type QuotationStatus = "DRAFT" | "EXPIRED" | "ORDERED";
