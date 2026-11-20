/**
 * Building and re-pricing quotation lines (Stage 38 Q-D6, Q-D15, S38-4). PURE.
 * Every function returns either the new lines or the list of unpriced items (Q-D6: a missing price blocks).
 */
import { centsToFixed, decimalToCents, lineAmountCents, quantityToMilli } from "@/lib/money";
import { findMissingPrices, type MissingPrice } from "@/lib/missing-prices";
import type { MaterialLineInput, PriceInfo, QuotationLine } from "./types";

export type LinesResult = { ok: true; lines: QuotationLine[] } | { ok: false; missing: MissingPrice[] };

/** quantity x unit price in cents (half-up). Throws on a quantity that cannot be a number of units. */
function amountCents(quantity: number, unitCents: number): number {
  const milli = quantityToMilli(quantity);
  if (milli === null) throw new RangeError(`Invalid quantity ${quantity}`);
  return lineAmountCents(milli, unitCents);
}

/** A stored 2 dp string to cents (throws on a corrupt value: lines are written by this module only). */
export function lineCents(value: string): number {
  const c = decimalToCents(value);
  if (c === null) throw new RangeError(`Invalid stored amount ${value}`);
  return c;
}

function withPrice(
  src: MaterialLineInput,
  defaultCents: number,
  minCents: number,
  allowAbove: boolean,
  unitCents: number,
): QuotationLine {
  return {
    code: src.code,
    name: src.name,
    slot: src.slot,
    unit: src.unit,
    quantity: src.quantity,
    defaultPrice: centsToFixed(defaultCents),
    minPrice: centsToFixed(minCents),
    allowAbove,
    unitPrice: centsToFixed(unitCents),
    amount: centsToFixed(amountCents(src.quantity, unitCents)),
  };
}

/** A line at the Inventory price: unit price = max = default (Q-D13). */
function atCurrentPrice(src: MaterialLineInput, p: PriceInfo): QuotationLine {
  return withPrice(src, p.price, p.minPrice, p.allowAbove, p.price);
}

/** Items of `items` with no entry in `prices`. */
function missingOf(
  items: ReadonlyArray<{ code: string; name: string }>,
  prices: ReadonlyMap<string, PriceInfo>,
): MissingPrice[] {
  return findMissingPrices(items, new Set(prices.keys()));
}

/** Create (Q-D6): every material-list line priced at the current Inventory max. */
export function buildLines(list: ReadonlyArray<MaterialLineInput>, prices: ReadonlyMap<string, PriceInfo>): LinesResult {
  const missing = missingOf(list, prices);
  if (missing.length) return { ok: false, missing };
  return { ok: true, lines: list.map((l) => atCurrentPrice(l, prices.get(l.code)!)) };
}

/**
 * Refresh (Q-D10, Q-D15): quantities (and name, slot, unit) rebuilt from the list. Same currency: an existing code
 * keeps its stored price and range (edits survive), a new code takes the current Inventory values, a dropped code
 * drops. Currency changed: every line takes the current Inventory values (edited prices are replaced).
 */
export function refreshLines(
  list: ReadonlyArray<MaterialLineInput>,
  existing: ReadonlyArray<QuotationLine>,
  prices: ReadonlyMap<string, PriceInfo>,
  currencyChanged: boolean,
): LinesResult {
  const kept = new Map<string, QuotationLine>();
  if (!currencyChanged) for (const l of existing) if (!kept.has(l.code)) kept.set(l.code, l);
  const needing = list.filter((l) => !kept.has(l.code));
  const missing = missingOf(needing, prices);
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    lines: list.map((l) => {
      const k = kept.get(l.code);
      return k
        ? withPrice(l, lineCents(k.defaultPrice), lineCents(k.minPrice), k.allowAbove, lineCents(k.unitPrice))
        : atCurrentPrice(l, prices.get(l.code)!);
    }),
  };
}

/** Reset all prices (Q-D15): the STORED quantities re-priced at the current Inventory values; edits discarded. */
export function repriceLines(existing: ReadonlyArray<QuotationLine>, prices: ReadonlyMap<string, PriceInfo>): LinesResult {
  const missing = missingOf(existing, prices);
  if (missing.length) return { ok: false, missing };
  return { ok: true, lines: existing.map((l) => atCurrentPrice(l, prices.get(l.code)!)) };
}

/** "edited" = the unit price differs from the stored default (Q-D13), derived. */
export function isLineEdited(line: Pick<QuotationLine, "unitPrice" | "defaultPrice">): boolean {
  return lineCents(line.unitPrice) !== lineCents(line.defaultPrice);
}

export function anyLineEdited(lines: ReadonlyArray<Pick<QuotationLine, "unitPrice" | "defaultPrice">>): boolean {
  return lines.some(isLineEdited);
}
