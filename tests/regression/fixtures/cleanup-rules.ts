// Pure cleanup rules (no Playwright / Prisma imports) — unit-tested in tests/unit/regression-cleanup-rules.test.ts.
import { randomBytes } from "node:crypto";
import { DELETE_ORDER, type LedgerEntry } from "./ledger";

/** The suite's run-admin username shape: rgr-<runId>-admin. */
export const isRunAdminUsername = (u: string) => /^rgr-.+-admin$/.test(u);

/** Only suite-created orgs may ever be suspended / hard-deleted (R17). */
export const isDeletableOrgSlug = (slug: string) => typeof slug === "string" && slug.startsWith("rgr-") && slug.length > 4;

/** Only suite-created SuperAdmins may ever be deleted (R17). */
export const isDeletableSuperAdminUsername = (u: string) =>
  typeof u === "string" && ((u.startsWith("rgr-") && u.length > 4) || (u.startsWith("e2e-sa-") && u.length > 7));

/**
 * Children before parents (ledger DELETE_ORDER), with two exceptions:
 *  - the run admin (rgr-…-admin) goes right AFTER externalCompany — it is the session the org-API
 *    deletes run under, and DELETE_ORDER puts user before externalCompany;
 *  - an unknown kind sorts LAST (it can never jump ahead of a known kind).
 */
export function drainOrder(entries: LedgerEntry[]): LedgerEntry[] {
  const rank = (e: LedgerEntry) => {
    if (e.kind === "user" && isRunAdminUsername(e.label)) return DELETE_ORDER.indexOf("externalCompany") + 0.5;
    const i = DELETE_ORDER.indexOf(e.kind);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  return [...entries].sort((a, b) => rank(a) - rank(b));
}

/** Rows of a run younger than this are left alone by orphan recovery: that run may still be active (R19). */
export const RECOVER_MIN_AGE_MS = 2 * 60 * 60 * 1000;
/** Test seam: RGR_RECOVER_MIN_AGE_MS=0 lets the crash-recovery proof clean a just-crashed run. */
export function recoverMinAgeMs(env: Record<string, string | undefined> = process.env): number {
  const v = env.RGR_RECOVER_MIN_AGE_MS;
  if (v === undefined || v === "") return RECOVER_MIN_AGE_MS;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`RGR_RECOVER_MIN_AGE_MS must be a non-negative number, got "${v}"`);
  return n;
}

/** runId = base36 Date.now() at setup start; every suite row is named rgr-<runId>-… */
export function runIdOf(name: string): { runId: string; startedAt: number } | null {
  const m = /^rgr-([0-9a-z]+)-./.exec(name);
  if (!m) return null;
  return { runId: m[1], startedAt: parseInt(m[1], 36) };
}

const PLAUSIBLE_FROM = Date.UTC(2024, 0, 1);

export function recoverDecision(name: string, now: number, minAgeMs: number): { delete: boolean; reason?: string } {
  const r = runIdOf(name);
  if (!r) return { delete: false, reason: `"${name}" has no rgr-<runId>- prefix (age unknown)` };
  if (!Number.isFinite(r.startedAt) || r.startedAt < PLAUSIBLE_FROM) {
    return { delete: false, reason: `"${name}": runId "${r.runId}" is not a plausible run timestamp (age unknown)` };
  }
  const age = now - r.startedAt;
  if (age < 0) return { delete: false, reason: `"${name}": runId "${r.runId}" is in the future (age unknown)` };
  if (age < minAgeMs) {
    return { delete: false, reason: `"${name}": run ${r.runId} is younger than ${Math.round(minAgeMs / 60000)} min (${Math.round(age / 60000)} min) — may still be active` };
  }
  return { delete: true };
}

/** Per-run password for the suite's own users (R18): random, URL-safe, upper/lower/digit guaranteed. */
export function generateRunPassword(): string {
  return `Rg9${randomBytes(18).toString("base64url")}x`;
}
