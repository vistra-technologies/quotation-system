import { test, expect } from "@playwright/test";

// Proves the Playwright harness itself is wired correctly (server reachable, browser drives
// real navigation). Intentionally does not assert on org-selector link destinations or auth
// flows — that's the tester agent's job to write and run against this harness.
//
// Stage 28 (Batch 2): the apex is now the show-only landing page (no org selector),
// so the readiness signal is the hero <h1>.
test("apex page loads and renders the landing page", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("made easy");
});
