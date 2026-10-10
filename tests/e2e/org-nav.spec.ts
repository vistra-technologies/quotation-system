/**
 * Org-navigation regression spec (Items 7, 9, 11, 12).
 *
 * Exercises the real-browser flows that prior curl-only passes could not reach:
 *   - Apex landing page carries no org links / no localhost hardcode (Stage 28 B2)
 *   - Path-based org routing: known slug → login page, unknown slug → 404
 *   - Full sign-in → dashboard → sign-out flow
 *   - Cross-org session-replay guard (path-based routing, shared cookie jar)
 *
 * Run against the stable preview deployment (staging):
 *   PLAYWRIGHT_BASE_URL=https://test.easeetool.com \
 *   VERCEL_AUTOMATION_BYPASS_SECRET=<secret> \
 *   npx playwright test org-nav
 * Production domain (Stage 10+): {orgSlug}.easeetool.com — subdomain-routed.
 * Local runs use the localhost path-based fallback in proxy.ts; no *.localhost DNS needed.
 *
 * When VERCEL_AUTOMATION_BYPASS_SECRET is set, playwright.config.ts injects
 * x-vercel-protection-bypass and x-vercel-set-bypass-cookie headers on every
 * request so Vercel's SSO wall is bypassed without repeated header injection.
 *
 * Stage 28 (Batch 2): the apex page is now a show-only marketing landing — the
 * org selector (and its "Select your organization" heading) is gone, so the
 * org-link tests below were rewritten: the full flow starts from the org's own
 * login URL, and the apex is asserted to expose no org/localhost links at all.
 * Stage 12 update: the dashboard was redesigned in Stage 12
 * (Batch 7b): heading is now "Welcome, {firstName}", not "Dashboard";
 * the dt/dd identity block is gone; KPI tiles replace it. Sign out is now
 * Profile (icon button) → "Log Out" dropdown item.
 */

import { test, expect } from "@playwright/test";
import { orgUrl, orgUrlPattern, apiSignIn } from "./helpers";

// Run this file serially — auth-flow tests are flaky under concurrent Turbopack
// compilation load on local dev. (On a pre-built Vercel preview this is not needed,
// but serial is safe everywhere.)
test.describe.configure({ mode: "serial" });

// ---------------------------------------------------------------------------
// Item 12-a  The apex page must not point anywhere at localhost, and (Stage 28
// B2) carries no org links at all — every link is an in-page "#" anchor.
// ---------------------------------------------------------------------------
test("apex landing has no org links and no localhost hrefs", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("made easy");

  const hrefs = await page
    .locator("a[href]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) {
    expect(href, `apex link "${href}" must be an in-page anchor`).toMatch(/^#/);
    expect(href).not.toContain("localhost");
  }
});

// ---------------------------------------------------------------------------
// Item 12-b  Clicking an apex nav tab stays on the deployed origin (in-page
// scroll, no navigation away, never localhost).
// ---------------------------------------------------------------------------
test("clicking an apex nav tab stays on the same origin", async ({ page, baseURL }) => {
  await page.goto("/");
  const before = new URL(page.url()).origin;
  await page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: "About us" })
    .click();
  await expect(page).toHaveURL(/#about$/);
  const after = new URL(page.url());
  expect(after.origin).toBe(before);
  if (baseURL && !baseURL.includes("localhost")) {
    expect(after.hostname).not.toBe("localhost");
  }
});

// ---------------------------------------------------------------------------
// Item 9 (path-based)  Unknown org slug → 404 JSON from proxy
// ---------------------------------------------------------------------------
test("unknown org slug in URL returns 404", async ({ page }) => {
  // The proxy checks the first path segment against the DB on every org-scoped
  // request.  An unrecognised slug must return 404 — not a login redirect or 200.
  // In subdomain mode, an unknown org subdomain is used; in path mode a path-based URL.
  // Both proxy branches return 404 for unrecognised org slugs.
  const response = await page.goto(orgUrl("nonexistent-org-slug", "/login"), {
    waitUntil: "commit",
  });

  expect(response?.status()).toBe(404);

  // The proxy returns a JSON error body.
  // Loosen to a case-insensitive regex: path-based mode returns "Organization not found"
  // while the apex-domain non-root-path guard returns the shorter "Not found" — both are
  // correct 404 responses and both must pass this test.
  const body = await response?.text();
  expect(body).toMatch(/not found/i);
});

