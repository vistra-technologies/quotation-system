/**
 * Subdomain-routing regression spec (Stage 10 — Workstream 3).
 *
 * Exercises the live *.test.easeetool.com domain directly using absolute URLs in
 * page.goto() — does NOT rely on baseURL for the subdomain tests, so this spec
 * works correctly when PLAYWRIGHT_BASE_URL is the deployment's own hash URL
 * (e.g. quotation-system-naez08mu4-vistra-indias-projects.vercel.app).
 *
 * Why not use baseURL for subdomain tests:
 *   - The staging deployment's own *.vercel.app hash URL does NOT have the custom
 *     domain aliased (only the staging branch alias has test.easeetool.com).
 *   - lib/auth.ts trustedOrigins only includes process.env.VERCEL_URL (the per-build
 *     hash URL) and *.easeetool.com — not the stable git-branch-alias URL — so
 *     better-auth silently rejects auth requests via the branch alias.
 *   - Absolute URLs pointing at test.easeetool.com always resolve to the staging
 *     deployment (branch alias is permanent on the staging branch).
 *
 * Runnable as:
 *   PLAYWRIGHT_BASE_URL=https://quotation-system-<hash>-vistra-indias-projects.vercel.app \
 *   VERCEL_AUTOMATION_BYPASS_SECRET=<secret> \
 *   npx playwright test subdomain-routing
 *
 * Added: Stage 10 re-test pass (bugs-2.md recommended coverage §1).
 */

import { test, expect } from "@playwright/test";

// Run serially — auth round-trip tests share better-auth's per-IP rate limiter
// (3 sign-in POSTs per 10s window); concurrency makes rate-limit hits non-deterministic.
test.describe.configure({ mode: "serial" });

// Fixed subdomain targets — always hit the live staging domain aliases, regardless
// of PLAYWRIGHT_BASE_URL.  These are stable: test.easeetool.com and its subdomains
// are permanently aliased to the staging branch in Vercel.
const APEX = "https://test.easeetool.com";
const VISTRA_LOGIN = "https://vistra.test.easeetool.com/login";
const VISTRA_DASHBOARD = "https://vistra.test.easeetool.com/dashboard";
const VISTRA_ROOT = "https://vistra.test.easeetool.com/";
const UNKNOWN_ORG_ROOT = "https://nope.test.easeetool.com/";
const APEX_NON_ROOT = "https://test.easeetool.com/nonexistent-org/login";

// ---------------------------------------------------------------------------
// 1.  Apex root → 200 with EaseeTool heading
// ---------------------------------------------------------------------------
test("test.easeetool.com/ → 200 with EaseeTool heading", async ({ page }) => {
  const response = await page.goto(APEX, { waitUntil: "commit" });
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "EaseeTool" })).toBeVisible();
});

// ---------------------------------------------------------------------------
// 2.  Apex root org links emit subdomain hrefs (BUG-1 regression guard)
// ---------------------------------------------------------------------------
test("test.easeetool.com/ org links point at org subdomains, not path-based URLs", async ({
  page,
}) => {
  await page.goto(APEX);
  await expect(page.getByRole("heading", { name: "EaseeTool" })).toBeVisible();

  const nav = page.locator("nav");
  const links = await nav.locator("a").all();
  expect(links.length).toBeGreaterThanOrEqual(1);

  for (const link of links) {
    const href = (await link.getAttribute("href")) ?? "";
    // Each org link must be an absolute subdomain URL, not a path-based relative URL.
    // Path-based hrefs on the apex domain would cause an infinite login redirect loop
    // (proxy never injects x-org-id for apex-passthrough paths — BUG-1 root cause).
    expect(href, `Expected subdomain href but got: "${href}"`).toMatch(
      /^https:\/\/[^.]+\.test\.easeetool\.com\//,
    );
  }
});

