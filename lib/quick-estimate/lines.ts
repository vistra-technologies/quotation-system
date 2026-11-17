import type { SupportedCurrency } from "@/lib/currency";
import type { AreaUnit } from "./area-units";
import { UNIT_AREA, parseQty, parseUnitPrice, type DiscountMode, type EstimateUnit, type SuggestedUnit, type ValueLine } from "./estimate";

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
  /** Stage 36 S36-11: the product price found for this line's (currency, unit), or null. Drives the inline Reset. */
  suggestedUnitPrice: number | null;
  suggestedUnit: SuggestedUnit | null;
  /** Set in spec mode only (the picked combination's key); null for fallback lines and generic stored lines. */
  combinationKey: string | null;
  /** The description text shown in the textarea ("" when none); printed only while `attachDescription`. */
  description: string;
  descriptionEdited: boolean;
  attachDescription: boolean;
}

export interface EstimateDraft {
  currency: SupportedCurrency;
  /**
   * Stage 36 S36-13 (plan F-5): the one area unit of the estimate (the header toggle). A draft-only field: the stored
   * estimate has no such key, each stored line carries its own `unit`, and it is derived again when an inquiry is
   * opened (`storedToDraft`). Every line with an area unit shows this unit.
   */
  areaUnit: AreaUnit;
  discountMode: DiscountMode;
  /** String input; blank means 0. */
  discountValue: string;
  taxPct: string;
  lines: DraftLine[];
}

/** The Stage 36 fields of a line that has no product price or description (every pre-Stage 36 line). */
export const NO_PRICING = {
  suggestedUnitPrice: null,
  suggestedUnit: null,
  combinationKey: null,
  description: "",
  descriptionEdited: false,
  attachDescription: false,
} as const;

export function newLine(id: string): DraftLine {
  return { id, typeCode: null, itemName: "", variantText: "", unit: null, qty: "", rate: "", flag: false, ...NO_PRICING };
}

export function emptyDraft(currency: SupportedCurrency): EstimateDraft {
  return { currency, areaUnit: UNIT_AREA, discountMode: "pct", discountValue: "", taxPct: "", lines: [] };
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
      ...pricingKeysOfDraft(l),
    });
  }
  return out;
}

/** The Stage 36 value-line keys of a draft line (S36-14). A blank description is stored as null. */
export function pricingKeysOfDraft(l: DraftLine): Partial<ValueLine> {
  const d = l.description.trim();
  // A line with none of it (every fallback line) is stored exactly as in Stage 33.
  if (l.suggestedUnitPrice === null && l.combinationKey === null && d === "" && !l.descriptionEdited && !l.attachDescription) {
    return {};
  }
  return {
    suggestedUnitPrice: l.suggestedUnitPrice,
    suggestedUnit: l.suggestedUnit,
    combinationKey: l.combinationKey,
    description: d === "" ? null : d,
    descriptionEdited: l.descriptionEdited,
    attachDescription: l.attachDescription,
  };
}

/** The draft dot: at least one line has an item. */
export function hasDraftItems(lines: DraftLine[]): boolean {
  return lines.some((l) => l.typeCode !== null);
}
