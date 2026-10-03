import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recoverOrphans } from "../regression/fixtures/recovery";
import { drainOrder } from "../regression/fixtures/cleanup-rules";
import { Ledger, type LedgerEntry } from "../regression/fixtures/ledger";

const NOW = Date.UTC(2026, 9, 3, 12);
const OLD = (NOW - 3 * 60 * 60 * 1000).toString(36); // a run 3 h old → past the 2 h recovery gate

function tmpLedger(): Ledger {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rgr-recovery-"));
  return new Ledger(path.join(dir, "ledger.jsonl"));
}

/** Fake cleaner over an in-memory "DB": deleting a user fails (FK) while a project it created still exists. */
function fakeCleaner(rows: Map<string, LedgerEntry>, createdBy: Map<string, string>, opts: { stuck?: string } = {}) {
  const calls: string[][] = [];
  return {
    calls,
    async drain(entries: LedgerEntry[], onDeleted?: (e: LedgerEntry) => void) {
      calls.push(entries.map((e) => e.id));
      const deleted: string[] = [];
      const errors: string[] = [];
      for (const e of drainOrder(entries)) {
        const blocked = e.kind === "user" && [...createdBy].some(([proj, user]) => user === e.id && rows.has(proj));
        if (blocked || e.id === opts.stuck) {
          errors.push(`cleanup: delete ${e.kind} ${e.label} → HTTP 500`);
          continue;
        }
        rows.delete(e.id);
        onDeleted?.(e);
        deleted.push(`${e.kind}:${e.label}`);
      }
      return { deleted, errors };
    },
  };
}

const row = (kind: LedgerEntry["kind"], id: string, label: string): LedgerEntry => ({ kind, id, orgSlug: "e2e-testorg", label, createdAt: "" });

test("recovery: an UNLEDGERED project referencing the LEDGERED run admin does not fail recovery (one drain batch)", async () => {
  const admin = row("user", "u1", `rgr-${OLD}-admin`);
  const proj = row("project", "p1", `rgr-${OLD}-proj-abc1`);
  const ledger = tmpLedger();
  ledger.add(admin);
  const rows = new Map([[admin.id, admin], [proj.id, proj]]);
  const cleaner = fakeCleaner(rows, new Map([[proj.id, admin.id]]));
  const res = await recoverOrphans({
    cleaner,
    ledger,
    sweep: async () => [{ kind: "project", id: proj.id, label: proj.label }, { kind: "user", id: admin.id, label: admin.label }],
    rgrOrgs: async () => [],
    minAgeMs: 2 * 60 * 60 * 1000,
    now: NOW,
  });
  assert.equal(rows.size, 0);
  assert.deepEqual(res.drained, [`user:${admin.label}`]);
  assert.deepEqual(res.swept, [`project:${proj.label}`]);
  assert.equal(cleaner.calls.length, 1, "no retry needed: projects drain before the run admin");
  assert.deepEqual(ledger.all(), []);
});

test("recovery: a failure that persists through the retry still throws and keeps the ledger entry", async () => {
  const admin = row("user", "u1", `rgr-${OLD}-admin`);
  const ledger = tmpLedger();
  ledger.add(admin);
  const rows = new Map([[admin.id, admin]]);
  const cleaner = fakeCleaner(rows, new Map(), { stuck: admin.id });
  await assert.rejects(
    recoverOrphans({ cleaner, ledger, sweep: async () => [], rgrOrgs: async () => [], minAgeMs: 0, now: NOW }),
    /orphan recovery FAILED — 1 row\(s\)/,
  );
  assert.equal(cleaner.calls.length, 2, "one bounded retry");
  assert.deepEqual(ledger.all().map((e) => e.id), [admin.id]);
});

test("recovery: stale rgr- SuperAdmins / formula sets (no org) are swept; a young run's are skipped and reported", async () => {
  const YOUNG = (NOW - 5 * 60 * 1000).toString(36);
  const oldSa = { kind: "superadmin" as const, id: "sa1", label: `rgr-${OLD}-sa-1` };
  const oldFs = { kind: "formulaSet" as const, id: "fs1", label: `rgr-${OLD}-fs-1` };
  const youngFs = { kind: "formulaSet" as const, id: "fs2", label: `rgr-${YOUNG}-fs-1` };
  const rows = new Map<string, LedgerEntry>([oldSa, oldFs, youngFs].map((g) => [g.id, { ...g, orgSlug: null, createdAt: "" }]));
  const cleaner = fakeCleaner(rows, new Map());
  const res = await recoverOrphans({
    cleaner,
    ledger: tmpLedger(),
    sweep: async () => [],
    rgrOrgs: async () => [],
    rgrGlobals: async () => [oldSa, oldFs, youngFs],
    minAgeMs: 2 * 60 * 60 * 1000,
    now: NOW,
  });
  assert.deepEqual(res.swept.sort(), [`formulaSet:${oldFs.label}`, `superadmin:${oldSa.label}`]);
  assert.deepEqual([...rows.keys()], [youngFs.id]);
  assert.equal(res.skipped.length, 1);
  assert.match(res.skipped[0], /^formulaSet: .*younger than/);
});