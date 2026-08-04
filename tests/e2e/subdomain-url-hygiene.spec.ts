/**
 * Subdomain URL-hygiene regression spec (Stage 11 — Part A, Batch 3).
 *
 * Guards against the doubled-org-segment bug fixed in Stage 11:
 * before Part A, every internal link/redirect hardcoded `/${orgSlug}/...`,
 * so on a subdomain host (vistra.easeetool.com) the browser saw
 * `vistra.easeetool.com/vistra/dashboard` instead of
 * `vistra.easeetool.com/dashboard`.
 *
 * Why this spec targets the *.vercel.app hash URL (via PLAYWRIGHT_BASE_URL),
 * NOT the custom domain:
 *   - lib/auth.ts trustedOrigins includes process.env.VERCEL_URL (the per-build
 *     hash URL) — better-auth silently rejects auth requests from any other
 *     origin, including the branch-alias URL and the custom domain.
 *   - Known better-auth gap documented in Stage 10's Execution Log.
 *
 * On a *.vercel.app hash URL, `useOrgHref` runs in path-based fallback mode
 * (hostname does not match *.easeetool.com), so the correct behavior is:
 *   - After login:   URL is /{orgSlug}/dashboard (no doubling)
 *   - After nav:     URL is /{orgSlug}/<section>  (no doubling)
 *   - After logout:  URL is /{orgSlug}/login       (no doubling)
 *   - After server redirect: URL is /{orgSlug}/login (no doubling)
 *
 * All assertions are on page.url() — behavior-level, valid under the
 * workspace's wireframe-stage testing rule (CLAUDE.md §5).
 *
 * The full spec (including subdomain-mode assertions) runs in the
 * end-of-stage regression pass once all 9 batches are merged and the build
 * is deployed to staging.
 *
 * Runnable as:
 *   PLAYWRIGHT_BASE_URL=https://quotation-system-<hash>-vistra-indias-projects.vercel.app \
 *   VERCEL_AUTOMATION_BYPASS_SECRET=<secret> \
 *   npx playwright test subdomain-url-hygiene
 */

import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

// Run serially — auth round-trip tests share better-auth's per-IP rate limiter.
test.describe.configure({ mode: "serial" });

const ORG = "vistra";

// ---------------------------------------------------------------------------
// 1.  After login, URL has no doubled org segment
// ---------------------------------------------------------------------------
test("after login, post-redirect URL has no doubled org segment", async ({
  page,
}) => {
  // signIn navigates to /{orgSlug}/login, fills credentials, and waits for
  // the /{orgSlug}/dashboard URL (path-based, via PLAYWRIGHT_BASE_URL).
  await signIn(page, "admin", undefined, ORG);

  const url = page.url();
  // Must land on dashboard
  expect(url).toMatch(new RegExp(`/${ORG}/dashboard`));
  // Must NOT have a doubled segment (e.g. /vistra/vistra/dashboard)
  expect(url).not.toMatch(new RegExp(`/${ORG}/${ORG}`));
});

// ---------------------------------------------------------------------------
// 2.  Sidebar nav clicks produce clean URLs (no doubled segment)
// ---------------------------------------------------------------------------
test("sidebar nav links produce clean URLs", async ({ page }) => {
  await signIn(page, "admin", undefined, ORG);

  // Click "Inquiries" in the sidebar nav
  await page.getByRole("link", { name: "Inquiries" }).click();
  await page.waitForURL(new RegExp(`/${ORG}/inquiries`), { timeout: 15_000 });
  let url = page.url();
  expect(url).toMatch(new RegExp(`/${ORG}/inquiries`));
  expect(url).not.toMatch(new RegExp(`/${ORG}/${ORG}`));

  // Click "Projects"
  await page.getByRole("link", { name: "Projects" }).click();
  await page.waitForURL(new RegExp(`/${ORG}/projects`), { timeout: 15_000 });
  url = page.url();
  expect(url).toMatch(new RegExp(`/${ORG}/projects`));
  expect(url).not.toMatch(new RegExp(`/${ORG}/${ORG}`));

  // Click "Home" icon (top-bar Home link → dashboard)
  await page.getByRole("link", { name: "Home" }).click();
  await page.waitForURL(new RegExp(`/${ORG}/dashboard`), { timeout: 15_000 });
  url = page.url();
  expect(url).toMatch(new RegExp(`/${ORG}/dashboard`));
  expect(url).not.toMatch(new RegExp(`/${ORG}/${ORG}`));
});

// ---------------------------------------------------------------------------
// 3.  Logout redirects to clean login URL (no doubled segment)
// ---------------------------------------------------------------------------
test("logout produces clean login URL", async ({ page }) => {
  await signIn(page, "admin", undefined, ORG);

  // Open profile dropdown then click Log Out
  await page.getByRole("button", { name: "Profile" }).click();
  await page.getByRole("button", { name: /Log Out/i }).click();

  await page.waitForURL(new RegExp(`/${ORG}/login`), { timeout: 15_000 });
  const url = page.url();
  expect(url).toMatch(new RegExp(`/${ORG}/login`));
  expect(url).not.toMatch(new RegExp(`/${ORG}/${ORG}`));
});

// ---------------------------------------------------------------------------
// 4.  Server redirect (unauthenticated access) produces clean URL
// ---------------------------------------------------------------------------
test("server redirect from unauthenticated access produces clean URL", async ({
  page,
}) => {
  // Fresh context, no session cookie.
  // lib/data/session.ts calls orgHref(orgSlug, "/login") and redirect()s.
  // Before Part A, this would produce /{orgSlug}/login in path-based mode and
  // /login on a subdomain host (after the fix). On *.vercel.app the fix keeps
  // it at /{orgSlug}/login — no doubling either way.
  await page.goto(`/${ORG}/dashboard`);
  await page.waitForURL(new RegExp(`/${ORG}/login`), { timeout: 15_000 });

  const url = page.url();
  expect(url).toMatch(new RegExp(`/${ORG}/login`));
  expect(url).not.toMatch(new RegExp(`/${ORG}/${ORG}`));
  // Login form must be visible — confirms the redirect landed on the right page
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({
    timeout: 5_000,
  });
});
