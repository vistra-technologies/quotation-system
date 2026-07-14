/**
 * Stage 3 — Pricing management regression spec.
 *
 * Covers the two DoD items deferred from the developer's verification pass:
 *   a. Wrong-role RBAC redirect — distributor and architect roles hit /{orgSlug}/pricing
 *      and must be redirected to /{orgSlug}/dashboard (never see the pricing UI).
 *   b. Pricing CRUD round-trip — a company member (MANAGE_PRICING) can set a new
 *      ItemPrice, update it, and delete it through the UI; each step persists correctly.
 *
 * Uses seeded credentials (password "Seed1234!" for all users, org "acme-glass").
 *
 * Note on streaming redirects: Next.js App Router server-side redirects inside RSC
 * streaming cause the browser to receive a partial response that is then aborted as
 * the 307 Location header follows. Playwright's page.goto() with waitUntil:"load"
 * throws net::ERR_ABORTED in this case. We use waitUntil:"commit" only for pages
 * that are expected to redirect (pricing for wrong-role), and the default "load"
 * for pages where we need the JS to run (login form, etc).
 *
 * Note on parallelism: these tests run serial (mode:"serial") because the local dev
 * server (Turbopack, slow-filesystem) fails under 5+ concurrent first-compile requests.
 * On a deployed preview (PLAYWRIGHT_BASE_URL=...) parallel execution is fine; add a
 * separate playwright project config to re-enable it when targeting Vercel.
 */

import { test, expect } from "@playwright/test";

// Run this file serially — the dev server cannot handle 5 concurrent cold-compile
// requests without saturating. Individual tests complete well within timeout.
test.describe.configure({ mode: "serial" });

// Increase per-test timeout — sign-in involves JS hydration + auth API round-trip
// on a Neon cloud DB, which can run 5-15 s on the local network path.
test.setTimeout(90_000);

