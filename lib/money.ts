/**
 * Money as integer minor units (cents), Stage 38 (decision 2026-11-20: no decimal.js, no float math).
 * Pure and Prisma-free. All amounts are non-negative with at most 2 decimal places.
 */

/** Upper bound (in cents) so the value stays a safe integer and fits the DB Decimal comfortably. */
export const MAX_CENTS = 9_999_999_999_999; // 99,999,999,999.99

const MONEY_RE = /^\d+(\.\d{1,2})?$/;

/**
 * Parse a JSON number or numeric string into integer cents. Returns null for anything else:
 * negative, more than 2 dp, exponent form, non-numeric, blank, or above MAX_CENTS.
 */
export function parseMoneyToCents(input: unknown): number | null {
  let text: string;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    // Number#toString yields exponent form for very large/small values: those are rejected by the regex.
    text = String(input);
  } else if (typeof input === "string") {
    text = input.trim();
  } else {
    return null;
  }
  if (!MONEY_RE.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  return cents;
}

/** Integer cents to a fixed 2 dp string, e.g. 280000 to "2800.00". */
export function centsToFixed(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const frac = String(cents % 100).padStart(2, "0");
  return `${whole}.${frac}`;
}

/**
 * A stored decimal (Prisma Decimal, string or number) to integer cents, no float math: the decimal string is
 * split on ".", padded to 2 dp, and a 3rd-or-later digit rounds half-up on its first digit. Null for negatives,
 * exponent form, junk, or above MAX_CENTS.
 */
export function decimalToCents(value: { toString(): string } | string | number): number | null {
  const text = value.toString().trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return null;
  const frac = m[2] ?? "";
  let cents = Number(m[1]) * 100 + Number(frac.slice(0, 2).padEnd(2, "0"));
  if (frac.length > 2 && frac.charCodeAt(2) >= 53) cents += 1; // 53 = "5": half-up on the 3rd digit
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  return cents;
}

/** A stored decimal as a 2 dp string; falls back to the raw string when not representable. */
export function toFixed2(value: { toString(): string }): string {
  const cents = decimalToCents(value);
  return cents === null ? value.toString() : centsToFixed(cents);
}
