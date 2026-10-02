import type { Ledger, LedgerEntry } from "./ledger";
import type { Cleaner } from "./delete-entry";
import { TEST_ORG } from "../env";
import { recoverDecision } from "./cleanup-rules";

type Sweep = (orgSlug: string, prefix: string) => Promise<Array<{ kind: string; id: string; label: string }>>;

/**
 * Orphan recovery, run FIRST in global setup: drain what a crashed previous run left in the persistent
 * ledger, then delete stray rgr- rows in the Test Org (sweep) and stray rgr- orgs (anything found
 * there was never ledgered = a registration bug — deleted and reported).
 *
 * R19: a row whose rgr-<runId>- is younger than `minAgeMs` (default RECOVER_MIN_AGE_MS, 2 h) may
 * belong to a run that is still active — it is SKIPPED and REPORTED, never deleted. Rows whose age
 * can't be derived are skipped and reported too.
 *
 * Throws if anything that should be deleted could not be: a dirty Test Org must not leak into a new run.
 */
export async function recoverOrphans(opts: {
  cleaner: Cleaner;
  ledger: Ledger;
  sweep: Sweep;
  /** every org whose slug starts with rgr- (only the suite creates those) */
  rgrOrgs: () => Promise<Array<{ id: string; slug: string }>>;
  minAgeMs: number;
  now?: number;
}): Promise<{ drained: string[]; swept: string[]; skipped: string[] }> {
  const now = opts.now ?? Date.now();
  const skipped: string[] = [];
  const skippedIds = new Set<string>();
  const keep = (e: LedgerEntry) => {
    const d = recoverDecision(e.label, now, opts.minAgeMs);
    if (!d.delete) {
      if (!skippedIds.has(e.id)) skipped.push(`${e.kind}: ${d.reason}`);
      skippedIds.add(e.id);
    }
    return d.delete;
  };

  const fromLedger = await opts.cleaner.drainLedger(opts.ledger, opts.ledger.inDeleteOrder().filter(keep));

  const strays: LedgerEntry[] = (await opts.sweep(TEST_ORG, "rgr-")).map((s) => ({
    kind: s.kind as LedgerEntry["kind"], id: s.id, orgSlug: TEST_ORG, label: s.label, createdAt: "",
  }));
  for (const o of await opts.rgrOrgs()) strays.push({ kind: "org", id: o.id, orgSlug: o.slug, label: o.slug, createdAt: "" });
  const fromSweep = await opts.cleaner.drain(strays.filter((e) => !skippedIds.has(e.id) && keep(e)));

  const errors = [...fromLedger.errors, ...fromSweep.errors];
  if (errors.length) {
    throw new Error(`orphan recovery FAILED — ${errors.length} row(s) could not be deleted:\n  ${errors.join("\n  ")}`);
  }
  return { drained: fromLedger.deleted, swept: fromSweep.deleted, skipped };
}
