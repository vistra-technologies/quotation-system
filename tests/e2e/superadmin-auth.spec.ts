/**
 * SuperAdmin auth surface spec (Stage 16 Batch B).
 *
 * Verification strategy — two tiers:
 *
 * TIER 1 — Tests that work against the per-branch Vercel preview URL
 *   (PLAYWRIGHT_BASE_URL): API-only tests that don't route through the apex
 *   proxy's org-slug path extraction.  These run on the feature branch preview.
 *
 * TIER 2 — Tests that MUST target test.easeetool.com (page navigation).
 *   Because the per-branch preview URL has no /controls carve-out in the
 *   localhost/CI proxy fallback (MINOR-1 from review-1.md), page navigation
 *   to /controls/** on the per-branch URL resolves "controls" as an org slug
 *   and returns 404.  Absolute URLs targeting test.easeetool.com are stable
 *   (the staging branch alias always points there).
 *   These are skipped automatically when the env says we're not on staging
 *   (PLAYWRIGHT_BASE_URL != test.easeetool.com pattern) — they run in the
 *   formal engineering:test pass after Batch B merges to staging.
 *
 * FLAG-B3 (bootstrap creds not yet set): Tests (4) and (5) — successful login
 * and cookie scoping — require SUPERADMIN_*_PASSWORD env vars set in Vercel +
 * seed run.  They are marked with a .skip.when() guard keyed on the presence
 * of TEST_SA_USERNAME / TEST_SA_PASSWORD env vars.  When those vars are unset,
 * the tests are skipped with a clear message; they don't fail hard.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://quotation-system-<hash>-vistra-indias-projects.vercel.app \
 *   VERCEL_AUTOMATION_BYPASS_SECRET=<secret> \
 *   npx playwright test superadmin-auth
 */

import { test, expect } from "@playwright/test";

// Run serially — avoids cookie state bleed between tests and rate-limit contention.
test.describe.configure({ mode: "serial" });

// ── Environment probes ───────────────────────────────────────────────────────

// Absolute URL for the apex controls login page on staging.
// Tier 2 tests always use this — never PLAYWRIGHT_BASE_URL.
const APEX_CONTROLS_LOGIN = "https://test.easeetool.com/controls/login";
const APEX_CONTROLS_ORGS = "https://test.easeetool.com/controls/orgs";

// Whether we can run Tier 2 (page-navigation) tests.
// The per-branch preview proxy treats "controls" as an org slug → 404.
// Only test.easeetool.com has the proxy carve-out live (post-staging-merge).
const isOnStaging = (process.env.PLAYWRIGHT_BASE_URL ?? "").includes(
  "test.easeetool.com",
);

// Bootstrap creds — only available after the human sets SUPERADMIN_*_PASSWORD
// in Vercel and a seed run has provisioned the SuperAdmin rows (FLAG-B3).
const SA_USERNAME = process.env.TEST_SA_USERNAME ?? "";
const SA_PASSWORD = process.env.TEST_SA_PASSWORD ?? "";
const hasBootstrapCreds = Boolean(SA_USERNAME && SA_PASSWORD);

// ---------------------------------------------------------------------------
// TIER 1 — API-only tests (per-branch preview URL via PLAYWRIGHT_BASE_URL)
// ---------------------------------------------------------------------------

