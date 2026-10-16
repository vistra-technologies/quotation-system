import type { SupportedCurrency } from "@/lib/currency";
import { clampPct, parseQty, parseUnitPrice, round2, type DiscountMode, type ValueLine } from "./estimate";
import type { ParsedQuickEstimate } from "./inquiry-estimate";
import type { DraftLine, EstimateDraft } from "./lines";
import type { EstimateType } from "./palette";

/**
 * Pure bridges between the popup draft and the estimate stored on an Inquiry (Stage 33 Batch 5, S33-19..S33-23).
 * No prisma/next imports. The stored value is a pure value snapshot; these helpers never invent a catalog link.
 */

/** The attach payload: the estimate without `currency` (the server always stamps the inquiry's, D-26). */
export type EstimateInput = Omit<ParsedQuickEstimate, "currency">;

/** An estimate as the form holds it before Create: the payload plus the currency the rates were typed in. */
export interface AttachedEstimate {
  currency: SupportedCurrency;
  input: EstimateInput;
}

/** The shape read back from an inquiry (a subset of InquiryQuickEstimateV1). */
export interface StoredEstimate {
  currency: string;
  discountMode: DiscountMode;
  discountValue: number;
  taxPct: number;
  lines: ValueLine[];
}

/** A line is attached only when it is priced: an item, qty > 0 and rate > 0 (D-26, the standalone export rule). */
export function isPricedLine(l: DraftLine): boolean {
  return l.typeCode !== null && l.unit !== null && parseQty(l.qty, l.unit) > 0 && parseUnitPrice(l.rate) > 0;
}

export function pricedDraftLines(draft: EstimateDraft): DraftLine[] {
  return draft.lines.filter(isPricedLine);
}

/**
 * The attach / update payload. Only priced lines; discount and tax are normalised to the server's bounds
 * (pct 0..100, a fixed amount rounded to 2 dp, tax 0..100) so a clamped popup value can never 400. Never
 * carries `currency`.
 */
export function draftToInput(draft: EstimateDraft): EstimateInput {
  const raw = parseFloat(draft.discountValue);
  const positive = Number.isFinite(raw) && raw > 0 ? raw : 0;
  const discountValue = draft.discountMode === "pct" ? clampPct(positive) : round2(positive);
  const lines: ValueLine[] = [];
  for (const l of pricedDraftLines(draft)) {
    if (l.unit === null) continue;
    lines.push({
      itemName: l.itemName,
      variantText: l.variantText,
      unit: l.unit,
      qty: parseQty(l.qty, l.unit),
      unitPrice: parseUnitPrice(l.rate),
    });
  }
  return { discountMode: draft.discountMode, discountValue, taxPct: clampPct(parseFloat(draft.taxPct)), lines };
}

/** What a re-PATCH (Edit save, Undo) sends for an existing estimate: its values, no `currency`, no stamp. */
export function storedToInput(stored: StoredEstimate): EstimateInput {
  return {
    discountMode: stored.discountMode,
    discountValue: stored.discountValue,
    taxPct: stored.taxPct,
    lines: stored.lines.map((l) => ({
      itemName: l.itemName,
      variantText: l.variantText,
      unit: l.unit,
      qty: l.qty,
      unitPrice: l.unitPrice,
    })),
  };
}

const numStr = (n: number) => (n === 0 ? "" : String(n));

/**
 * Seed the popup from a value snapshot. A stored line has no type code, so it is matched to the current
 * palette by item name + unit for display only (the chip); no match leaves `typeCode` "" (a generic line
 * that still edits and exports). The popup is locked to `lockCurrency` (D-28): when the stored currency
 * differs the rates are kept as typed and every priced rate is flagged, exactly like a currency change.
 */
export function storedToDraft(
  stored: StoredEstimate,
  types: EstimateType[],
  lockCurrency: SupportedCurrency,
  nextId: () => string,
): EstimateDraft {
  const drifted = stored.currency !== lockCurrency;
  return {
    currency: lockCurrency,
    discountMode: stored.discountMode,
    discountValue: numStr(stored.discountValue),
    taxPct: numStr(stored.taxPct),
    lines: stored.lines.map((l) => ({
      id: nextId(),
      typeCode: types.find((t) => t.name === l.itemName && t.unit === l.unit)?.code ?? "",
      itemName: l.itemName,
      variantText: l.variantText,
      unit: l.unit,
      qty: String(l.qty),
      rate: String(l.unitPrice),
      flag: drifted && l.unitPrice > 0,
    })),
  };
}

/** Whether the popup state differs from what it was opened with (the discard confirm, S33-23). */
export function sameDraft(a: EstimateDraft, b: EstimateDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The estimate as the form holds it, from the popup snapshot. */
export function draftToAttached(draft: EstimateDraft): AttachedEstimate {
  return { currency: draft.currency, input: draftToInput(draft) };
}
