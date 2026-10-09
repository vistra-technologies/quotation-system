import fs from "node:fs";
import path from "node:path";
import { requireEnv, TEST_ORG, LEDGER_FILE, LOCK_FILE, RUN_DIR, TEARDOWN_STATUS_FILE, RUN_ID_ENV } from "./env";
import { Ledger } from "./fixtures/ledger";
import { SaClient, allowanceFromRun } from "./fixtures/clients";
import { tryReadRunState, deleteRunArtifacts, type RunState } from "./fixtures/run-state";
import { Cleaner } from "./fixtures/delete-entry";
import { diffSharedConfig, diffSnapshots } from "./fixtures/snapshot";
import { removeOwnStrays, type Stray } from "./fixtures/cleanup-rules";
import { releaseRunLock, lockHolderPid, teardownRefusal } from "./fixtures/run-lock";
import { globalStateFailuresFile, readGlobalStateFailures, stuckTemporaryTypeNames } from "./fixtures/global-state";
import { restoreTestOrgLimit } from "./fixtures/test-org-limit";
import { regressionSnapshot, regressionSweep } from "../e2e/db-helpers";

/** R16: the orchestrator reads this to decide whether a retry is allowed (never after a cleanup failure). */
function writeStatus(s: { runId: string | null; cleanupFailed: boolean; reason?: string }) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(TEARDOWN_STATUS_FILE, JSON.stringify({ ...s, at: new Date().toISOString() }, null, 2));
}

export default async function globalTeardown() {
  // IMP-1: Playwright registers this teardown BEFORE global setup runs, so it also runs for a run whose setup was
  // refused at the lock. Such a process must touch NOTHING — not run.json, the ledger, last-teardown.json or the lock
  // of the live run that holds it.
  const refusal = teardownRefusal({
    lockPid: lockHolderPid(LOCK_FILE),
    pid: process.pid,
    runRunId: tryReadRunState()?.runId,
    envRunId: process.env[RUN_ID_ENV],
  });
  if (refusal) {
    console.log(`[regression] teardown: skipped — ${refusal}`);
    return;
  }
  try {
    await teardownAndReport();
  } finally {
    releaseRunLock(LOCK_FILE); // I1: taken by global setup in this same process
  }
}

