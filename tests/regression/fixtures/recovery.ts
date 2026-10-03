import type { Ledger, LedgerEntry } from "./ledger";
import type { Cleaner } from "./delete-entry";

type Drainer = Pick<Cleaner, "drain">;
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
  cleaner: Drainer;
  ledger: Ledger;
  sweep: Sweep;
  /** every org whose slug starts with rgr- (only the suite creates those) */
  rgrOrgs: () => Promise<Array<{ id: string; slug: string }>>;
  /** platform-level suite rows (rgr- SuperAdmins, rgr- formula sets) — they live in no org, so the org sweep misses them */
  rgrGlobals?: () => Promise<Array<{ kind: "superadmin" | "formulaSet"; id: string; label: string }>>;
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

  const fromLedger = opts.ledger.inDeleteOrder().filter(keep);
  const ledgerIds = new Set(opts.ledger.all().map((e) => e.id));

  const strays: LedgerEntry[] = (await opts.sweep(TEST_ORG, "rgr-")).map((s) => ({
    kind: s.kind as LedgerEntry["kind"], id: s.id, orgSlug: TEST_ORG, label: s.label, createdAt: "",
  }));
  for (const o of await opts.rgrOrgs()) strays.push({ kind: "org", id: o.id, orgSlug: o.slug, label: o.slug, createdAt: "" });
  for (const g of (await opts.rgrGlobals?.()) ?? []) strays.push({ kind: g.kind, id: g.id, orgSlug: null, label: g.label, createdAt: "" });
  // a swept row that is already in the ledger is drained once, as the ledger entry
  const fromSweep = strays.filter((e) => !ledgerIds.has(e.id) && !skippedIds.has(e.id) && keep(e));

  // ONE drain batch (drainOrder: projects before the run admin, ...) — draining the ledger first would
  // let an UNLEDGERED project (e.g. a create whose 201 was lost) block the ledgered run admin's delete
  // (FK) and fail recovery although the sweep would remove the project a moment later.
  const done = new Set<string>();
  const onDeleted = (e: LedgerEntry) => {
    done.add(e.id);
    if (ledgerIds.has(e.id)) opts.ledger.remove(e.id);
  };
  const batch = [...fromLedger, ...fromSweep];
  let res = await opts.cleaner.drain(batch, onDeleted);
  if (res.errors.length) {
    // one bounded retry of what is left: a cross-kind dependency the drain order cannot know about
    res = await opts.cleaner.drain(batch.filter((e) => !done.has(e.id)), onDeleted);
  }
  const label = (e: LedgerEntry) => `${e.kind}:${e.label}`;
  const drained = fromLedger.filter((e) => done.has(e.id)).map(label);
  const swept = fromSweep.filter((e) => done.has(e.id)).map(label);

  const errors = res.errors; // only failures that persisted through the retry
  if (errors.length) {
    throw new Error(`orphan recovery FAILED — ${errors.length} row(s) could not be deleted:\n  ${errors.join("\n  ")}`);
  }
  return { drained, swept, skipped };
}
