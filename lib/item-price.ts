import { CURRENCY_ERROR_MESSAGE, isSupportedCurrency, type SupportedCurrency } from "@/lib/currency";
import { centsToFixed, parseMoneyToCents, toFixed2 } from "@/lib/money";

/** One validated price row, as 2 dp strings ready for the DB (Decimal) and the response. */
export type ItemPriceRow = {
  currency: SupportedCurrency;
  price: string;
  minPrice: string;
  allowAbove: boolean;
};

export type ItemPricesResult = { ok: true; rows: ItemPriceRow[] } | { ok: false; error: string };

/**
 * Validate the body of `PUT .../inventory/[itemId]/prices`: a full replacement list
 * `[{ currency, price, minPrice, allowAbove }]`. The empty list is valid (clears all prices).
 * One validator for the route and the unit tests (Stage 38, S38-3).
 */
export function validateItemPrices(body: unknown): ItemPricesResult {
  const list = Array.isArray(body) ? body : (body as { prices?: unknown } | null)?.prices;
  if (!Array.isArray(list)) return { ok: false, error: "prices must be an array" };

  const seen = new Set<string>();
  const rows: ItemPriceRow[] = [];
  for (const [i, raw] of list.entries()) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, error: `prices[${i}] must be an object` };
    }
    const r = raw as Record<string, unknown>;
    const currency = typeof r.currency === "string" ? r.currency.trim().toUpperCase() : r.currency;
    if (!isSupportedCurrency(currency)) return { ok: false, error: CURRENCY_ERROR_MESSAGE };
    if (seen.has(currency)) return { ok: false, error: `Duplicate currency ${currency}` };
    seen.add(currency);

    const price = parseMoneyToCents(r.price);
    if (price === null) return { ok: false, error: `${currency} price must be a non-negative amount with at most 2 decimals` };
    const minPrice = parseMoneyToCents(r.minPrice);
    if (minPrice === null) return { ok: false, error: `${currency} minPrice must be a non-negative amount with at most 2 decimals` };
    if (minPrice > price) return { ok: false, error: `${currency} minPrice must not exceed price` };
    if (typeof r.allowAbove !== "boolean") return { ok: false, error: `${currency} allowAbove must be a boolean` };

    rows.push({ currency, price: centsToFixed(price), minPrice: centsToFixed(minPrice), allowAbove: r.allowAbove });
  }
  return { ok: true, rows };
}

type StoredPrice = {
  id?: string;
  currency: string;
  price: { toString(): string };
  minPrice: { toString(): string };
  allowAbove: boolean;
};

/** A stored ItemPrice row to its API shape: money as 2 dp strings. Other columns pass through. */
export function serializeItemPrice<T extends StoredPrice>(row: T) {
  return { ...row, price: toFixed2(row.price), minPrice: toFixed2(row.minPrice) };
}

/** Map `prices` (when present) of an inventory item through serializeItemPrice. */
export function serializeItemWithPrices<T extends { prices?: StoredPrice[] }>(item: T) {
  if (!item.prices) return item;
  return { ...item, prices: item.prices.map(serializeItemPrice) };
}
