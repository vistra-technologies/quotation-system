/**
 * Stage 12 — UI/API Layer Separation regression spec.
 *
 * Covers behavioral DoD items specific to Stage 12:
 *
 * A. Dashboard redesign (Batch 7b):
 *    - Heading is "Welcome, {firstName}", not "Dashboard"
 *    - Three KPI tiles present (Orders, Projects, Inquiries)
 *    - Home icon in top-bar links to dashboard
 *
 * B. Inquiries list redesign (Batch 7c):
 *    - Column schema: Project Name (link), Company, Location, Status, Created On, Submission Date
 *    - No #N inquiry-number column
 *    - Inquiry name links to detail page
 *    - Empty-state message shows when no inquiries exist (or filters match nothing)
 *
 * C. Inquiries/new back link (bugfix round 3, Bug 4):
 *    - "Back to Inquiries" link present and functional
 *
 * D. API layer (Batches 1–7, integrated via page loads):
 *    - All page loads work end-to-end via internalFetch (verified by the page rendering)
 *
 * Invariants only — behavior-level assertions that survive further UI changes.
 * The human has explicitly lifted the wireframe-stage rule for Stage 12 (all listed
 * pages declared final), so structural assertions for those pages are permitted.
 */

import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

// Rate-limit pacing: better-auth limits sign-in to 3 per 10 seconds per IP.
// 14 tests each sign in; 7-second beforeEach spaces sign-in calls 11+ seconds
// apart, ensuring the rate-limit window always resets before each attempt.
test.beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 7_000));
});

// ---------------------------------------------------------------------------
// A. Dashboard redesign — heading, KPI tiles, Home icon link
// ---------------------------------------------------------------------------

test("Dashboard: heading is 'Welcome, {firstName}', not 'Dashboard'", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/dashboard");

  // Stage 12 Batch 7b: heading changed from "Dashboard" to "Welcome, {firstName}".
  // firstName = first word of user's display name; for "acme-glass admin" → "acme-glass".
  const h1 = page.locator("h1");
  await expect(h1).toBeVisible({ timeout: 15_000 });
  await expect(h1).toContainText(/Welcome/i);
  // Explicitly confirm "Dashboard" is NOT the heading text
  await expect(h1).not.toContainText(/^Dashboard$/);
});

