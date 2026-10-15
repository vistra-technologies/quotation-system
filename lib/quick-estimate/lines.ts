import type { SupportedCurrency } from "@/lib/currency";
import { parseQty, parseUnitPrice, type DiscountMode, type EstimateUnit, type ValueLine } from "./estimate";

/**
 * The client-side draft (Stage 33): what the popup edits. Inputs are strings (blank means 0). A line that
 * has an item keeps its type code, so a restore can drop lines whose type is no longer usable (S33-8); the
 * code is NOT part of the value snapshot (`toValueLines` drops it).
 */
export interface DraftLine {
  id: string;
  typeCode: string | null;
  itemName: string;
  variantText: string;
  unit: EstimateUnit | null;
  qty: string;
  rate: string;
  /** Currency-change flag (D-7): the rate needs re-checking. UI state, never persisted. */
  flag: boolean;
}

export interface EstimateDraft {
  currency: SupportedCurrency;
  discountMode: DiscountMode;
  /** String input; blank means 0. */
  discountValue: string;
  taxPct: string;
  lines: DraftLine[];
}

export function newLine(id: string): DraftLine {
  return { id, typeCode: null, itemName: "", variantText: "", unit: null, qty: "", rate: "", flag: false };
}

export function emptyDraft(currency: SupportedCurrency): EstimateDraft {
  return { currency, discountMode: "pct", discountValue: "", taxPct: "", lines: [] };
}

/** S33-6: a line counts only once its component is chosen. Lines with no item are dropped. */
export function toValueLines(lines: DraftLine[]): ValueLine[] {
  const out: ValueLine[] = [];
  for (const l of lines) {
    if (l.typeCode === null || l.unit === null) continue;
    out.push({
      itemName: l.itemName,
      variantText: l.variantText,
      unit: l.unit,
      qty: parseQty(l.qty, l.unit),
      unitPrice: parseUnitPrice(l.rate),
    });
  }
  return out;
}

/** The draft dot: at least one line has an item. */
export function hasDraftItems(lines: DraftLine[]): boolean {
  return lines.some((l) => l.typeCode !== null);
}
