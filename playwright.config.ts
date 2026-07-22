import { defineConfig, devices } from "@playwright/test";
import { config as dotenvConfig } from "dotenv";

// Load local .env.playwright.local if present — allows setting
// VERCEL_AUTOMATION_BYPASS_SECRET locally without committing it.
dotenvConfig({ path: ".env.playwright.local" });

// UI testing mechanism for the QA/tester agent (engineering:tester / engineering:regression).
// Target is switchable so the same suite runs against local dev or a deployed environment:
//   PLAYWRIGHT_BASE_URL=https://v-quote-test.vercel.app npx playwright test   (staging)
// Production domain (Stage 10+): {orgSlug}.easeetool.com — subdomain-routed.
// Local dev always uses the localhost path-based fallback in proxy.ts — no *.localhost DNS needed.
// Default targets local dev — bring up `npm run dev` first (see AGENTS.md/CLAUDE.md),
// or let the `webServer` block below start it for you.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Vercel automation bypass — allows Playwright to reach deployments protected by
// Vercel SSO.  Set VERCEL_AUTOMATION_BYPASS_SECRET (available via `vercel env pull`)
// or in .env.playwright.local (gitignored).
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const extraHTTPHeaders: Record<string, string> = bypassSecret
  ? {
      "x-vercel-protection-bypass": bypassSecret,
      // Causes Vercel to set a bypass cookie so subsequent navigations within
      // the same browser context stay bypassed without repeating the header.
      "x-vercel-set-bypass-cookie": "true",
    }
  : {};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    extraHTTPHeaders,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Only auto-start a local server when targeting localhost — never spawn a server when
  // PLAYWRIGHT_BASE_URL points at a deployed environment.
  webServer: baseURL.includes("localhost")
    ? {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 60_000,
      }
    : undefined,
});
