/**
 * SuperAdmin org list + create-org spec (Stage 16 Batch C).
 *
 * Verification strategy — two tiers (same pattern as superadmin-auth.spec.ts):
 *
 * TIER 1 — Tests that work against the per-branch Vercel preview URL
 *   (PLAYWRIGHT_BASE_URL): API-only tests, no proxy org-slug routing required.
 *
 * TIER 2 — Tests that MUST target test.easeetool.com (page navigation, post-staging-merge).
 *   Page-level navigation to /controls/** on a per-branch preview URL resolves
 *   "controls" as an org slug → 404 (MINOR-1 from review-1.md).
 *
 * FLAG-B3 (bootstrap creds not yet set): Tier 1 tests that require a valid
 * SuperAdmin session skip when TEST_SA_USERNAME / TEST_SA_PASSWORD are absent.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://quotation-system-<hash>-vistra-indias-projects.vercel.app \
 *   npx playwright test superadmin-orgs
 */

import { test, expect } from "@playwright/test";

test.describe.configure({ mode: "serial" });

// ── Environment probes ───────────────────────────────────────────────────────

const APEX_CONTROLS_ORGS = "https://test.easeetool.com/controls/orgs";
const APEX_CONTROLS_ORGS_NEW = "https://test.easeetool.com/controls/orgs/new";

const isOnStaging = (process.env.PLAYWRIGHT_BASE_URL ?? "").includes(
  "test.easeetool.com",
);

const SA_USERNAME = process.env.TEST_SA_USERNAME ?? "";
const SA_PASSWORD = process.env.TEST_SA_PASSWORD ?? "";
const hasBootstrapCreds = Boolean(SA_USERNAME && SA_PASSWORD);

// ── Helper: log in as SuperAdmin and return the qs-sa-token cookie value ─────

async function loginAsSuperAdmin(
  request: import("@playwright/test").APIRequestContext,
): Promise<string> {
  const res = await request.post("/api/v1/superadmin/login", {
    data: { username: SA_USERNAME, password: SA_PASSWORD },
  });
  if (res.status() !== 200) {
    throw new Error(`SuperAdmin login failed: HTTP ${res.status()}`);
  }
  const setCookie = res.headers()["set-cookie"] ?? "";
  const match = setCookie.match(/qs-sa-token=([^;]+)/);
  if (!match) throw new Error("qs-sa-token cookie not found in login response");
  return match[1];
}

// ---------------------------------------------------------------------------
// TIER 1 — API-only tests (per-branch preview URL)
// ---------------------------------------------------------------------------

// 1. GET /api/v1/superadmin/orgs without cookie → 401
test("GET /api/v1/superadmin/orgs — no cookie → 401", async ({ request }) => {
  const res = await request.get("/api/v1/superadmin/orgs");
  expect(res.status()).toBe(401);
});

// 2. POST /api/v1/superadmin/orgs without cookie → 401
test("POST /api/v1/superadmin/orgs — no cookie → 401", async ({ request }) => {
  const res = await request.post("/api/v1/superadmin/orgs", {
    data: { name: "Test", slug: "test-org" },
  });
  expect(res.status()).toBe(401);
});

