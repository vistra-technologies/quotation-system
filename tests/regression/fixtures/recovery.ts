import type { Ledger, LedgerEntry } from "./ledger";
import type { Cleaner } from "./delete-entry";
import { TEST_ORG } from "../env";

type Sweep = (orgSlug: string, prefix: string) => Promise<Array<{ kind: string; id: string; label: string }>>;

/**
 * Orphan recovery, run FIRST in global setup: drain whatever a crashed previous run left in the
 * persistent ledger, then sweep the Test Org for stray rgr- rows (anything the sweep finds was never
 * ledgered = a registration bug somewhere — it is deleted and reported). Throws if anything could not
 * be deleted: a dirty Test Org must not silently leak into a new run.
 */
export async function recoverOrphans(opts: {
  cleaner: Cleaner;
  ledger: Ledger;
  sweep: Sweep;
  /** every org whose slug starts with rgr- (only the suite creates those) */
  rgrOrgs: () => Promise<Array<{ id: string; slug: string }>>;
}): Promise<{
  drained: string[];
  swept: string[];
}> {
  const fromLedger = await opts.cleaner.drainLedger(opts.ledger);
  const strays = (await opts.sweep(TEST_ORG, "rgr-")).map(
    (s): LedgerEntry => ({ kind: s.kind as LedgerEntry["kind"], id: s.id, orgSlug: TEST_ORG, label: s.label, createdAt: "" }),
  );
  for (const o of await opts.rgrOrgs()) {
    strays.push({ kind: "org", id: o.id, orgSlug: o.slug, label: o.slug, createdAt: "" });
  }
  const fromSweep = await opts.cleaner.drain(strays);
  const errors = [...fromLedger.errors, ...fromSweep.errors];
  if (errors.length) {
    throw new Error(`orphan recovery FAILED — ${errors.length} row(s) could not be deleted:\n  ${errors.join("\n  ")}`);
  }
  return { drained: fromLedger.deleted, swept: fromSweep.deleted };
}
