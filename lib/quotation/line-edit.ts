/**
 * Editing one quotation line's unit price (Stage 38 Batch 5, 38c; Q-D13, Q-D14, Q-D33, Q-D34). PURE.
 * The range check runs against the line's OWN stored copy (`minPrice`, `defaultPrice`, `allowAbove`), never the
 * live Inventory price, so a later Inventory change never invalidates an edit (API AC3). Amounts are integer cents.
 */
import { centsToFixed, parseMoneyToCents } from "@/lib/money";
import { amountCents, lineCents } from "./lines";
import type { QuotationLine } from "./types";

/** PATCH .../quotation/lines body: `{ code, unitPrice }` sets the price, `{ code, reset: true }` restores the default. */
export type LinePatch = { code: string; reset: true } | { code: string; unitPriceCents: number };

export type LinePatchParse = { ok: true; patch: LinePatch } | { ok: false; error: string };

export function parseLinePatch(body: unknown): LinePatchParse {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "Body must be a JSON object" };
  const b = body as Record<string, unknown>;
  const unknownKey = Object.keys(b).find((k) => !["code", "unitPrice", "reset"].includes(k));
  if (unknownKey) return { ok: false, error: `Unknown field: ${unknownKey}` };
  if (typeof b.code !== "string" || b.code.trim() === "") return { ok: false, error: "code is required" };
  const hasPrice = b.unitPrice !== undefined;
  const hasReset = b.reset !== undefined;
  if (hasPrice === hasReset) return { ok: false, error: "Send either unitPrice or reset: true" };
  if (hasReset) {
    if (b.reset !== true) return { ok: false, error: "reset must be true" };
    return { ok: true, patch: { code: b.code, reset: true } };
  }
  const cents = parseMoneyToCents(b.unitPrice);
  if (cents === null) return { ok: false, error: "unitPrice must be a non-negative amount with at most 2 decimal places" };
  return { ok: true, patch: { code: b.code, unitPriceCents: cents } };
}

/** "2400.00" becomes "2,400", "2400.50" becomes "2,400.50" (the mockup's range numbers: no trailing .00). */
export function formatBound(fixed: string): string {
  const cents = lineCents(fixed);
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = cents % 100;
  return frac === 0 ? whole : `${whole}.${String(frac).padStart(2, "0")}`;
}

/** The allowed range of a line (stored copy): `max` is null for "No upper limit". */
export function lineRange(line: Pick<QuotationLine, "minPrice" | "defaultPrice" | "allowAbove">): { min: string; max: string | null } {
  return { min: formatBound(line.minPrice), max: line.allowAbove ? null : formatBound(line.defaultPrice) };
}

/** null when `unitCents` is within the line's stored range, else the 400 message naming the range. */
export function checkLinePrice(line: Pick<QuotationLine, "minPrice" | "defaultPrice" | "allowAbove">, unitCents: number): string | null {
  const min = lineCents(line.minPrice);
  const max = lineCents(line.defaultPrice);
  const r = lineRange(line);
  if (unitCents < min) return r.max === null ? `Enter a price of ${r.min} or more.` : `Enter a price from ${r.min} to ${r.max}.`;
  if (!line.allowAbove && unitCents > max) return `Enter a price from ${r.min} to ${r.max}.`;
  return null;
}

export type LineEditResult =
  | { ok: true; lines: QuotationLine[] }
  | { ok: false; reason: "noLine" }
  | { ok: false; reason: "range"; error: string };

function withUnitPrice(line: QuotationLine, unitCents: number): QuotationLine {
  return { ...line, unitPrice: centsToFixed(unitCents), amount: centsToFixed(amountCents(line.quantity, unitCents)) };
}

/** One line's unit price set (range-checked against its stored copy), its amount recomputed; other lines untouched. */
export function editLinePrice(lines: ReadonlyArray<QuotationLine>, code: string, unitCents: number): LineEditResult {
  const i = lines.findIndex((l) => l.code === code);
  if (i < 0) return { ok: false, reason: "noLine" };
  const error = checkLinePrice(lines[i], unitCents);
  if (error) return { ok: false, reason: "range", error };
  return { ok: true, lines: lines.map((l, j) => (j === i ? withUnitPrice(l, unitCents) : l)) };
}

/** One line back to its stored `defaultPrice` (not the live Inventory price). */
export function resetLinePrice(lines: ReadonlyArray<QuotationLine>, code: string): LineEditResult {
  const i = lines.findIndex((l) => l.code === code);
  if (i < 0) return { ok: false, reason: "noLine" };
  return { ok: true, lines: lines.map((l, j) => (j === i ? withUnitPrice(l, lineCents(l.defaultPrice)) : l)) };
}