// 3. POST /api/v1/superadmin/orgs with "platform" slug → 400 (reserved)
//    Requires a valid SuperAdmin session; skipped when bootstrap creds absent.
test('POST /api/v1/superadmin/orgs — "platform" slug rejected → 400', async ({
  request,
}) => {
  test.skip(
    !hasBootstrapCreds,
    "FLAG-B3: TEST_SA_USERNAME/TEST_SA_PASSWORD not set — bootstrap accounts not yet provisioned",
  );

  const token = await loginAsSuperAdmin(request);

  const res = await request.post("/api/v1/superadmin/orgs", {
    headers: { Cookie: `qs-sa-token=${token}` },
    data: { name: "Platform Org", slug: "platform" },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect((body as { error?: string }).error).toMatch(/reserved/i);
});

// 4. POST /api/v1/superadmin/orgs — invalid slug format → 400
test("POST /api/v1/superadmin/orgs — invalid slug format → 400 (requires session)", async ({
  request,
}) => {
  test.skip(
    !hasBootstrapCreds,
    "FLAG-B3: TEST_SA_USERNAME/TEST_SA_PASSWORD not set — bootstrap accounts not yet provisioned",
  );

  const token = await loginAsSuperAdmin(request);

  const res = await request.post("/api/v1/superadmin/orgs", {
    headers: { Cookie: `qs-sa-token=${token}` },
    data: { name: "Bad Slug", slug: "Bad Slug!!!" },
  });
  expect(res.status()).toBe(400);
});

// 5. Create a new org and verify isolation
//    "New org is isolated": a subsequent GET /api/v1/superadmin/orgs scoped query
//    shows the new org with userCount=0, confirming it has no bleed from other orgs.
//    Skipped when bootstrap creds absent.
test("POST /api/v1/superadmin/orgs — new org is isolated (userCount=0)", async ({
  request,
}) => {
  test.skip(
    !hasBootstrapCreds,
    "FLAG-B3: TEST_SA_USERNAME/TEST_SA_PASSWORD not set — bootstrap accounts not yet provisioned",
  );

  const token = await loginAsSuperAdmin(request);
  const uniqueSlug = `e2e-iso-${Date.now()}`;

  // Create a new org.
  const createRes = await request.post("/api/v1/superadmin/orgs", {
    headers: { Cookie: `qs-sa-token=${token}` },
    data: { name: "E2E Isolation Test Org", slug: uniqueSlug },
  });
  expect(createRes.status()).toBe(201);
  const created = (await createRes.json()) as { org: { id: string; slug: string } };
  expect(created.org.slug).toBe(uniqueSlug);

  // Fetch the org list and find the new org.
  const listRes = await request.get("/api/v1/superadmin/orgs", {
    headers: { Cookie: `qs-sa-token=${token}` },
  });
  expect(listRes.status()).toBe(200);
  const list = (await listRes.json()) as {
    orgs: Array<{ id: string; slug: string; userCount: number }>;
  };

  const newOrg = list.orgs.find((o) => o.slug === uniqueSlug);
  expect(newOrg, "New org must appear in the org list").toBeDefined();
  // The new org has no users — isolation check: no user rows from other orgs leaked in.
  expect(newOrg!.userCount).toBe(0);

  // Also confirm the seeded orgs (vistra, acme-glass, etc.) each have userCount > 0,
  // proving the count is org-scoped and not a global count.
  const seededOrg = list.orgs.find((o) => o.slug === "vistra");
  if (seededOrg) {
    expect(seededOrg.userCount).toBeGreaterThan(0);
  }
});

// ---------------------------------------------------------------------------
// TIER 2 — Page navigation (test.easeetool.com only, post-staging-merge)
// ---------------------------------------------------------------------------

// 6. /controls/orgs page renders the org list (unauthenticated → redirect to login)
test("test.easeetool.com/controls/orgs — unauthenticated redirects to /controls/login", async ({
  page,
}) => {
  test.skip(!isOnStaging, "Tier 2: requires test.easeetool.com (not per-branch preview)");

  await page.goto(APEX_CONTROLS_ORGS, { waitUntil: "commit" });
  expect(page.url()).toContain("/controls/login");
});

// 7. /controls/orgs/new page renders the create-org form (unauthenticated → redirect)
test("test.easeetool.com/controls/orgs/new — unauthenticated redirects to /controls/login", async ({
  page,
}) => {
  test.skip(!isOnStaging, "Tier 2: requires test.easeetool.com (not per-branch preview)");

  await page.goto(APEX_CONTROLS_ORGS_NEW, { waitUntil: "commit" });
  expect(page.url()).toContain("/controls/login");
});
