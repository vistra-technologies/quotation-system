/**
 * Stage 25 Batch 6 — Inventory management RBAC regression spec.
 *
 * Replaces pricing-stage3.spec.ts (deleted in Stage 25 B6 — S25-4/S25-7).
 * The /pricing route is gone; this spec covers the renamed /inventory route.
 *
 * Covers:
 *   a. Wrong-role RBAC redirect — distributor and architect roles hit /{orgSlug}/inventory
 *      and must be redirected to /{orgSlug}/dashboard (never see the inventory UI).
 *   b. Authorized user — company member (MANAGE_PRICING) sees /inventory list with the
 *      correct "Inventory Management" heading.
 *
 * Note: the ItemPrice CRUD round-trip test from the old pricing-stage3 spec is NOT
 * replaced here — the prices sub-page and price UI were removed in S25-7.
 * Inventory item CRUD will be covered by Batches 7–8 tests once those routes exist.
 *
 * Uses seeded credentials (password "Seed1234!" for all users, org "acme-glass").
 *
 * Note on streaming redirects: Next.js App Router server-side redirects inside RSC
 * streaming cause the browser to receive a partial response that is then aborted as
 * the 307 Location header follows. Playwright's page.goto() with waitUntil:"load"
 * throws net::ERR_ABORTED in this case. We use waitUntil:"commit" only for pages
 * that are expected to redirect (/inventory for wrong-role), and the default "load"
 * for pages where we need the JS to run (login form, etc).
 */

import { test, expect } from "@playwright/test";
import { orgUrl, orgUrlPattern } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

// Rate-limit pacing: better-auth limits sign-in to 3 per 10 seconds per IP.
test.beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 7_000));
});

// ---------------------------------------------------------------------------
// Helper: sign in as a specific user on acme-glass
// ---------------------------------------------------------------------------
async function signIn(
  page: import("@playwright/test").Page,
  username: string,
  password = "Seed1234!",
  orgSlug = "acme-glass",
) {
  await page.goto(orgUrl(orgSlug, "/login"));
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByLabel("User ID").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /Sign in/i }).click();
  await page.waitForURL(orgUrlPattern(orgSlug, "/dashboard"), { timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// RBAC: distributor (no MANAGE_PRICING) → /inventory → redirect to /dashboard
// ---------------------------------------------------------------------------
test("distributor role is redirected away from /inventory to /dashboard", async ({
  page,
}) => {
  await signIn(page, "distributor");

  try {
    await page.goto(orgUrl("acme-glass", "/inventory"), { waitUntil: "commit" });
  } catch {
    // ERR_ABORTED is expected when Next.js streaming redirect fires.
  }

  await page.waitForURL(orgUrlPattern("acme-glass", "/dashboard"), { timeout: 20_000 });

  // Inventory Management heading must NOT be visible
  await expect(
    page.getByRole("heading", { name: "Inventory Management" }),
  ).not.toBeVisible();
  // Dashboard heading MUST be visible
  await expect(page.locator("h1")).toContainText(/Welcome/i, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// RBAC: architect role (no MANAGE_PRICING) → /inventory → redirect to /dashboard
// ---------------------------------------------------------------------------
test("architect role is redirected away from /inventory to /dashboard", async ({
  page,
}) => {
  await signIn(page, "architect");

  try {
    await page.goto(orgUrl("acme-glass", "/inventory"), { waitUntil: "commit" });
  } catch {
    // Streaming redirect abort — handled via waitForURL below.
  }

  await page.waitForURL(orgUrlPattern("acme-glass", "/dashboard"), { timeout: 20_000 });

  await expect(
    page.getByRole("heading", { name: "Inventory Management" }),
  ).not.toBeVisible();
  await expect(page.locator("h1")).toContainText(/Welcome/i, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Authorized: company member (MANAGE_PRICING) sees /inventory list
// ---------------------------------------------------------------------------
test("company member can view /inventory list page (Inventory Management heading)", async ({
  page,
}) => {
  await signIn(page, "member");

  await page.goto(orgUrl("acme-glass", "/inventory"));
  await expect(
    page.getByRole("heading", { name: "Inventory Management" }),
  ).toBeVisible({ timeout: 30_000 });

  // Table heading should say "Inventory Items" (S25-6 rename)
  await expect(page.getByRole("heading", { name: "Inventory Items" })).toBeVisible({
    timeout: 10_000,
  });

  // No "Edit Prices" links — price UI removed in S25-7
  await expect(page.getByRole("link", { name: /Edit Prices/i })).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// Stage 2 regression smoke: admin login + dashboard still work
// ---------------------------------------------------------------------------
test("stage-2 regression: admin login and dashboard still work", async ({
  page,
}) => {
  await signIn(page, "admin");
  await expect(page.locator("h1")).toContainText(/Welcome/i, { timeout: 10_000 });
});
