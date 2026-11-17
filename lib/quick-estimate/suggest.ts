import type { SupportedCurrency } from "@/lib/currency";
import { combinationKey } from "@/lib/product-pricing/combination";
import type { PriceEntry } from "@/lib/product-pricing/price-entries";
import { convertAreaQtyString, isAreaUnit, type AreaUnit } from "./area-units";
import { UNIT_AREA, UNIT_SQFT, parseUnitPrice, type EstimateUnit, type SuggestedUnit } from "./estimate";
import type { DraftLine, EstimateDraft } from "./lines";
import type { EstimateOption, EstimateType } from "./palette";

/**
 * Stage 36 (S36-9..S36-12, S36-18): the pure suggest/reset logic of Quick Estimate. Exact (currency, unit) match
 * only: there is no rate conversion anywhere and never a cross-currency lookup (PP-27). Client-safe, no I/O.
 */

/** One product price row as the layout trims it for the client. */
export interface LookupEntry {
  prices: PriceEntry[];
  description: string | null;
}

/** `componentTypeId` then `combinationKey` (the id, not the SuperAdmin-renamable code, S36-10). */
export type PricingLookup = Record<string, Record<string, LookupEntry>>;

/** The row shape of `GET .../product-pricing` this module reads. */
export interface PricingRowInput {
  componentTypeId: string;
  combinationKey: string;
  prices: PriceEntry[];
  description: string | null;
}

/** Only spec-mode usable types get a map (lookup applies in spec mode only, S36-9); rows of other types are dropped. */
export function buildPricingLookup(rows: readonly PricingRowInput[], types: readonly EstimateType[]): PricingLookup {
  const specIds = new Set(types.filter((t) => t.mode === "spec").map((t) => t.id));
  const out: PricingLookup = {};
  for (const r of rows) {
    if (!specIds.has(r.componentTypeId)) continue;
    (out[r.componentTypeId] ??= {})[r.combinationKey] = { prices: r.prices, description: r.description };
  }
  return out;
}

/** The unit a price is stored in for a line's quantity unit. */
export function priceUnitFor(unit: EstimateUnit): SuggestedUnit {
  return unit === UNIT_AREA ? "m2" : unit === UNIT_SQFT ? "sqft" : "pcs";
}

export interface Suggestion {
  combinationKey: string | null;
  suggestedUnitPrice: number | null;
  suggestedUnit: SuggestedUnit | null;
  description: string | null;
}

const NONE: Suggestion = { combinationKey: null, suggestedUnitPrice: null, suggestedUnit: null, description: null };

/** The exact entry for (currency, unit) in a row, or null. */
export function exactPrice(entry: LookupEntry | undefined, currency: SupportedCurrency, unit: SuggestedUnit): number | null {
  const hit = entry?.prices.find((p) => p.currency === currency && p.unit === unit);
  return hit ? hit.amount : null;
}

/**
 * The suggestion for a picked option. Fallback-mode types (and an option with no values) get none: no key, no
 * price, no description. In spec mode the key is always set, the price only on an exact (currency, unit) match.
 */
export function suggestFor(
  lookup: PricingLookup,
  type: EstimateType,
  option: EstimateOption,
  currency: SupportedCurrency,
  unit: SuggestedUnit,
): Suggestion {
  if (type.mode !== "spec") return NONE;
  const key = combinationKey(option.values);
  const entry = lookup[type.id]?.[key];
  const price = exactPrice(entry, currency, unit);
  return {
    combinationKey: key,
    suggestedUnitPrice: price,
    suggestedUnit: price === null ? null : unit,
    description: entry?.description && entry.description.trim() !== "" ? entry.description : null,
  };
}

const rateString = (n: number) => String(n);

/** S36-11: the rate differs from the suggestion (a suggestion exists). Drives the inline Reset. */
export function showReset(l: Pick<DraftLine, "rate" | "suggestedUnitPrice">): boolean {
  return l.suggestedUnitPrice !== null && parseUnitPrice(l.rate) !== l.suggestedUnitPrice;
}

/**
 * Pick an item on a line. Re-picking the same item changes nothing beyond the item text (it must not clobber
 * an edited rate or description). A new item:
 * - spec mode, exact price: rate = the price, suggestion stored;
 * - spec mode, no price: the rate is cleared only when it was an untouched suggestion of the previous item (a
 *   price must not follow the line to another product); a typed rate stays;
 * - fallback mode: the rate is untouched (Stage 33 behaviour), no suggestion.
 * The description follows the matched row (checked when non-blank, else unchecked and empty).
 */
export function applyChoice(
  line: DraftLine,
  type: EstimateType,
  option: EstimateOption,
  lookup: PricingLookup,
  currency: SupportedCurrency,
  /** The estimate's current area unit: an area type's line takes it (S36-13). */
  areaUnit: AreaUnit,
): DraftLine {
  const unit: EstimateUnit = isAreaUnit(type.unit) ? areaUnit : type.unit;
  // Another kind of unit (area vs pcs) makes the old quantity meaningless; a line still in the other area unit
  // (a mixed stored estimate) has its quantity converted, so "2 m2" never silently becomes "2 sq ft".
  const qty =
    line.unit === null || line.unit === unit
      ? line.qty
      : isAreaUnit(line.unit) && isAreaUnit(unit)
        ? convertAreaQtyString(line.qty, line.unit, unit)
        : "";
  const base: DraftLine = {
    ...line,
    typeCode: type.code,
    itemName: type.name,
    variantText: option.text,
    unit,
    qty,
  };
  const sameItem = line.typeCode === type.code && line.variantText === option.text;
  if (sameItem) return base;

  const s = suggestFor(lookup, type, option, currency, priceUnitFor(unit));
  const wasUntouchedSuggestion = line.suggestedUnitPrice !== null && !showReset(line);
  let rate = base.rate;
  if (s.suggestedUnitPrice !== null) rate = rateString(s.suggestedUnitPrice);
  else if (wasUntouchedSuggestion) rate = "";
  return {
    ...base,
    rate,
    flag: false,
    suggestedUnitPrice: s.suggestedUnitPrice,
    suggestedUnit: s.suggestedUnit,
    combinationKey: s.combinationKey,
    description: s.description ?? "",
    descriptionEdited: false,
    attachDescription: s.description !== null,
  };
}