// ---------------------------------------------------------------------------
// 3.  Apex non-root path → 404 JSON  (BUG-3 guard)
// ---------------------------------------------------------------------------
test("test.easeetool.com/<non-root-path> → 404 JSON", async ({ page }) => {
  // The proxy rejects any non-root path on the apex host immediately — no DB lookup,
  // no path-based org routing.  This prevents the silent pass-through that made
  // test.easeetool.com/nonexistent-org/login return 200 before BUG-3 was fixed.
  const response = await page.goto(APEX_NON_ROOT, { waitUntil: "commit" });
  expect(response?.status()).toBe(404);

  const body = await response?.text();
  // Proxy returns { error: "Not found" } for apex non-root paths (distinct from the
  // unknown-org body { error: "Organization not found" } from the DB-lookup branch).
  expect(body).toContain("Not found");
});

// ---------------------------------------------------------------------------
// 4.  Known org subdomain login page → 200 with login form
// ---------------------------------------------------------------------------
test("vistra.test.easeetool.com/login → 200 with login form", async ({
  page,
}) => {
  const response = await page.goto(VISTRA_LOGIN, { waitUntil: "commit" });
  expect(response?.status()).toBe(200);
  // Login form present — stable anchor across UI rebuilds.
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
});

// ---------------------------------------------------------------------------
// 5.  Unknown org subdomain root → 404 JSON
// ---------------------------------------------------------------------------
test("nope.test.easeetool.com/ → 404 JSON (unknown org)", async ({ page }) => {
  const response = await page.goto(UNKNOWN_ORG_ROOT, { waitUntil: "commit" });
  expect(response?.status()).toBe(404);

  const body = await response?.text();
  expect(body).toContain("Organization not found");
});

// ---------------------------------------------------------------------------
// 6.  Org subdomain root (/) → redirects to login  (BUG-4 regression guard)
// ---------------------------------------------------------------------------
test("vistra.test.easeetool.com/ → redirects to login page", async ({
  page,
}) => {
  // Proxy rewrites vistra.test.easeetool.com/ → /vistra/ internally.
  // app/[orgSlug]/page.tsx redirects to /{orgSlug}/login → login page renders.
  // Before BUG-4 was fixed, /vistra/ had no route handler and Next.js returned 404.
  await page.goto(VISTRA_ROOT);
  // After redirect chain, we must be on the login page
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({
    timeout: 10_000,
  });
  expect(page.url()).toMatch(/vistra.*\/login/);
});

// ---------------------------------------------------------------------------
// 7.  Org subdomain dashboard unauthenticated → redirect to login
// ---------------------------------------------------------------------------
test("vistra.test.easeetool.com/dashboard unauthenticated → redirect to login", async ({
  page,
}) => {
  // Fresh context, no session cookie.  Server component calls getSession() → null
  // → redirects to /{orgSlug}/login.
  await page.goto(VISTRA_DASHBOARD);
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({
    timeout: 10_000,
  });
  // Must have redirected to the login path, not the dashboard
  expect(page.url()).toMatch(/vistra.*\/login/);
});

// ---------------------------------------------------------------------------
// 8.  Full auth round-trip via org subdomain
//     Sign in → dashboard reachable → sign out
// ---------------------------------------------------------------------------
test("full sign-in via vistra.test.easeetool.com/login → dashboard → sign out", async ({
  page,
}) => {
  // Navigate to subdomain login page directly (absolute URL)
  await page.goto(VISTRA_LOGIN);
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({
    timeout: 15_000,
  });

  // Sign in with the seeded vistra admin credentials
  await page.getByLabel("User ID").fill("admin");
  await page.getByLabel("Password", { exact: true }).fill(
    process.env.TEST_ADMIN_PASSWORD ?? "Seed1234!",
  );
  await page.getByRole("button", { name: /Sign in/i }).click();

  // Dashboard must render
  await page.waitForURL(/vistra.*\/dashboard/, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "Dashboard" }),
  ).toBeVisible();

  // Sign out and confirm redirect back to login
  await page.getByRole("button", { name: /Sign out/i }).click();
  await page.waitForURL(/vistra.*\/login/, { timeout: 10_000 });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({
    timeout: 5_000,
  });
});
