import { defineConfig, devices } from "@playwright/test";
import { config as dotenv } from "dotenv";

dotenv({ path: ".env.playwright.local", quiet: true });

// Target validation (no localhost / production) happens in global-setup via requireEnv().
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "";
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "./tests/regression",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./tests/regression/global-setup.ts",
  globalTeardown: "./tests/regression/global-teardown.ts",
  fullyParallel: false, // files run in parallel (workers), tests inside a file stay ordered
  workers: Number(process.env.RGR_WORKERS ?? 3),
  retries: 0, // flake policy: the orchestrator re-runs failures once at --workers=1
  timeout: 90_000,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    extraHTTPHeaders: bypass ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" } : {},
  },
  projects: [{ name: "regression", use: { ...devices["Desktop Chrome"] } }],
});
