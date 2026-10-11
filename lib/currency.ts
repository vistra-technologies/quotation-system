/**
 * The currencies the product supports (Stage 31, S31-11). The single literal list of the three codes in
 * `app/**` and `lib/**` — the API routes, forms and external-company copies all derive from this.
 */
export const SUPPORTED_CURRENCIES = ["INR", "AED", "USD"] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/** Exact (already upper-cased) match; callers upper-case/trim the raw input first. */
export function isSupportedCurrency(value: unknown): value is SupportedCurrency {
  return typeof value === "string" && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

/** The 400 message for an unsupported currency, built from the constant so it can't drift. */
export const CURRENCY_ERROR_MESSAGE = `currency must be one of ${SUPPORTED_CURRENCIES.join(", ")}`;

/** External-company wording kept byte-identical to before: `defaultCurrency must be "INR", "AED", or "USD"`. */
export const DEFAULT_CURRENCY_ERROR_MESSAGE = (() => {
  const quoted = SUPPORTED_CURRENCIES.map((c) => `"${c}"`);
  return `defaultCurrency must be ${quoted.slice(0, -1).join(", ")}, or ${quoted[quoted.length - 1]}`;
})();
