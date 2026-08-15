/**
 * Currency display formatting helpers.
 *
 * Decision 6: INR uses Indian lakh/crore grouping (en-IN locale);
 * AED and USD both use Western thousands grouping (en-US locale).
 *
 * Decision 7: budget formatting fires on blur, not live as-you-type
 * (caret management across keystroke/paste/backspace was judged the
 * riskiest item in Stage 15 — on-blur is the correct call here).
 *
 * Used by:
 *   - Inquiry detail page (V5) — display-only
 *   - Batch F — budget input on-blur formatter (C5/PC1-C5)
 */

/**
 * Strip grouping separators (commas) from a formatted number string so the
 * underlying numeric string can be stored / parsed.
 *
 * Exported for Batch F's on-blur input formatter, which needs to round-trip:
 *   user-typed string → stripGroupingSeparators → parseFloat → formatBudget
 */
export function stripGroupingSeparators(value: string): string {
  return value.replace(/,/g, "");
}

/**
 * Format a raw budget value (stored as a plain numeric string, e.g. "1000000")
 * for display using the correct locale grouping for the given currency.
 *
 * @param raw      - The raw value from the database (e.g. "1000000", null, or "").
 * @param currency - The currency code (e.g. "INR", "AED", "USD"). Case-insensitive.
 * @returns        A formatted string (e.g. "10,00,000" for INR, "1,000,000" for USD/AED),
 *                 or "—" if the input is null, empty, or non-numeric.
 */
export function formatBudget(
  raw: string | null | undefined,
  currency: string | null | undefined,
): string {
  if (raw == null || raw.trim() === "") return "—";

  const num = parseFloat(stripGroupingSeparators(raw.trim()));
  if (!isFinite(num)) return "—";

  const locale = currency?.toUpperCase() === "INR" ? "en-IN" : "en-US";

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(num);
}
