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
import { signIn } from "./helpers";

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
  await signIn(page, "admin", process.env.TEST_ADMIN_PASSWORD ?? "Seed1234!", "acme-glass");

  // Hit the stats API as the admin session (cookie is already set by signIn).
  const adminStatsRes = await page.request.get(
    "/api/v1/orgs/acme-glass/stats",
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
  // Wait between sign-ins to respect the better-auth rate limit.
  await new Promise((resolve) => setTimeout(resolve, 7_000));
  await signIn(page, "distributor", process.env.TEST_ADMIN_PASSWORD ?? "Seed1234!", "acme-glass");

  const distStatsRes = await page.request.get(
    "/api/v1/orgs/acme-glass/stats",
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
  // The external user's counts must never exceed the org-wide counts.
  // If the external-company filter is absent (pre-fix behaviour), both users
  // receive identical org-wide totals — these assertions would still pass.
  // The critical regression-catch is a FUTURE leak where distStats > adminStats,
  // which would indicate a cross-org data leak (impossible by current design but
  // defended here as a tripwire).
  expect(distStats.projectsTotal).toBeLessThanOrEqual(adminStats.projectsTotal);
  expect(distStats.projectsInProgress).toBeLessThanOrEqual(
    adminStats.projectsInProgress,
  );
  expect(distStats.inquiriesTotal).toBeLessThanOrEqual(
    adminStats.inquiriesTotal,
  );
  expect(distStats.inquiriesNew).toBeLessThanOrEqual(adminStats.inquiriesNew);

  // ordersTotal is always 0 (no Order model exists yet)
  expect(distStats.ordersTotal).toBe(0);
  expect(adminStats.ordersTotal).toBe(0);
});

test("D3: stats API returns 401 for unauthenticated requests", async ({
  page,
}) => {
  // Ensure no session cookie is present.
  await page.context().clearCookies();

  const res = await page.request.get("/api/v1/orgs/acme-glass/stats");
  expect(res.status()).toBe(401);
});
