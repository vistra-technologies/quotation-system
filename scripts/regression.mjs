// Regression orchestrator: coverage map → unit tests → playwright (re-run failed TESTS once) → exit code.
// R16: a failed cleanup (teardown errors / strays / delta / revert failures, teardown threw, or setup never
// completed) is never retried — retrying would hide it. Only plain test failures get one --last-failed re-run.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATUS_FILE = path.join(ROOT, ".engineering", "regression", "last-teardown.json"); // written by global-teardown

const run = (label, cmd, args, env = process.env) => {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true, env, cwd: ROOT });
  return r.status ?? 1;
};

/** Runs one playwright pass; returns { testsFailed, cleanupFailed, reason }. */
const pass = (label, extra = []) => {
  fs.rmSync(STATUS_FILE, { force: true });
  const code = run(label, "npx", ["playwright", "test", "-c", "playwright.regression.config.ts", ...extra]);
  let status = null;
  try {
    status = JSON.parse(fs.readFileSync(STATUS_FILE, "utf-8"));
  } catch {
    /* missing → teardown never ran (setup failed or the process died) */
  }
  if (!status) return { testsFailed: code !== 0, cleanupFailed: true, reason: "teardown did not run (setup failed or the run was killed)" };
  return { testsFailed: code !== 0, cleanupFailed: !!status.cleanupFailed, reason: status.reason ?? "see .engineering/regression/<runId>/cleanup.json" };
};

let failed = 0;
failed += run("coverage map", "npx", ["tsx", "tests/regression/coverage-map.ts"]) ? 1 : 0;
failed += run("unit tests", "npm", ["run", "test:unit"]) ? 1 : 0;

let r = pass("regression (parallel)");
if (r.cleanupFailed) {
  console.log(`\n=== CLEANUP FAILED — not retrying (${r.reason}) ===`);
} else if (r.testsFailed) {
  console.log("\n=== re-running failed tests once at --workers=1 (sign-in rate limit is a known flake source) ===");
  r = pass("regression (failed only)", ["--last-failed", "--workers=1"]);
  if (r.cleanupFailed) console.log(`\n=== CLEANUP FAILED on the re-run (${r.reason}) ===`);
}
failed += r.testsFailed || r.cleanupFailed ? 1 : 0;
console.log(failed ? `\nREGRESSION FAIL (${failed} stage${failed > 1 ? "s" : ""} failed)` : "\nREGRESSION PASS");
process.exit(failed ? 1 : 0);
