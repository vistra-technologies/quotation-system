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
 * M1: the LIVE name/code of an org-API row (from its GET body) — project.name, item.code, company.name — must be a
 * suite row before cleanup deletes it by id (never trust the ledger label). Inventory codes are compared trimmed and
 * lower-cased, like the sweep (db-scope normalizeSweepCode). Returns the refusal reason, or null when deletable.
 */
export function orgRowDeleteRefusal(kind: "project" | "inventoryItem" | "externalCompany", body: unknown): string | null {
  const b = (body ?? {}) as { project?: { name?: unknown }; item?: { code?: unknown }; company?: { name?: unknown } };
  const live = kind === "project" ? b.project?.name : kind === "inventoryItem" ? b.item?.code : b.company?.name;
  if (typeof live !== "string") return `${kind}: the GET body carries no ${kind === "inventoryItem" ? "code" : "name"}`;
  const norm = kind === "inventoryItem" ? live.trim().toLowerCase() : live;
  return norm.startsWith("rgr-") && norm.length > 4 ? null : `${kind} is "${live}" — not an rgr- row, will not delete`;
}

/** Only suite-created formula sets (platform-global rows) may ever be deleted. */
export const isDeletableFormulaSetName = (name: string) => typeof name === "string" && name.startsWith("rgr-") && name.length > 4;

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

/**
 * Kinds the sweep can find but the app offers NO delete route for (final review I2): a custom Role has no DELETE
 * anywhere in the API. The suite never creates one in the Test Org (role tests write only in throwaway org B, which
 * cascades), so a swept rgr- role is a registration bug to REPORT — never a reason for recovery/teardown to throw
 * "no deleter wired" and block every later run.
 */
export const REPORT_ONLY_KINDS: ReadonlySet<string> = new Set(["role"]);
export const reportOnlyNote = (e: { kind: string; label: string }) =>
  `${e.kind}: "${e.label}" has no delete route in the app — REPORTED, not deleted; remove it by hand`;

export type Stray = { kind: string; id: string; label: string; orgSlug: string | null };

/**
 * Final review I5: after teardown REPORTS its strays (the run still fails), it deletes the ones carrying THIS run's
 * own prefix through the normal scoped deleters — no age gate, they are provably ours. Strays of any other prefix
 * (another run, possibly still active) are left alone and stay report-only.
 */
export async function removeOwnStrays(
  cleaner: { drain(entries: LedgerEntry[], onDeleted?: (e: LedgerEntry) => void): Promise<{ deleted: string[]; errors: string[] }> },
  strays: Stray[],
  prefix: string,
  onDeleted?: (e: LedgerEntry) => void,
): Promise<{ removed: string[]; errors: string[]; leftForOthers: string[] }> {
  if (!prefix.startsWith("rgr-") || prefix.length <= 4) throw new Error(`removeOwnStrays: "${prefix}" is not a run prefix`);
  const own = strays.filter((s) => s.label.toLowerCase().startsWith(prefix) && !REPORT_ONLY_KINDS.has(s.kind));
  const reportOnly = strays.filter((s) => REPORT_ONLY_KINDS.has(s.kind)).map(reportOnlyNote);
  const leftForOthers = strays.filter((s) => !own.includes(s) && !REPORT_ONLY_KINDS.has(s.kind)).map((s) => `${s.kind}:${s.label}`);
  if (!own.length) return { removed: [], errors: reportOnly, leftForOthers };
  const entries = own.map((s) => ({ kind: s.kind as LedgerEntry["kind"], id: s.id, orgSlug: s.orgSlug, label: s.label, createdAt: "" }));
  const { deleted, errors } = await cleaner.drain(entries, onDeleted);
  return { removed: deleted, errors: [...errors, ...reportOnly], leftForOthers };
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
