import type { SupportedCurrency } from "@/lib/currency";

/**
 * Quick Estimate number formatting (S33-9): Intl with 2 decimals; locale en-IN for INR, en-US otherwise.
 * The currency is always its code ("INR 1,82,750.00"), never a symbol.
 */
const localeFor = (currency: SupportedCurrency) => (currency === "INR" ? "en-IN" : "en-US");

export function formatAmount(n: number, currency: SupportedCurrency): string {
  return new Intl.NumberFormat(localeFor(currency), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export function formatMoney(n: number, currency: SupportedCurrency): string {
  return `${currency} ${formatAmount(n, currency)}`;
}

/** Quantities and percentages: up to 2 decimals, no trailing zeros. */
export function formatQty(n: number, currency: SupportedCurrency): string {
  return new Intl.NumberFormat(localeFor(currency), { maximumFractionDigits: 2 }).format(n);
}
