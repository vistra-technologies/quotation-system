import { defineConfig, devices } from "@playwright/test";
import { loadRegressionEnv } from "./tests/regression/fixtures/env-files";

// Resolved next to this file, falling back to the main checkout, so the suite runs from a git worktree too
// (the git-ignored env files are not checked out there). Fails early naming the files to copy.
loadRegressionEnv(__dirname);

// Target validation (no localhost / production) happens in global-setup via requireEnv().
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "";
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

/** M8: RGR_WORKERS must be a small positive integer — a typo must not silently become NaN / one huge pool. */
function workers(v = process.env.RGR_WORKERS): number {
  if (v === undefined || v === "") return 3;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 8) throw new Error(`RGR_WORKERS must be an integer 1-8, got "${v}"`);
  return n;
}

export default defineConfig({
  testDir: "./tests/regression",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./tests/regression/global-setup.ts",
  globalTeardown: "./tests/regression/global-teardown.ts",
  fullyParallel: false, // files run in parallel (workers), tests inside a file stay ordered
  workers: workers(),
  // M6: each orchestrator pass gets its own output dir (Playwright empties outputDir at start), so the --last-failed
  // re-run cannot delete the first pass's traces/screenshots that the report links to
  outputDir: process.env.RGR_OUTPUT_DIR || "test-results/regression",
  retries: 0, // flake policy: the orchestrator re-runs failures once at --workers=1
  timeout: 90_000,
  reporter: [["list"], ["./tests/regression/report/reporter.ts"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    extraHTTPHeaders: bypass ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" } : {},
  },
  projects: [{ name: "regression", use: { ...devices["Desktop Chrome"] } }],
});
