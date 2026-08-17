/**
 * Stage 15 Batch B — Dashboard & top-nav spec.
 *
 * Behaviour-level only — no DOM structure, layout, copy or styling assertions.
 *
 * D3 (tenancy-adjacent): KPI stats scoping
 *   - An internal user (Admin, null externalCompanyId) sees org-wide totals.
 *   - An external user (Distributor, non-null externalCompanyId) sees only their
 *     company's records — never org-wide totals that include other companies' data.
 *
 * The invariant tested: external user's stats ≤ internal user's stats for every
 * counter.  If the external-company filter is removed, both users would receive
 * the same org-wide count; any realistic org with records not linked to the
 * distributor company would expose the regression.
 *
 * D1, D2, D4 are visual/structural — verified manually against the preview.
 */

import { test, expect } from "@playwright/test";
import { signIn, apiUrl } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

// Rate-limit pacing — better-auth caps sign-in to ~3 / 10 s per IP.
test.beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 7_000));
});

// ---------------------------------------------------------------------------
// D3 — Stats API scoping: external user sees ≤ org-wide counts
// ---------------------------------------------------------------------------

test("D3: admin (internal) stats are >= distributor (external) stats for every KPI counter", async ({
  page,
}) => {
  // ── Step 1: sign in as admin and capture org-wide stats ──────────────────
  // Clear any residual session cookies from previous test runs so the login
  // page renders instead of redirecting to the dashboard.
  await page.context().clearCookies();
  await signIn(page, "admin", process.env.TEST_ADMIN_PASSWORD ?? "Seed1234!", "acme-glass");

  // Hit the stats API as the admin session (cookie is already set by signIn).
  const adminStatsRes = await page.request.get(
    apiUrl("acme-glass", "/api/v1/orgs/acme-glass/stats"),
  );
  expect(adminStatsRes.status()).toBe(200);
  const adminStats = (await adminStatsRes.json()) as {
    projectsTotal: number;
    projectsInProgress: number;
    inquiriesTotal: number;
    inquiriesNew: number;
    ordersTotal: number;
  };

  // ── Step 2: sign in as distributor and capture company-scoped stats ───────
  // Clear admin session before signing in as distributor.
  await page.context().clearCookies();
  // Wait between sign-ins to respect the better-auth rate limit.
  await new Promise((resolve) => setTimeout(resolve, 7_000));
  await signIn(page, "distributor", process.env.TEST_ADMIN_PASSWORD ?? "Seed1234!", "acme-glass");

  const distStatsRes = await page.request.get(
    apiUrl("acme-glass", "/api/v1/orgs/acme-glass/stats"),
  );
  expect(distStatsRes.status()).toBe(200);
  const distStats = (await distStatsRes.json()) as {
    projectsTotal: number;
    projectsInProgress: number;
    inquiriesTotal: number;
    inquiriesNew: number;
    ordersTotal: number;
  };

  // ── Step 3: assert tenancy invariant ──────────────────────────────────────
  // STRICT less-than (<), not less-than-or-equal.
  //
  // Why strict: if the externalCompanyId filter is removed from getDashboardStats(),
  // both users receive the same org-wide count (e.g. both = 101).
  // `101 <= 101` would pass, hiding the regression.  `101 < 101` fails — the spec
  // is now a true guard for the D3 fix.
  //
  // Why not exact counts: three other batches run concurrently against the same
  // dev Neon DB; a batch that creates a record linked to the distributor's company
  // would shift the exact count and flake.  The gap is wide enough (9 vs 101/231
  // at the time of writing) that strict < is safe and won't flake from incidental
  // additions.
  expect(distStats.projectsTotal).toBeLessThan(adminStats.projectsTotal);
  expect(distStats.projectsInProgress).toBeLessThan(
    adminStats.projectsInProgress,
  );
  expect(distStats.inquiriesTotal).toBeLessThan(adminStats.inquiriesTotal);
  expect(distStats.inquiriesNew).toBeLessThan(adminStats.inquiriesNew);

  // ordersTotal is always 0 (no Order model exists yet)
  expect(distStats.ordersTotal).toBe(0);
  expect(adminStats.ordersTotal).toBe(0);
});

test("D3: stats API returns 401 for unauthenticated requests", async ({
  page,
}) => {
  // Ensure no session cookie is present.
  await page.context().clearCookies();

  const res = await page.request.get(apiUrl("acme-glass", "/api/v1/orgs/acme-glass/stats"));
  expect(res.status()).toBe(401);
});
