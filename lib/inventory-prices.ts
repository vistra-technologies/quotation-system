/**
 * Stage 38 Batch 2: pure logic behind the Inventory Prices UI (list columns, Priced filter, drawer price rows).
 *
 * No React, no I/O, client-safe. Money is integer cents (`lib/money`), never float math. The rules mirror the server
 * validator `validateItemPrices` (`lib/item-price.ts`): max >= 0, 0 <= min <= max, at most 2 decimals, one row per
 * currency; the unit test pins that the two agree.
 */
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { centsToFixed, parseMoneyToCents } from "@/lib/money";

/** One stored price row as the GET .../inventory API returns it (money as 2 dp strings). */
export interface StoredPrice {
  currency: string;
  price: string;
  minPrice: string;
  allowAbove: boolean;
}

/** One row of the drawer's price editor. `price` is the max (the quotation default). */
export interface PriceDraft {
  currency: string;
  price: string;
  minPrice: string;
  allowAbove: boolean;
  /** A row added in this edit: its currency is still pickable. Not part of the saved value. */
  fresh?: boolean;
}

export type PriceIssue = "maxInvalid" | "minInvalid" | "minAboveMax";

/** The `inventory` message key of each issue (unit-tested to exist: a wrong key renders nothing, silently). */
export const PRICE_ISSUE_MESSAGE_KEY = {
  maxInvalid: "priceMaxInvalid",
  minInvalid: "priceMinInvalid",
  minAboveMax: "priceMinAboveMax",
} as const satisfies Record<PriceIssue, string>;

/** Currencies in display order: the org default first, then the supported list order. */
export function currencyOrder(defaultCurrency?: string): string[] {
  const rest = SUPPORTED_CURRENCIES.filter((c) => c !== defaultCurrency);
  return defaultCurrency && (SUPPORTED_CURRENCIES as readonly string[]).includes(defaultCurrency)
    ? [defaultCurrency, ...rest]
    : [...rest];
}

/** Rows in display order (default currency first). Currencies outside the supported list sort last, as stored. */
export function sortPrices<T extends { currency: string }>(rows: T[], defaultCurrency?: string): T[] {
  const order = currencyOrder(defaultCurrency);
  const rank = (c: string) => {
    const i = order.indexOf(c);
    return i === -1 ? order.length : i;
  };
  return [...rows].sort((a, b) => rank(a.currency) - rank(b.currency));
}

export function draftsFromPrices(prices: StoredPrice[] | undefined, defaultCurrency?: string): PriceDraft[] {
  return sortPrices(prices ?? [], defaultCurrency).map((p) => ({
    currency: p.currency,
    price: p.price,
    minPrice: p.minPrice,
    allowAbove: p.allowAbove,
  }));
}

/** The price row in `currency`, if any. */
export function priceIn(prices: StoredPrice[] | undefined, currency: string): StoredPrice | undefined {
  return (prices ?? []).find((p) => p.currency === currency);
}

/** Q-D24: "priced" means a price in the org default currency. */
export function isPricedIn(prices: StoredPrice[] | undefined, currency: string): boolean {
  return priceIn(prices, currency) !== undefined;
}

/** Currencies not yet used by a row, in display order (what "Add price" can still offer). */
export function freeCurrencies(rows: PriceDraft[], defaultCurrency?: string): string[] {
  const used = new Set(rows.map((r) => r.currency));
  return currencyOrder(defaultCurrency).filter((c) => !used.has(c));
}

function rowsEqual(a: PriceDraft, b: PriceDraft): boolean {
  const cents = (v: string) => parseMoneyToCents(v);
  const same = (x: string, y: string) => (cents(x) !== null && cents(y) !== null ? cents(x) === cents(y) : x.trim() === y.trim());
  return a.currency === b.currency && same(a.price, b.price) && same(a.minPrice, b.minPrice) && a.allowAbove === b.allowAbove;
}

/** True when the rows differ from the saved ones (any value, a row added or removed). Amounts compare as numbers. */
export function isPricesDirty(original: PriceDraft[], draft: PriceDraft[]): boolean {
  if (original.length !== draft.length) return true;
  return draft.some((d, i) => !rowsEqual(original[i], d));
}

/** One issue per row (null = fine): the max first, then the min, then min above max. */
export function priceIssues(rows: PriceDraft[]): Array<PriceIssue | null> {
  return rows.map((r) => {
    const max = parseMoneyToCents(r.price);
    if (max === null) return "maxInvalid";
    const min = parseMoneyToCents(r.minPrice);
    if (min === null) return "minInvalid";
    if (min > max) return "minAboveMax";
    return null;
  });
}

export function pricesValid(rows: PriceDraft[]): boolean {
  return priceIssues(rows).every((i) => i === null);
}

/** The PUT body (full replacement list). Callers validate first; an invalid row is dropped as a last guard. */
export function buildPricesPayload(rows: PriceDraft[]) {
  const out: StoredPrice[] = [];
  for (const r of rows) {
    const max = parseMoneyToCents(r.price);
    const min = parseMoneyToCents(r.minPrice);
    if (max === null || min === null) continue;
    out.push({ currency: r.currency, price: centsToFixed(max), minPrice: centsToFixed(min), allowAbove: r.allowAbove });
  }
  return out;
}

/** Sort key for the list's Max / Min columns in `currency`: unpriced rows sort before every priced one. */
export function priceSortValue(prices: StoredPrice[] | undefined, currency: string, which: "max" | "min"): number {
  const p = priceIn(prices, currency);
  if (!p) return -1;
  const cents = parseMoneyToCents(which === "max" ? p.price : p.minPrice);
  return cents === null ? -1 : cents;
}
