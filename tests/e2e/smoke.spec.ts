import { test, expect } from "@playwright/test";

// Proves the Playwright harness itself is wired correctly (server reachable, browser drives
// real navigation). Intentionally does not assert on org-selector link destinations or auth
// flows — that's the tester agent's job to write and run against this harness.
test("apex page loads and renders the organization selector", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole("heading", { name: "Quotation System" })).toBeVisible();
});
