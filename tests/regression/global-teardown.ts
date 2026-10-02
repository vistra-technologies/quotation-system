import fs from "node:fs";
import path from "node:path";
import { requireEnv, TEST_ORG, LEDGER_FILE } from "./env";
import { Ledger } from "./fixtures/ledger";
import { SaClient, allowanceFromRun } from "./fixtures/clients";
import { tryReadRunState } from "./fixtures/run-state";
import { Cleaner } from "./fixtures/delete-entry";
import { diffSnapshots } from "./fixtures/snapshot";
import { regressionSnapshot, regressionSweep } from "../e2e/db-helpers";

export default async function globalTeardown() {
  const env = requireEnv();
  const run = tryReadRunState();
  if (!run) {
    console.log("[regression] teardown: no run state (setup did not complete) — the next run's orphan recovery drains the ledger");
    return;
  }
  const allowance = allowanceFromRun(run);
  const sa = await SaClient.login(env.baseURL, env.saUser, env.saPass, allowance, env.bypass);
  const ledger = new Ledger(LEDGER_FILE);
  const created = ledger.load().length;

  // 1. drain the ledger (children first; the run admin last among org-API deletes)
  const cleaner = new Cleaner(sa, { ...env, run });
  let deleted: string[];
  let errors: string[];
  try {
    ({ deleted, errors } = await cleaner.drainLedger(ledger));
  } finally {
    await cleaner.dispose();
    await sa.dispose();
  }
  // 2. sweep: anything still there with our prefix means a factory failed to register it
  const strays = [...(await regressionSweep(TEST_ORG, run.prefix)), ...(await regressionSweep(run.orgB.slug, run.prefix))];
  // 3. the other-orgs diff — the mechanical proof of "did not disturb anything"
  const after = await regressionSnapshot();
  const ignore = (slug: string) => slug === TEST_ORG || slug.startsWith("rgr-");
  const delta = diffSnapshots(run.baseline, after, ignore);
  const orgsCompared = Object.keys(run.baseline.orgs).filter((s) => !ignore(s)).length;
  // global-state revert failures are appended by withGlobalState via this file
  const stateFile = path.join(run.storageDir, "global-state-failures.json");
  const revertFailures: string[] = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf-8")) : [];

  const report = { runId: run.runId, created, deleted, cleanupErrors: errors, strays, orgsCompared, delta, revertFailures };
  fs.writeFileSync(path.join(run.storageDir, "cleanup.json"), JSON.stringify(report, null, 2));
  console.log(`[regression] teardown: created ${created}, deleted ${deleted.length}, errors ${errors.length}, strays ${strays.length}, orgs compared ${orgsCompared}, delta ${delta.length}, revert failures ${revertFailures.length}`);
  if (errors.length || strays.length || delta.length || revertFailures.length) {
    throw new Error(`regression cleanup FAILED\n${JSON.stringify({ cleanupErrors: errors, strays, delta, revertFailures }, null, 2)}`);
  }
}
