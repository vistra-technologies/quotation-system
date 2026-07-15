import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Sign in as a specific user for a given org.
 *
 * Reads the password from the TEST_ADMIN_PASSWORD env var when username is
 * "admin" (so the test suite keeps working if the admin password is rotated
 * without editing source), then falls back to the seeded default.
 *
 * Extracted from pricing-stage3.spec.ts:38-54 so Stage 4+ specs can share it.
 */
export async function signIn(
  page: Page,
  username: string,
  password = process.env.TEST_ADMIN_PASSWORD ?? "Seed1234!",
  orgSlug = "acme-glass",
) {
  await page.goto(`/${orgSlug}/login`);
  await expect(page.getByRole("heading", { name: /Sign in to/i })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /Sign in/i }).click();
  await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`), { timeout: 30_000 });
}
