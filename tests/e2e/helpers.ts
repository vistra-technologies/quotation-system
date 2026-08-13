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
 *
 * Stage 10 (Task 1.4): login page rebuilt to match login-page.html mockup.
 * The username field label changed from "Username" to "User ID" (matching the
 * mockup's <label for="userId">User ID</label>).  The heading guard was
 * replaced with an input visibility check (more robust post-rebuild).
 */
/**
 * Fill the Stage 14 required fields shared by both the inquiry create form
 * and the project create form (identical field names on both).
 *
 * Stage 14 Batch B/C added 8 required end-client fields, made `currency` a
 * `<select>`, made `projectLocation` required, and removed `destinationCountry`
 * entirely.  All specs that submit either form must call this helper (or
 * equivalent inline fills) after filling the `name` field.
 *
 * `submissionDate` has a `defaultValue={todayLocal}` pre-fill — no fill needed.
 *
 * @param currency  INR | AED | USD — defaults to "AED"
 * @param projectLocation  String shown on the detail page — defaults to "Dubai, UAE"
 */
export async function fillCreateFormRequiredFields(
  page: Page,
  currency: "INR" | "AED" | "USD" = "AED",
  projectLocation = "Dubai, UAE",
) {
  await page.locator("select[name='currency']").selectOption(currency);
  await page.locator("input[name='projectLocation']").fill(projectLocation);
  await page.locator("input[name='endClientName']").fill("E2E Client");
  await page.locator("input[name='endClientPhone']").fill("+971501234567");
  await page.locator("input[name='endClientEmail']").fill("e2e@test.com");
  // GST Number is conditionally required when the linked company is India (D20).
  // Always fill it so the helper works regardless of the company's country in the
  // live dev DB. The field accepts any text; it is optional when isIndia=false.
  await page.locator("input[name='endClientGstNumber']").fill("29AAACC1206H1ZY");
  await page.locator("input[name='endClientAddressLine1']").fill("123 Test St");
  await page.locator("input[name='endClientAddressLine2']").fill("Test Area");
  await page.locator("input[name='endClientCity']").fill("Dubai");
  await page.locator("input[name='endClientState']").fill("Dubai");
}

export async function signIn(
  page: Page,
  username: string,
  password = process.env.TEST_ADMIN_PASSWORD ?? "Seed1234!",
  orgSlug = "acme-glass",
) {
  await page.goto(`/${orgSlug}/login`);
  // Wait for the login form to be ready (user-id input rendered) before
  // filling credentials.  The input's autocomplete="username" attribute is
  // the stable anchor regardless of label text.
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByLabel("User ID").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /Sign in/i }).click();
  await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`), { timeout: 30_000 });
}