/** Restore the suggestion (the inline Reset). A no-op without one. */
export function resetRate(line: DraftLine): DraftLine {
  if (line.suggestedUnitPrice === null) return line;
  return { ...line, rate: rateString(line.suggestedUnitPrice), flag: false };
}

/** What a currency switch may overwrite on a line, kept so Undo can put it back. */
export interface PricingSnapshot {
  rate: string;
  suggestedUnitPrice: number | null;
  suggestedUnit: SuggestedUnit | null;
  /** The line's identity when saved: Undo restores only onto the same item and variant. */
  combinationKey: string | null;
  variantText: string;
}

export function snapshotPricing(lines: readonly DraftLine[]): Record<string, PricingSnapshot> {
  return Object.fromEntries(
    lines.map((l) => [l.id, { rate: l.rate, suggestedUnitPrice: l.suggestedUnitPrice, suggestedUnit: l.suggestedUnit, combinationKey: l.combinationKey, variantText: l.variantText }]),
  );
}

/** Undo: restore the saved rate and suggestion only if the line still holds the same combination and variant. */
export function restorePricing(line: DraftLine, saved: PricingSnapshot | undefined): DraftLine {
  if (!saved || saved.combinationKey !== line.combinationKey || saved.variantText !== line.variantText) {
    return { ...line, flag: false };
  }
  return { ...line, rate: saved.rate, suggestedUnitPrice: saved.suggestedUnitPrice, suggestedUnit: saved.suggestedUnit, flag: false };
}

/**
 * S36-11 currency switch for one line. A line with a `combinationKey` re-looks up in the new currency: found, the
 * new rate and suggestion (even over an override); not found, the rate is cleared and the suggestion dropped, and
 * the line is flagged when it had a rate (D-7). A line with no key keeps today's D-7 behaviour: rate kept, flagged
 * when it has one. The description is never touched.
 */
export function relookupForCurrency(
  line: DraftLine,
  types: readonly EstimateType[],
  lookup: PricingLookup,
  next: SupportedCurrency,
): DraftLine {
  if (line.combinationKey === null || line.unit === null) {
    return { ...line, flag: parseUnitPrice(line.rate) > 0 };
  }
  const type = types.find((t) => t.code === line.typeCode);
  const entry = type ? lookup[type.id]?.[line.combinationKey] : undefined;
  const unit = priceUnitFor(line.unit);
  const price = exactPrice(entry, next, unit);
  if (price !== null) {
    return { ...line, rate: rateString(price), suggestedUnitPrice: price, suggestedUnit: unit, flag: false };
  }
  return { ...line, rate: "", suggestedUnitPrice: null, suggestedUnit: null, flag: parseUnitPrice(line.rate) > 0 };
}

export interface AreaUnitSwitch {
  draft: EstimateDraft;
  /** S36-18: true when a non-blank rate that differed from its suggestion (null counts as different) was replaced. */
  replaced: boolean;
}

/**
 * S36-13 / S36-18: switch the estimate's area unit. Only lines with an area unit change (pcs lines are untouched).
 * Quantity is converted once from the stored value (area-units.ts, the only conversion). The rate is never
 * converted: it becomes the exact product price for (current currency, new unit) when the line has a combination key
 * and that entry exists, else it is empty with no suggestion, so Reset is hidden after every switch. A typed,
 * overridden or fallback-mode rate is replaced, never carried across units. Currency is not touched.
 */
export function switchAreaUnit(
  draft: EstimateDraft,
  next: AreaUnit,
  types: readonly EstimateType[],
  lookup: PricingLookup,
): AreaUnitSwitch {
  if (draft.areaUnit === next) return { draft, replaced: false };
  let replaced = false;
  const lines = draft.lines.map((l) => {
    if (l.unit === null || !isAreaUnit(l.unit)) return l;
    const typed = l.rate.trim() !== "" && (l.suggestedUnitPrice === null || parseUnitPrice(l.rate) !== l.suggestedUnitPrice);
    if (typed) replaced = true;
    const type = types.find((t) => t.code === l.typeCode);
    const entry = type && l.combinationKey !== null ? lookup[type.id]?.[l.combinationKey] : undefined;
    const price = exactPrice(entry, draft.currency, priceUnitFor(next));
    return {
      ...l,
      unit: next,
      qty: convertAreaQtyString(l.qty, l.unit, next),
      rate: price === null ? "" : rateString(price),
      suggestedUnitPrice: price,
      suggestedUnit: price === null ? null : priceUnitFor(next),
      flag: false,
    };
  });
  return { draft: { ...draft, areaUnit: next, lines }, replaced };
}