// ---------------------------------------------------------------------------
// Item 9 / 11 (path-based)  Known org slug, unauthenticated → login page
// ---------------------------------------------------------------------------
test("unauthenticated request to /{orgSlug}/dashboard redirects to /{orgSlug}/login", async ({
  page,
}) => {
  // Open in a fresh context with no session cookies.
  // The Server Component calls getSession() → null (no cookie) → redirect.
  const response = await page.goto(orgUrl("vistra", "/dashboard"));

  // After following redirects, we must be on the login page
  expect(page.url()).toMatch(orgUrlPattern("vistra", "/login"));

  // The login form must be visible — Stage 10 removed the "Sign in to" heading;
  // the autocomplete="username" input is the stable anchor post-rebuild.
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();

  // The response chain must have included a redirect (not a 200 straight through)
  // Playwright follows redirects automatically; final response is 200 on the login page.
  expect(response?.ok()).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Item 12 (full flow)  Org login → sign in → dashboard → sign out
// ---------------------------------------------------------------------------
test("full flow: org login → sign in → dashboard → sign out", async ({
  page,
}) => {
  // Step 1: Open the org's own login URL. Stage 28 B2: the apex no longer lists
  // orgs, so users reach their login directly at {orgSlug}.easeetool.com.
  const orgSlug = "vistra";
  await page.goto(orgUrl(orgSlug, "/login"));

  // Stage 10 removed the "Sign in to" heading — wait for the form input instead.
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({
    timeout: 5_000,
  });
  await expect(page).toHaveURL(/\/login/);

  // Step 4: Sign in with the org's admin credentials
  // Stage 10: label renamed "Username" → "User ID"; "Password" needs exact match
  // to avoid ambiguity with the aria-label on the password-reveal toggle button.
  await page.getByLabel("User ID").fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("Seed1234!");
  await page.getByRole("button", { name: /Sign in/i }).click();

  // Step 5: Dashboard must render
  // Stage 12 Batch 7b: heading is "Welcome, {firstName}" (first word of display name).
  // No username/org/role dt/dd block — replaced by KPI tiles.
  // Checking h1 is visible is sufficient to confirm the dashboard rendered.
  await page.waitForURL(orgUrlPattern(orgSlug, "/dashboard"), {
    timeout: 10_000,
  });
  await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });

  // Step 6: Sign out and confirm redirect back to login page.
  // Stage 11 Batch 8 / Stage 12: sign-out is a Profile icon → "Log Out" dropdown item.
  await page.getByRole("button", { name: "Profile" }).click();
  await page.getByRole("button", { name: /Log Out/i }).click();
  await page.waitForURL(orgUrlPattern(orgSlug, "/login"), { timeout: 10_000 });
  // Stage 10: "Sign in to" heading gone — form input is the stable readiness signal.
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({
    timeout: 5_000,
  });
});

// ---------------------------------------------------------------------------
// Item 7  Cross-org session-replay guard (path-based)
// ---------------------------------------------------------------------------
test("cross-org session replay: vistra session rejected on acme-glass dashboard", async ({
  page,
}) => {
  // Sign in as vistra admin
  await page.goto(orgUrl("vistra", "/login"));
  // Stage 10: "Sign in to" heading gone — wait for the form input instead.
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
  // Stage 10: label renamed "Username" → "User ID"; exact match on "Password" to
  // avoid ambiguity with the password-reveal toggle's aria-label.
  await page.getByLabel("User ID").fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("Seed1234!");
  await page.getByRole("button", { name: /Sign in/i }).click();

  // Confirm we're on vistra dashboard
  // Stage 12 Batch 7b: heading is "Welcome, {firstName}", not "Dashboard".
  await page.waitForURL(orgUrlPattern("vistra", "/dashboard"), { timeout: 10_000 });
  await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });

  // Now navigate to a DIFFERENT org's dashboard using the same session cookie.
  // The cross-org guard in lib/session.ts checks x-org-id (injected by proxy
  // from the URL path segment) against session.organizationId.  Mismatch → null
  // session → redirect to /{orgSlug}/login.
  await page.goto(orgUrl("acme-glass", "/dashboard"));

  // Must redirect to acme-glass login — NOT render the dashboard with vistra's data.
  // Stage 4 changed this path: a cross-org session now renders CrossOrgNotice
  // (heading: "You're already signed in"), not the plain login form.
  await page.waitForURL(orgUrlPattern("acme-glass", "/login"), { timeout: 10_000 });
  await expect(
    page.getByRole("heading", { name: /already signed in/i }),
  ).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// Revoked/expired session in an open tab: a client-side nav that lands on
// /login must show the bare login page — no sidebar/top bar left over from the
// old session (hotfix 2026-10-02, stale-shell-on-logout). Spends one real sign-in.
// ---------------------------------------------------------------------------
test("stale session: nav click lands on a bare login page, no sidebar", async ({ page }) => {
  await apiSignIn(page, "acme-glass", "admin");
  await page.goto(orgUrl("acme-glass", "/dashboard"));
  await expect(page.getByRole("link", { name: "Inquiries" })).toBeVisible({ timeout: 30_000 });

  // Simulate another login revoking this session: the cookie no longer authenticates.
  await page.context().clearCookies();

  await page.getByRole("link", { name: "Inquiries" }).click();
  await page.waitForURL(orgUrlPattern("acme-glass", "/login"), { timeout: 30_000 });

  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 30_000 });
  // The shell is gone: no sidebar nav links.
  await expect(page.getByRole("link", { name: "Projects" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Inquiries" })).toHaveCount(0);
});