// 1. POST /api/v1/superadmin/login with non-existent username → 401
test("POST /api/v1/superadmin/login — non-existent username → 401", async ({
  request,
}) => {
  const res = await request.post("/api/v1/superadmin/login", {
    data: { username: "nonexistent_user_xyz", password: "wrongpassword" },
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body).toHaveProperty("error");
});

// 2. POST /api/v1/superadmin/login with missing fields → 400
test("POST /api/v1/superadmin/login — missing fields → 400", async ({
  request,
}) => {
  const res = await request.post("/api/v1/superadmin/login", {
    data: { username: "devadmin" },
  });
  expect(res.status()).toBe(400);
});

// 3. GET /api/v1/superadmin/ping with no cookie → 401 (existing guard)
test("GET /api/v1/superadmin/ping — no cookie → 401", async ({ request }) => {
  const res = await request.get("/api/v1/superadmin/ping");
  expect(res.status()).toBe(401);
});

// 4. Successful login issues qs-sa-token cookie with no Domain= segment
//    Skipped when bootstrap creds are not available (FLAG-B3).
test("POST /api/v1/superadmin/login — valid creds → qs-sa-token cookie, no Domain=", async ({
  request,
}) => {
  test.skip(!hasBootstrapCreds, "FLAG-B3: TEST_SA_USERNAME/TEST_SA_PASSWORD not set — bootstrap accounts not yet provisioned");

  const res = await request.post("/api/v1/superadmin/login", {
    data: { username: SA_USERNAME, password: SA_PASSWORD },
  });
  expect(res.status()).toBe(200);

  // Inspect the Set-Cookie header for qs-sa-token.
  const setCookieHeader = res.headers()["set-cookie"] ?? "";
  expect(setCookieHeader).toContain("qs-sa-token=");
  expect(setCookieHeader).toContain("HttpOnly");
  // SameSite attribute value is case-insensitive per RFC 6265bis; Next.js emits lowercase "lax".
  expect(setCookieHeader.toLowerCase()).toContain("samesite=lax");

  // Crucial: no Domain= attribute must be present.
  // RFC 6265 §5.3: omitting Domain binds the cookie to the exact request host
  // (easeetool.com) and prevents it from being sent to *.easeetool.com.
  expect(setCookieHeader).not.toContain("Domain=");
});

// 5. qs-sa-token cookie issued on apex is NOT sent to org subdomains
//    Skipped when bootstrap creds are not available (FLAG-B3).
//    This test must run on test.easeetool.com (Tier 2) for the Domain scoping
//    assertion to have real meaning — subdomain isolation is browser-enforced.
test("qs-sa-token cookie from apex is not sent to org subdomains", async ({
  browser,
}) => {
  test.skip(!hasBootstrapCreds, "FLAG-B3: TEST_SA_USERNAME/TEST_SA_PASSWORD not set — bootstrap accounts not yet provisioned");
  test.skip(!isOnStaging, "Tier 2: requires test.easeetool.com (not per-branch preview)");

  // Log in on the apex host to get the qs-sa-token cookie.
  const context = await browser.newContext({ baseURL: "https://test.easeetool.com" });
  const page = await context.newPage();

  const loginRes = await page.request.post(
    "https://test.easeetool.com/api/v1/superadmin/login",
    { data: { username: SA_USERNAME, password: SA_PASSWORD } },
  );
  expect(loginRes.status()).toBe(200);

  // Check what cookies the context now holds for the apex host.
  const apexCookies = await context.cookies("https://test.easeetool.com");
  const saToken = apexCookies.find((c) => c.name === "qs-sa-token");
  expect(saToken, "qs-sa-token must be set on apex after login").toBeTruthy();

  // Verify the cookie is NOT present in the context for the org subdomain.
  // RFC 6265: without a Domain= attribute the cookie is host-only and is NOT
  // sent to any subdomain.
  const subdomainCookies = await context.cookies(
    "https://vistra.test.easeetool.com",
  );
  const saTokenOnSubdomain = subdomainCookies.find(
    (c) => c.name === "qs-sa-token",
  );
  expect(
    saTokenOnSubdomain,
    "qs-sa-token must NOT be visible on org subdomain",
  ).toBeUndefined();

  // Also verify the subdomain's ping endpoint rejects the context's cookies.
  const pingRes = await page.request.get(
    "https://vistra.test.easeetool.com/api/v1/superadmin/ping",
  );
  expect(pingRes.status()).toBe(401);

  await context.close();
});

// ---------------------------------------------------------------------------
// TIER 2 — Page navigation tests (test.easeetool.com only, post-staging-merge)
// ---------------------------------------------------------------------------

// 6. Unauthenticated /controls/orgs → redirect to /controls/login
test("test.easeetool.com/controls/orgs unauthenticated → redirect to /controls/login", async ({
  page,
}) => {
  test.skip(!isOnStaging, "Tier 2: requires test.easeetool.com (not per-branch preview)");

  // Fresh context — no qs-sa-token cookie.
  await page.goto(APEX_CONTROLS_ORGS, { waitUntil: "commit" });
  // After redirect, must be on the login page.
  expect(page.url()).toContain("/controls/login");
});

// 7. /controls/login page renders the login form
test("test.easeetool.com/controls/login renders the login form", async ({
  page,
}) => {
  test.skip(!isOnStaging, "Tier 2: requires test.easeetool.com (not per-branch preview)");

  const res = await page.goto(APEX_CONTROLS_LOGIN, { waitUntil: "commit" });
  expect(res?.status()).toBe(200);
  // The login form's username input must be present — stable anchor across UI rebuilds.
  await expect(
    page.locator('input[autocomplete="username"]'),
  ).toBeVisible({ timeout: 10_000 });
});

// 8. Full login round-trip via test.easeetool.com
//    Skipped when bootstrap creds are not available (FLAG-B3).
test("full SuperAdmin login round-trip via test.easeetool.com/controls/login", async ({
  page,
}) => {
  test.skip(!hasBootstrapCreds, "FLAG-B3: TEST_SA_USERNAME/TEST_SA_PASSWORD not set — bootstrap accounts not yet provisioned");
  test.skip(!isOnStaging, "Tier 2: requires test.easeetool.com (not per-branch preview)");

  await page.goto(APEX_CONTROLS_LOGIN);
  await expect(
    page.locator('input[autocomplete="username"]'),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByLabel("User ID").fill(SA_USERNAME);
  await page.getByLabel("Password", { exact: true }).fill(SA_PASSWORD);
  await page.getByRole("button", { name: /Sign in/i }).click();

  // After login, the form redirects to /controls/orgs.
  // /controls/orgs doesn't exist yet (Batch C) — but the redirect must fire,
  // showing a 404 page rather than staying on the login page.
  // We verify the URL has changed away from /controls/login.
  await page.waitForURL(/controls\/(?!login)/, { timeout: 15_000 });
  expect(page.url()).not.toContain("/controls/login");
});