// ---------------------------------------------------------------------------
// Helper: sign in as a specific user on acme-glass
// ---------------------------------------------------------------------------
async function signIn(
  page: import("@playwright/test").Page,
  username: string,
  password = "Seed1234!",
  orgSlug = "acme-glass",
) {
  // Use default waitUntil:"load" so the login form's JS hydrates before we interact
  await page.goto(`/${orgSlug}/login`);
  await expect(page.getByRole("heading", { name: /Sign in to/i })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /Sign in/i }).click();
  // Wait for redirect to dashboard after successful login
  await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`), { timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// RBAC: distributor (no MANAGE_PRICING) → /pricing → redirect to /dashboard
// ---------------------------------------------------------------------------
test("distributor role is redirected away from /pricing to /dashboard", async ({
  page,
}) => {
  await signIn(page, "distributor");

  // Navigate to pricing page — expect server-side redirect to dashboard.
  // Use waitUntil:"commit" to handle the streaming redirect gracefully;
  // some Next.js streaming redirects cause net::ERR_ABORTED before load completes.
  try {
    await page.goto("/acme-glass/pricing", { waitUntil: "commit" });
  } catch {
    // ERR_ABORTED is expected when Next.js streaming redirect fires — the
    // browser follows the 307 Location header automatically.
  }

  // Must land on dashboard — not the pricing page
  await page.waitForURL(/\/acme-glass\/dashboard/, { timeout: 20_000 });

  // Pricing table heading must NOT be visible
  await expect(page.getByRole("heading", { name: "Pricing Management" })).not.toBeVisible();
  // Dashboard heading MUST be visible
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

// ---------------------------------------------------------------------------
// RBAC: architect role (no MANAGE_PRICING) → /pricing → redirect to /dashboard
// ---------------------------------------------------------------------------
test("architect role is redirected away from /pricing to /dashboard", async ({
  page,
}) => {
  await signIn(page, "architect");

  try {
    await page.goto("/acme-glass/pricing", { waitUntil: "commit" });
  } catch {
    // Streaming redirect abort — handled via waitForURL below
  }

  await page.waitForURL(/\/acme-glass\/dashboard/, { timeout: 20_000 });

  await expect(page.getByRole("heading", { name: "Pricing Management" })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

// ---------------------------------------------------------------------------
// RBAC: unauthorized direct navigation to pricing item edit must redirect to dashboard
// ---------------------------------------------------------------------------
test("unauthorized direct navigation to pricing item edit page redirects to dashboard", async ({
  page,
}) => {
  // Sign in as distributor (no MANAGE_PRICING)
  await signIn(page, "distributor");

  // Navigate directly to a pricing item edit URL
  try {
    await page.goto("/acme-glass/pricing/some-fake-item-id", { waitUntil: "commit" });
  } catch {
    // Streaming redirect abort
  }

  // Must redirect to dashboard (RBAC gate fires before item lookup)
  await page.waitForURL(/\/acme-glass\/dashboard/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Pricing CRUD round-trip — company member (MANAGE_PRICING)
// ---------------------------------------------------------------------------
test("company member can add, update, and delete an ItemPrice via the UI", async ({
  page,
}) => {
  const orgSlug = "acme-glass";
  const testCurrency = "EUR";
  const initialPrice = "50.00";
  const updatedPrice = "75.00";

  // Sign in as company member (MANAGE_PRICING)
  await signIn(page, "member", "Seed1234!", orgSlug);

  // Navigate to the pricing list (member has MANAGE_PRICING, no redirect expected)
  await page.goto(`/${orgSlug}/pricing`);
  await expect(page.getByRole("heading", { name: "Pricing Management" })).toBeVisible({
    timeout: 30_000,
  });

  // Click "Edit Prices" on the first catalog item in the list
  const firstEditLink = page.getByRole("link", { name: "Edit Prices" }).first();
  await expect(firstEditLink).toBeVisible({ timeout: 10_000 });
  await firstEditLink.click();

  // Confirm we're on the edit page
  await expect(page.getByRole("heading", { name: "Edit Prices" })).toBeVisible({
    timeout: 30_000,
  });

  // ── Clean up any stale EUR price from a previous test run ─────────────────
  const existingEurRow = page.locator("li").filter({ hasText: testCurrency });
  if (await existingEurRow.count() > 0) {
    const deleteBtn = existingEurRow.getByRole("button", { name: "Delete" });
    await deleteBtn.click();
    await page.waitForLoadState("networkidle");
  }

  // ── Step 1: Add a new price (EUR: 50.00) ──────────────────────────────────
  await page.getByLabel("Currency").fill(testCurrency);
  await page.getByLabel("Price").fill(initialPrice);
  await page.getByRole("button", { name: "Save" }).click();

  // Wait for the page to revalidate and show the new price
  await page.waitForLoadState("networkidle");
  const newPriceRow = page.locator("li").filter({ hasText: testCurrency });
  await expect(newPriceRow).toBeVisible({ timeout: 15_000 });
  await expect(newPriceRow).toContainText(initialPrice);

  // ── Step 2: Update the price (upsert EUR to 75.00) ────────────────────────
  await page.getByLabel("Currency").fill(testCurrency);
  await page.getByLabel("Price").fill(updatedPrice);
  await page.getByRole("button", { name: "Save" }).click();

  await page.waitForLoadState("networkidle");
  const updatedPriceRow = page.locator("li").filter({ hasText: testCurrency });
  await expect(updatedPriceRow).toBeVisible({ timeout: 15_000 });
  await expect(updatedPriceRow).toContainText(updatedPrice);
  // Old value must no longer appear in the EUR row
  await expect(updatedPriceRow).not.toContainText(initialPrice);

  // ── Step 3: Delete the EUR price ──────────────────────────────────────────
  const deleteButton = updatedPriceRow.getByRole("button", { name: "Delete" });
  await deleteButton.click();

  // Wait for revalidation — the EUR row must disappear
  await page.waitForLoadState("networkidle");
  await expect(page.locator("li").filter({ hasText: testCurrency })).not.toBeVisible({
    timeout: 20_000,
  });
});

// ---------------------------------------------------------------------------
// Stage 2 regression smoke: admin login + dashboard still work after Stage 3 migration
// ---------------------------------------------------------------------------
test("stage-2 regression: admin login and dashboard still work after Stage 3 migration", async ({
  page,
}) => {
  await signIn(page, "admin");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  // Username visible on dashboard
  const usernameLocator = page.locator("dt", { hasText: "Username" }).locator("+ dd");
  await expect(usernameLocator).toHaveText("admin");
});
