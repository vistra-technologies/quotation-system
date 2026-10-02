import fs from "node:fs";
import path from "node:path";
import { requireEnv, TEST_ORG, LEDGER_FILE, RUN_DIR, TEARDOWN_STATUS_FILE } from "./env";
import { Ledger } from "./fixtures/ledger";
import { SaClient, allowanceFromRun } from "./fixtures/clients";
import { tryReadRunState, deleteRunArtifacts, type RunState } from "./fixtures/run-state";
import { Cleaner } from "./fixtures/delete-entry";
import { diffSnapshots } from "./fixtures/snapshot";
import { globalStateFailuresFile } from "./fixtures/global-state";
import { regressionSnapshot, regressionSweep } from "../e2e/db-helpers";

/** R16: the orchestrator reads this to decide whether a retry is allowed (never after a cleanup failure). */
function writeStatus(s: { runId: string | null; cleanupFailed: boolean; reason?: string }) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(TEARDOWN_STATUS_FILE, JSON.stringify({ ...s, at: new Date().toISOString() }, null, 2));
}

export default async function globalTeardown() {
  const run = tryReadRunState();
  writeStatus({ runId: run?.runId ?? null, cleanupFailed: true, reason: "teardown started but did not finish" });
  if (!run) {
    writeStatus({ runId: null, cleanupFailed: true, reason: "no run state — setup did not complete; the next run's orphan recovery drains the ledger" });
    console.log("[regression] teardown: no run state (setup did not complete) — the next run's orphan recovery drains the ledger");
    return;
  }
  try {
    await teardown(run);
    writeStatus({ runId: run.runId, cleanupFailed: false });
  } catch (err) {
    writeStatus({ runId: run.runId, cleanupFailed: true, reason: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

async function teardown(run: RunState) {
  const env = requireEnv();
  const allowance = allowanceFromRun(run);
  const sa = await SaClient.login(env.baseURL, env.saUser, env.saPass, allowance, env.bypass);
  const ledger = new Ledger(LEDGER_FILE);
  // Only THIS run's entries: rows another (possibly still active) run ledgered are left for its own
  // teardown or a later orphan recovery (R19).
  const mine = ledger.inDeleteOrder().filter((e) => e.label.startsWith(run.prefix));
  const created = mine.length;

  // 1. drain this run's ledger entries (children first; the run admin last among org-API deletes)
  const cleaner = new Cleaner(sa, { ...env, run });
  const strays: Array<{ kind: string; id: string; label: string }> = [];
  let deleted: string[];
  let errors: string[];
  try {
    ({ deleted, errors } = await cleaner.drainLedger(ledger, mine));
    // R20: any org of THIS run still listed after the drain is a stray
    for (const o of await cleaner.listOrgs()) {
      if (o.slug.startsWith(run.prefix)) strays.push({ kind: "org", id: o.id, label: o.slug });
    }
  } finally {
    await cleaner.dispose();
    await sa.dispose();
  }
  // 2. sweep: anything still there with our prefix means a factory failed to register it
  strays.push(...(await regressionSweep(TEST_ORG, run.prefix)), ...(await regressionSweep(run.orgB.slug, run.prefix)));
  // 3. the other-orgs diff — the mechanical proof of "did not disturb anything"
  const after = await regressionSnapshot();
  const ignore = (slug: string) => slug === TEST_ORG || slug.startsWith("rgr-");
  const delta = diffSnapshots(run.baseline, after, ignore);
  const orgsCompared = Object.keys(run.baseline.orgs).filter((s) => !ignore(s)).length;
  // global-state revert failures are appended by withRecordedGlobalState via this file
  const stateFile = globalStateFailuresFile(run.storageDir);
  const revertFailures: string[] = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf-8")) : [];

  const failed = errors.length > 0 || strays.length > 0 || delta.length > 0 || revertFailures.length > 0;
  const report = { runId: run.runId, cleanupFailed: failed, created, deleted, cleanupErrors: errors, strays, orgsCompared, delta, revertFailures };
  fs.writeFileSync(path.join(run.storageDir, "cleanup.json"), JSON.stringify(report, null, 2));
  console.log(`[regression] teardown: created ${created}, deleted ${deleted.length}, errors ${errors.length}, strays ${strays.length}, orgs compared ${orgsCompared}, delta ${delta.length}, revert failures ${revertFailures.length}`);
  // run.json and the storage states (session cookies) go; only cleanup.json stays (R18). Done even on a
  // failed cleanup: recovery never needs them (it works from the ledger + SA routes).
  deleteRunArtifacts(run);
  if (failed) {
    throw new Error(`regression cleanup FAILED\n${JSON.stringify({ cleanupErrors: errors, strays, delta, revertFailures }, null, 2)}`);
  }
}
