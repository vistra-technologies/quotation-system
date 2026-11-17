/**
 * Stage 36 (S36-8): price-entry rules shared by the PUT route and (Batch 3) the admin drawer. Pure, Prisma-free.
 * A price entry is { currency, unit, amount }: INR/AED/USD; m2 or sqft for an area type, pcs for a piece type.
 */

export const PRICE_CURRENCIES = ["INR", "AED", "USD"] as const;
export type PriceCurrency = (typeof PRICE_CURRENCIES)[number];
export const PRICE_UNITS = ["m2", "sqft", "pcs"] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

export interface PriceEntry {
  currency: PriceCurrency;
  unit: PriceUnit;
  amount: number;
}

export const MAX_PRICE_ENTRIES = 6;
export const MAX_DESCRIPTION_LENGTH = 500;

const CURRENCY_ORDER: Record<string, number> = { INR: 0, AED: 1, USD: 2 };
const UNIT_ORDER: Record<string, number> = { m2: 0, sqft: 1, pcs: 2 };

/** Display order: INR, AED, USD, then m2 before sqft. */
export function sortEntries<T extends { currency: string; unit: string }>(entries: readonly T[]): T[] {
  return [...entries].sort(
    (a, b) =>
      (CURRENCY_ORDER[a.currency] ?? 99) - (CURRENCY_ORDER[b.currency] ?? 99) ||
      (UNIT_ORDER[a.unit] ?? 99) - (UNIT_ORDER[b.unit] ?? 99),
  );
}

/** True when `entries` already holds the (currency, unit) pair (the drawer's duplicate check). */
export function hasPair(entries: readonly { currency: string; unit: string }[], currency: string, unit: string): boolean {
  return entries.some((e) => e.currency === currency && e.unit === unit);
}

function hasAtMost2Decimals(n: number): boolean {
  return Math.abs(Math.round(n * 100) - n * 100) < 1e-6;
}

export type PriceEntriesResult = { ok: true; entries: PriceEntry[] } | { ok: false; error: string };

/**
 * `isArea`: the type's unit family (area types take m2/sqft, piece types pcs). Does not silently merge
 * duplicates: a repeated (currency, unit) pair is an error.
 */
export function validatePriceEntries(raw: unknown, isArea: boolean): PriceEntriesResult {
  if (!Array.isArray(raw)) return { ok: false, error: "prices must be an array" };
  if (raw.length > MAX_PRICE_ENTRIES) return { ok: false, error: `prices may have at most ${MAX_PRICE_ENTRIES} entries` };
  const out: PriceEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return { ok: false, error: "each price must be an object" };
    }
    const e = item as Record<string, unknown>;
    if (!(PRICE_CURRENCIES as readonly unknown[]).includes(e.currency)) {
      return { ok: false, error: `currency must be one of ${PRICE_CURRENCIES.join(", ")}` };
    }
    const allowed = isArea ? ["m2", "sqft"] : ["pcs"];
    if (typeof e.unit !== "string" || !allowed.includes(e.unit)) {
      return { ok: false, error: `unit must be ${allowed.join(" or ")} for this component type` };
    }
    if (typeof e.amount !== "number" || !Number.isFinite(e.amount) || e.amount < 0) {
      return { ok: false, error: "amount must be a number greater than or equal to 0" };
    }
    if (!hasAtMost2Decimals(e.amount)) return { ok: false, error: "amount may have at most 2 decimals" };
    if (hasPair(out, e.currency as string, e.unit)) {
      return { ok: false, error: `Duplicate price for ${e.currency} ${e.unit}` };
    }
    out.push({ currency: e.currency as PriceCurrency, unit: e.unit as PriceUnit, amount: Math.round(e.amount * 100) / 100 });
  }
  return { ok: true, entries: sortEntries(out) };
}

/** Trim; blank becomes null; over 500 chars is an error. `undefined` is treated as blank. */
export function validateDescription(raw: unknown): { ok: true; description: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, description: null };
  if (typeof raw !== "string") return { ok: false, error: "description must be a string" };
  const t = raw.trim();
  if (t.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, error: `description must be at most ${MAX_DESCRIPTION_LENGTH} characters` };
  }
  return { ok: true, description: t === "" ? null : t };
}