async function teardownAndReport() {
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
  const strays: Stray[] = [];
  let deleted: string[];
  let errors: string[];
  const stuckNames: string[] = [];
  let limitRestoreFailure: string | null = null;
  let strayRemoval: Awaited<ReturnType<typeof removeOwnStrays>> = { removed: [], errors: [], leftForOthers: [] };
  try {
    ({ deleted, errors } = await cleaner.drainLedger(ledger, mine));
    if (errors.length) {
      // one bounded retry of what is left (same as orphan recovery): a cross-kind dependency the drain order
      // cannot know about — e.g. a formula set still assigned to a throwaway org drains before that org
      const mineIds = new Set(mine.map((e) => e.id));
      const left = ledger.inDeleteOrder().filter((e) => mineIds.has(e.id));
      console.log(`[regression] teardown: ${errors.length} delete(s) failed — retrying ${left.length} entr${left.length === 1 ? "y" : "ies"} once`);
      const retry = await cleaner.drainLedger(ledger, left);
      deleted = [...deleted, ...retry.deleted];
      errors = retry.errors;
    }
    // A Test-Org ComponentType still carrying a suite temporary (rgr-) name = a rename whose revert never ran
    // (e.g. the test timed out inside its window and the afterAll safety net failed too): REPORT it.
    const ct = await sa.get(`/api/v1/superadmin/component-types?orgId=${run.testOrg.id}`);
    if (ct.status() !== 200) {
      stuckNames.push(`could not check Test Org ComponentType names for a stuck rename: HTTP ${ct.status()}`);
    } else {
      const types = ((await ct.json()) as { componentTypes: { code: string; name: string }[] }).componentTypes;
      for (const t of stuckTemporaryTypeNames(types)) stuckNames.push(`Test Org ComponentType ${t} still has a suite temporary name — the rename was never reverted; restore its real name`);
    }
    // R20: any org of THIS run still listed after the drain is a stray
    for (const o of await cleaner.listOrgs()) {
      if (o.slug.startsWith(run.prefix)) strays.push({ kind: "org", id: o.id, label: o.slug, orgSlug: o.slug });
    }
    // platform-level rows of THIS run (SuperAdmins, formula sets) still present after the drain are strays too
    strays.push(...(await cleaner.globalsWithPrefix(run.prefix)).map((g) => ({ ...g, orgSlug: null })));
    // 2. sweep: anything still there with our prefix means a factory failed to register it
    for (const slug of [TEST_ORG, run.orgB.slug]) {
      strays.push(...(await regressionSweep(slug, run.prefix)).map((r) => ({ ...r, orgSlug: slug })));
    }
    // I5: the strays are REPORTED (the run fails) — then the ones carrying THIS run's prefix are deleted through the
    // scoped deleters so they don't linger until a recovery 2 h later. Any other prefix stays report-only.
    if (strays.length) {
      strayRemoval = await removeOwnStrays(cleaner, strays, run.prefix, (e) => {
        if (ledger.all().some((x) => x.id === e.id)) ledger.remove(e.id);
      });
    }
  } finally {
    // Stage 29: put the Test Org's userLimit back EXACTLY (rule 10) — even when the drain above failed.
    limitRestoreFailure = await restoreTestOrgLimit(sa, run.testOrg.id);
    await cleaner.dispose();
    await sa.dispose();
  }
  // 3. the other-orgs diff — the mechanical proof of "did not disturb anything" — plus (I3) the Test Org's shared
  // configuration, whose CONTENT must be back to the baseline exactly (updatedAt and suite-created rows excluded)
  const after = await regressionSnapshot();
  const ignore = (slug: string) => slug === TEST_ORG || slug.startsWith("rgr-");
  const delta = [...diffSnapshots(run.baseline, after, ignore), ...diffSharedConfig(TEST_ORG, run.baseline.orgs[TEST_ORG], after.orgs[TEST_ORG])];
  const orgsCompared = Object.keys(run.baseline.orgs).filter((s) => !ignore(s)).length;
  // global-state revert failures are appended by withRecordedGlobalState via this file
  const stateFile = globalStateFailuresFile(run.storageDir);
  const revertFailures: string[] = [...readGlobalStateFailures(stateFile), ...stuckNames, ...(limitRestoreFailure ? [limitRestoreFailure] : [])];

  const failed = errors.length > 0 || strays.length > 0 || delta.length > 0 || revertFailures.length > 0;
  const report = {
    runId: run.runId, cleanupFailed: failed, created, deleted, cleanupErrors: errors, strays,
    straysRemoved: strayRemoval.removed, straysRemoveErrors: strayRemoval.errors, straysLeftForOtherRuns: strayRemoval.leftForOthers,
    orgsCompared, delta, revertFailures,
  };
  fs.writeFileSync(path.join(run.storageDir, "cleanup.json"), JSON.stringify(report, null, 2));
  console.log(`[regression] teardown: created ${created}, deleted ${deleted.length}, errors ${errors.length}, strays ${strays.length}${strays.length ? ` (removed ${strayRemoval.removed.length}, remove errors ${strayRemoval.errors.length})` : ""}, orgs compared ${orgsCompared}, delta ${delta.length}, revert failures ${revertFailures.length}`);
  // run.json and the storage states (session cookies) go; only cleanup.json stays (R18). Done even on a
  // failed cleanup: recovery never needs them (it works from the ledger + SA routes).
  deleteRunArtifacts(run);
  if (failed) {
    throw new Error(`regression cleanup FAILED\n${JSON.stringify({ cleanupErrors: errors, strays, straysRemoved: strayRemoval.removed, straysRemoveErrors: strayRemoval.errors, delta, revertFailures }, null, 2)}`);
  }
}
