/**
 * Numbering, validity, status and "design changed" rules (Stage 38 S38-D1, Q-D20, S38-6). PURE: every function that
 * depends on the clock takes `now`, so no test-only clock or back-dating route is needed.
 */
import type { QuotationStatus } from "./types";

export const VALIDITY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `QT-YYYY-NNNN`: YYYY is the creation year (display only), NNNN zero-padded to 4 and growing beyond. */
export function formatQuotationNumber(quotationNumber: number, createdAt: Date): string {
  return `QT-${createdAt.getUTCFullYear()}-${String(quotationNumber).padStart(4, "0")}`;
}

/** `from` plus the fixed 30 day validity (Q-D20). */
export function validityFrom(from: Date): Date {
  return new Date(from.getTime() + VALIDITY_DAYS * DAY_MS);
}

/** Renew adds 30 days to the later of now and the current expiry. */
export function renewedValidUntil(validUntil: Date, now: Date): Date {
  return validityFrom(validUntil.getTime() > now.getTime() ? validUntil : now);
}

/** EXPIRED is derived on read (`validUntil < now`); an ORDERED quotation keeps its status; the stored value stays. */
export function deriveStatus(stored: string, validUntil: Date, now: Date): QuotationStatus {
  if (stored === "ORDERED") return "ORDERED";
  return validUntil.getTime() < now.getTime() ? "EXPIRED" : "DRAFT";
}

/** S38-6: no calculation, or the calculation is newer than the last pricing. */
export function isDesignChanged(calcComputedAt: Date | null, pricedAt: Date): boolean {
  return calcComputedAt === null || calcComputedAt.getTime() > pricedAt.getTime();
}