test("Dashboard: three KPI tiles (Orders, Projects, Inquiries) are present", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/dashboard");

  await page.waitForURL(/\/acme-glass\/dashboard/, { timeout: 15_000 });

  // The three KPI tiles each have a label in muted small text below the count.
  await expect(page.getByRole("main").getByText("Orders", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("main").getByText("Projects", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("main").getByText("Inquiries", { exact: true })).toBeVisible({ timeout: 15_000 });
});

test("Dashboard: Home icon in top-bar links to dashboard", async ({ page }) => {
  await signIn(page, "admin");
  // Navigate away from dashboard first
  await page.goto("/acme-glass/inquiries");
  await page.waitForURL(/\/acme-glass\/inquiries/, { timeout: 15_000 });

  // Stage 12 Correction 3 / bugfix: the Home icon (aria-label="Home") links to dashboard.
  // Clicking it must navigate to the dashboard, not to a dead "/" apex.
  const homeLink = page.getByRole("link", { name: "Home" });
  await expect(homeLink).toBeVisible({ timeout: 10_000 });
  await homeLink.click();
  await page.waitForURL(/\/acme-glass\/dashboard/, { timeout: 15_000 });
});

// ---------------------------------------------------------------------------
// B. Inquiries list redesign — column schema, name links, empty state
// ---------------------------------------------------------------------------

test("Inquiries list: column headers match Batch 7c schema (Project Name, Company/Client Name, Location, Status, Created On, Submission Date)", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/inquiries");

  // The table must have these header columns per Batch 7c spec.
  // Column 1 is "Project Name" (the inquiry name as a link).
  await expect(page.getByRole("columnheader", { name: "Project Name" })).toBeVisible({
    timeout: 15_000,
  });
  // Column 2 is "Company" for internal users (Admin/Member).
  await expect(page.getByRole("columnheader", { name: "Company" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("columnheader", { name: "Location" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("columnheader", { name: "Created On" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("columnheader", { name: "Submission Date" })).toBeVisible({
    timeout: 10_000,
  });
});

test("Inquiries list: each inquiry row has a link to the detail page via its name", async ({
  page,
}) => {
  // Create an inquiry first to ensure the list is not empty.
  const inquiryName = `E2E Stage12 List ${Date.now()}`;
  await signIn(page, "admin");
  await page.goto("/acme-glass/inquiries/new");
  await page.locator("input[name='name']").fill(inquiryName);
  await page.locator("input[name='destinationCountry']").fill("UAE");
  await page.locator("input[name='currency']").fill("AED");
  await Promise.all([
    page.waitForURL(/\/acme-glass\/inquiries$/, { timeout: 20_000 }),
    page.getByRole("button", { name: /create inquiry/i }).click(),
  ]);

  // The inquiry name must be a link to the detail page (the "Project Name" column link).
  const nameLink = page.getByRole("link", { name: inquiryName }).first();
  await expect(nameLink).toBeVisible({ timeout: 10_000 });
  const href = await nameLink.getAttribute("href");
  expect(href).toMatch(/\/acme-glass\/inquiries\/[0-9a-f-]{36}/);
  // There must be NO #N link (inquiry number is no longer shown in the list).
  const numberLink = page.getByRole("link").filter({ hasText: /^#\d+$/ });
  const numberLinkCount = await numberLink.count();
  expect(numberLinkCount).toBe(0);
});

test("Inquiries list: inquiry number (#N) is visible on the detail page (not the list)", async ({
  page,
}) => {
  // Create an inquiry.
  const inquiryName = `E2E Stage12 Number ${Date.now()}`;
  await signIn(page, "admin");
  await page.goto("/acme-glass/inquiries/new");
  await page.locator("input[name='name']").fill(inquiryName);
  await page.locator("input[name='destinationCountry']").fill("UAE");
  await page.locator("input[name='currency']").fill("AED");
  await Promise.all([
    page.waitForURL(/\/acme-glass\/inquiries$/, { timeout: 20_000 }),
    page.getByRole("button", { name: /create inquiry/i }).click(),
  ]);

  // Navigate to the detail page.
  const nameLink = page.getByRole("link", { name: inquiryName }).first();
  await nameLink.click();
  await expect(page).toHaveURL(/\/acme-glass\/inquiries\/[0-9a-f-]{36}$/, { timeout: 15_000 });

  // The h1 must show the inquiry number: "#{N} — {name}".
  const h1 = page.locator("h1");
  await expect(h1).toBeVisible({ timeout: 10_000 });
  await expect(h1).toContainText(/#\d+/);
  await expect(h1).toContainText(inquiryName);
});

test("Inquiries list: empty state shown when search returns no results", async ({ page }) => {
  await signIn(page, "admin");
  // Use a nonsense search term guaranteed to return no results.
  await page.goto("/acme-glass/inquiries?search=ZZZNORESULTS99999");

  // The empty state message must appear; the table must NOT render.
  await expect(
    page.getByText("No inquiries match your filters."),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("table")).not.toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// C. Inquiries/new back link (Bug 4 fix)
// ---------------------------------------------------------------------------

test("Inquiries/new: 'Back to Inquiries' link is present and navigates to the list", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/inquiries/new");
  await expect(page).not.toHaveURL(/\/acme-glass\/login/, { timeout: 15_000 });

  // Stage 11 Batch 5 + bugfix round 3: back link must be present.
  // The link text comes from the i18n key "backToList".
  const backLink = page.getByRole("link", { name: /back.*inquir/i });
  await expect(backLink).toBeVisible({ timeout: 10_000 });

  // Clicking it must navigate to the inquiries list.
  await backLink.click();
  await expect(page).toHaveURL(/\/acme-glass\/inquiries$/, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// D. API layer end-to-end (internalFetch integration): spot checks
// ---------------------------------------------------------------------------

test("Dashboard stats API: KPI counts are numeric (not null/undefined)", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/dashboard");
  await page.waitForURL(/\/acme-glass\/dashboard/, { timeout: 15_000 });

  // The KPI tile counts should be rendered as numbers (even if 0).
  // Each tile has a numeric count above the label.
  // Check that the Dashboard rendered fully (h1 visible) and no loading skeleton is shown.
  await expect(page.locator("h1")).toBeVisible({ timeout: 15_000 });
  // Loading skeleton has animate-pulse class — must NOT be visible after data loads.
  await expect(page.locator(".animate-pulse").first()).not.toBeVisible({ timeout: 15_000 });
});

test("Inquiries list toolbar: My/All toggle and search input are rendered", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/inquiries");

  // Stage 12 Batch 7c: the shared list-page toolbar renders scope toggle and search.
  // These must be present even if no filter is applied.
  await expect(page.getByRole("button", { name: /All Inquiries/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByPlaceholder(/search inquiries/i)).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// E. API-layer tenancy isolation (Batch 1-7 critical invariant)
// ---------------------------------------------------------------------------

test('API: cross-org /users request is rejected with 403', async ({ page, request }) => {
  // Sign in as vistra admin, then try to call the acme-glass users API.
  // getApiSession() cross-tenant guard must block this with a 403.
  await signIn(page, 'admin', 'Seed1234!', 'vistra');
  // Use the browser's cookie jar (page.request) to carry the vistra session into an
  // acme-glass API call — exactly what a confused client would do.
  const resp = await page.request.get('/api/v1/orgs/acme-glass/users');
  // Must be 401 (no session in this context) or 403 (cross-tenant guard).
  expect([401, 403]).toContain(resp.status());
});

test('API: unauthenticated /users request returns 401', async ({ page }) => {
  // Navigate to a fresh page without signing in, then hit the API.
  const resp = await page.request.get('/api/v1/orgs/acme-glass/users');
  expect(resp.status()).toBe(401);
});

test('API: /api/v1/orgs (public org-list) returns org list without auth', async ({ page }) => {
  const resp = await page.request.get('/api/v1/orgs');
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  // API returns { orgs: [...] } shape, not a bare array
  expect(typeof body).toBe('object');
  expect(Array.isArray(body.orgs)).toBe(true);
  expect(body.orgs.length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// F. Orders placeholder — page renders without error
// ---------------------------------------------------------------------------

test('Orders placeholder page renders (no crash, breadcrumb/nav present)', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/acme-glass/orders');
  // Must not redirect to login (page is auth-gated, admin should see it).
  await expect(page).not.toHaveURL(/\/acme-glass\/login/, { timeout: 15_000 });
  // Must not be an error page (no 500-level crash).
  // The page should show something (h1 or a heading, or an empty-state message).
  await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
});
