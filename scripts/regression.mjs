// Regression orchestrator: coverage map → unit tests → playwright (re-run failed TESTS once) → exit code.
// R16: a failed cleanup (teardown errors / strays / delta / revert failures, teardown threw, or setup never
// completed) is never retried — retrying would hide it. Only plain test failures get one --last-failed re-run.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = path.join(ROOT, ".engineering", "regression");
const STATUS_FILE = path.join(BASE, "last-teardown.json"); // written by global-teardown
const LATEST_RUN_FILE = path.join(BASE, "latest-run.json"); // written by the reporter; survives teardown (run.json does not)
const UNIT_FILE = path.join(BASE, "unit.txt"); // captured node:test summary, parsed by the report
// M6: both passes share ONE last-run file outside the per-pass output dirs, so --last-failed still finds the first
// pass's failures although the re-run writes its traces to a different outputDir.
const LAST_RUN = path.join(BASE, "last-run.json");
const LOCK_FILE = path.join(BASE, "run.lock"); // taken by global-setup (tests/regression/fixtures/run-lock.ts)

/**
 * IMP-1: the pid of a LIVE run holding the lock, else null. Checked before this orchestrator deletes ANY shared file
 * (last-teardown.json, latest-run.json, last-run.json, unit.txt): a second orchestrator must not clobber the status
 * files of the run that is still going. (A dead pid's lock is stale — global-setup takes it over.)
 */
function liveLockHolder() {
  let pid;
  try {
    pid = JSON.parse(fs.readFileSync(LOCK_FILE, "utf-8")).pid;
  } catch {
    return null;
  }
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch (e) {
    return e.code === "EPERM" ? pid : null;
  }
}
const refuseIfLocked = () => {
  const pid = liveLockHolder();
  if (pid !== null) {
    console.error(`
REGRESSION REFUSED: another run is live (${LOCK_FILE} held by pid ${pid}) — never run two live runs at once. Nothing was touched.`);
    process.exit(1);
  }
};
refuseIfLocked();

const run = (label, cmd, args, env = process.env) => {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true, env, cwd: ROOT });
  return r.status ?? 1;
};

/** Runs one playwright pass; returns { testsFailed, cleanupFailed, reason, runId }. */
const pass = (label, extra = [], env = process.env) => {
  refuseIfLocked(); // a run may have started since the last check — never delete its status files
  fs.rmSync(STATUS_FILE, { force: true });
  fs.rmSync(LATEST_RUN_FILE, { force: true }); // never let the report pick up a previous run's id
  const code = run(label, "npx", ["playwright", "test", "-c", "playwright.regression.config.ts", ...extra], env);
  let runId = null;
  try {
    runId = JSON.parse(fs.readFileSync(LATEST_RUN_FILE, "utf-8")).runId ?? null;
  } catch {
    /* setup never produced a run */
  }
  let status = null;
  try {
    status = JSON.parse(fs.readFileSync(STATUS_FILE, "utf-8"));
  } catch {
    /* missing → teardown never ran (setup failed or the process died) */
  }
  if (!status) return { runId, testsFailed: code !== 0, cleanupFailed: true, reason: "teardown did not run (setup failed or the run was killed)" };
  return { runId, testsFailed: code !== 0, cleanupFailed: !!status.cleanupFailed, reason: status.reason ?? "see .engineering/regression/<runId>/cleanup.json" };
};

let failed = 0;
failed += run("coverage map", "npx", ["tsx", "tests/regression/coverage-map.ts"]) ? 1 : 0;
// Unit tests: tee the output (console + unit.txt) so the report can parse the node:test summary lines.
fs.mkdirSync(BASE, { recursive: true });
fs.rmSync(UNIT_FILE, { force: true });
console.log("\n=== unit tests ===");
const unit = spawnSync("npm", ["run", "test:unit"], { shell: true, cwd: ROOT, encoding: "utf-8", maxBuffer: 256 * 1024 * 1024 });
process.stdout.write(unit.stdout ?? "");
process.stderr.write(unit.stderr ?? "");
fs.writeFileSync(UNIT_FILE, ((unit.stdout ?? "") + (unit.stderr ?? "")).replace(/\u001b\[[0-9;]*m/g, ""));
failed += (unit.status ?? 1) ? 1 : 0;

fs.rmSync(LAST_RUN, { force: true });
let r = pass("regression (parallel)", [], { ...process.env, RGR_OUTPUT_DIR: "test-results/regression", PLAYWRIGHT_LAST_RUN_OUTPUT_FILE: LAST_RUN });
if (r.cleanupFailed) {
  console.log(`\n=== CLEANUP FAILED — not retrying (${r.reason}) ===`);
} else if (r.testsFailed) {
  const firstRunId = r.runId;
  console.log("\n=== re-running failed tests once at --workers=1 (sign-in rate limit is a known flake source) ===");
  // RGR_MERGE_FROM: the reporter folds this re-run's results into the first pass's, marking recovered tests flaky.
  r = pass("regression (failed only)", ["--last-failed", "--workers=1"], {
    ...process.env,
    RGR_OUTPUT_DIR: "test-results/regression-rerun", // M6: keep the first pass's traces (the report links to both)
    PLAYWRIGHT_LAST_RUN_OUTPUT_FILE: LAST_RUN,
    ...(firstRunId ? { RGR_MERGE_FROM: firstRunId } : {}),
  });
  if (r.cleanupFailed) console.log(`\n=== CLEANUP FAILED on the re-run (${r.reason}) ===`);
}
failed += r.testsFailed || r.cleanupFailed ? 1 : 0;

// The report is produced LAST and unconditionally (also after failures). Its exit code is 1 whenever its verdict is
// FAIL (or it crashed), so the console verdict and exit status can never be greener than the report.
const reportCode = run("report", "npx", ["tsx", "scripts/regression-report.mjs"]);
if (reportCode) failed += 1;
console.log(failed ? `\nREGRESSION FAIL (${failed} stage${failed > 1 ? "s" : ""} failed)` : "\nREGRESSION PASS");
process.exit(failed ? 1 : 0);
