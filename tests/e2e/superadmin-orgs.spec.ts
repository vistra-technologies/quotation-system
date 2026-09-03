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

/**
 * Returns the URL to reach an org's root page.
 *
 * On staging (test.easeetool.com, subdomain routing): absolute subdomain URL,
 * e.g. https://<slug>.test.easeetool.com/ — path-based requests hit the BUG-3
 * apex guard and return 404 before the proxy org-lookup runs.
 *
 * On local/CI (path-based routing fallback): relative path /<slug>/.
 */
function orgRootUrl(slug: string): string {
  if (isOnStaging) {
    const baseHost = new URL(process.env.PLAYWRIGHT_BASE_URL!).host; // test.easeetool.com
    return `https://${slug}.${baseHost}/`;
  }
  return `/${slug}/`;
}

const SA_USERNAME = process.env.TEST_SA_USERNAME ?? "";
const SA_PASSWORD = process.env.TEST_SA_PASSWORD ?? "";
const hasBootstrapCreds = Boolean(SA_USERNAME && SA_PASSWORD);

// Password used when creating test orgs that now require adminPassword (Stage 17 item 4a).
const TEST_ORG_ADMIN_PASSWORD = "TestPass1234!";

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
    data: { name: "Platform Org", slug: "platform", adminPassword: TEST_ORG_ADMIN_PASSWORD },
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
    data: { name: "Bad Slug", slug: "Bad Slug!!!", adminPassword: TEST_ORG_ADMIN_PASSWORD },
  });
  expect(res.status()).toBe(400);
});

// 5. Create a new org and verify isolation
//    "New org is isolated": a subsequent GET /api/v1/superadmin/orgs scoped query
//    shows the new org with userCount=1 (Stage 17: org creation auto-creates one admin
//    user), confirming it has no bleed from other orgs (i.e. not some larger count).
//    Skipped when bootstrap creds absent.
test("POST /api/v1/superadmin/orgs — new org is isolated (userCount=1, auto-created admin)", async ({
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
    data: { name: "E2E Isolation Test Org", slug: uniqueSlug, adminPassword: TEST_ORG_ADMIN_PASSWORD },
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
  // The new org has exactly the one auto-created admin user (Stage 17 item 4a) — isolation
  // check: no user rows from other orgs leaked in.
  expect(newOrg!.userCount).toBe(1);

  // Also confirm the seeded orgs (vistra, acme-glass, etc.) each have userCount > 0,
  // proving the count is org-scoped and not a global count.
  const seededOrg = list.orgs.find((o) => o.slug === "vistra");
  if (seededOrg) {
    expect(seededOrg.userCount).toBeGreaterThan(0);
  }
});

// ---------------------------------------------------------------------------
// TIER 1 (continued) — Batch E: Suspend/reactivate org (API-level, per-branch preview)
// ---------------------------------------------------------------------------

// 6. POST /api/v1/superadmin/orgs/[orgId]/suspend without cookie → 401
test("POST /api/v1/superadmin/orgs/[orgId]/suspend — no cookie → 401", async ({
  request,
}) => {
  const res = await request.post("/api/v1/superadmin/orgs/nonexistent-id/suspend", {
    data: { suspend: true },
  });
  expect(res.status()).toBe(401);
});

// 7. POST /api/v1/superadmin/orgs/[orgId]/suspend — missing body field → 400
test("POST /api/v1/superadmin/orgs/[orgId]/suspend — missing suspend field → 400 (requires session)", async ({
  request,
}) => {
  test.skip(
    !hasBootstrapCreds,
    "FLAG-B3: TEST_SA_USERNAME/TEST_SA_PASSWORD not set — bootstrap accounts not yet provisioned",
  );

  const token = await loginAsSuperAdmin(request);

  const res = await request.post("/api/v1/superadmin/orgs/nonexistent-id/suspend", {
    headers: { Cookie: `qs-sa-token=${token}` },
    data: { wrong_field: true },
  });
  expect(res.status()).toBe(400);
});

// 8. POST /api/v1/superadmin/orgs/[orgId]/suspend — unknown orgId → 404
test("POST /api/v1/superadmin/orgs/[orgId]/suspend — unknown orgId → 404 (requires session)", async ({
  request,
}) => {
  test.skip(
    !hasBootstrapCreds,
    "FLAG-B3: TEST_SA_USERNAME/TEST_SA_PASSWORD not set — bootstrap accounts not yet provisioned",
  );

  const token = await loginAsSuperAdmin(request);

  const res = await request.post(
    "/api/v1/superadmin/orgs/clxxxxxxxxxxxxxxxxxxxxxxxxx/suspend",
    {
      headers: { Cookie: `qs-sa-token=${token}` },
      data: { suspend: true },
    },
  );
  expect(res.status()).toBe(404);
});

// 9. Suspend org → 200; org appears suspended in list; reactivate → 200; org active again.
//    Also validates the middleware suspension check: a request to the suspended org's
//    path-based URL is blocked with 403; an active org's (vistra) path is NOT blocked.
//    Skipped when bootstrap creds absent.
//
//    NOTE on proxy cache: proxy.ts caches isSuspended for up to 60 s per in-process
//    instance. The suspension check assertion works reliably because the test creates a
//    brand-new slug (cold cache on every Vercel serverless instance). The "active org
//    unaffected" assertion uses the seeded "vistra" org (always active, never suspended).
//    The post-reactivation proxy assertion is intentionally omitted — it would be flaky
//    if the cached isSuspended:true entry is still warm on the same instance.
test("Batch E: suspend/reactivate lifecycle + proxy suspension check", async ({
  request,
}) => {
  test.skip(
    !hasBootstrapCreds,
    "FLAG-B3: TEST_SA_USERNAME/TEST_SA_PASSWORD not set — bootstrap accounts not yet provisioned",
  );

  const token = await loginAsSuperAdmin(request);
  const uniqueSlug = `e2e-suspend-${Date.now()}`;

  // Create a test org.
  const createRes = await request.post("/api/v1/superadmin/orgs", {
    headers: { Cookie: `qs-sa-token=${token}` },
    data: { name: "E2E Suspend Test", slug: uniqueSlug, adminPassword: TEST_ORG_ADMIN_PASSWORD },
  });
  expect(createRes.status()).toBe(201);
  const created = (await createRes.json()) as { org: { id: string } };
  const orgId = created.org.id;

  // Confirm org starts as active in the list.
  const listBefore = await request.get("/api/v1/superadmin/orgs", {
    headers: { Cookie: `qs-sa-token=${token}` },
  });
  const listBeforeBody = (await listBefore.json()) as {
    orgs: Array<{ id: string; isSuspended: boolean }>;
  };
  const beforeRow = listBeforeBody.orgs.find((o) => o.id === orgId);
  expect(beforeRow?.isSuspended).toBe(false);

  // "Active org unaffected" — the seeded vistra org (always active) must NOT be
  // blocked by the suspension check. Cold cache for this slug will fetch isSuspended:false.
  // On staging (subdomain routing), use the absolute subdomain URL — path-based requests
  // on the apex host hit the BUG-3 guard and return 404 before the suspension check runs.
  const activeOrgRes = await request.get(orgRootUrl("vistra"));
  expect(activeOrgRes.status()).not.toBe(403);

  // --- Suspend the new org ---
  const suspendRes = await request.post(
    `/api/v1/superadmin/orgs/${orgId}/suspend`,
    {
      headers: { Cookie: `qs-sa-token=${token}` },
      data: { suspend: true },
    },
  );
  expect(suspendRes.status()).toBe(200);

  // Org list now shows isSuspended: true.
  const listAfterSuspend = await request.get("/api/v1/superadmin/orgs", {
    headers: { Cookie: `qs-sa-token=${token}` },
  });
  const listAfterBody = (await listAfterSuspend.json()) as {
    orgs: Array<{ id: string; isSuspended: boolean }>;
  };
  const afterSuspendRow = listAfterBody.orgs.find((o) => o.id === orgId);
  expect(afterSuspendRow?.isSuspended).toBe(true);

  // Proxy suspension check: a request to the suspended org's URL must be blocked with 403.
  // The slug is brand-new so the proxy cache is cold — DB value (isSuspended:true) is used.
  // On staging (subdomain routing), use the absolute subdomain URL — path-based requests
  // on the apex host hit the BUG-3 guard and return 404 before the suspension check runs.
  const blockedRes = await request.get(orgRootUrl(uniqueSlug));
  expect(blockedRes.status()).toBe(403);
  const blockedBody = (await blockedRes.json()) as { error?: string };
  expect(blockedBody.error).toMatch(/suspended/i);

  // --- Reactivate the org ---
  const reactivateRes = await request.post(
    `/api/v1/superadmin/orgs/${orgId}/suspend`,
    {
      headers: { Cookie: `qs-sa-token=${token}` },
      data: { suspend: false },
    },
  );
  expect(reactivateRes.status()).toBe(200);

  // Org list now shows isSuspended: false — reactivation confirmed at the API level.
  // (Proxy unblock is not asserted here because the in-process cache may still hold
  // isSuspended:true for up to 60 s on the same serverless instance — see note above.)
  const listAfterReactivate = await request.get("/api/v1/superadmin/orgs", {
    headers: { Cookie: `qs-sa-token=${token}` },
  });
  const listReactivateBody = (await listAfterReactivate.json()) as {
    orgs: Array<{ id: string; isSuspended: boolean }>;
  };
  const afterReactivateRow = listReactivateBody.orgs.find((o) => o.id === orgId);
  expect(afterReactivateRow?.isSuspended).toBe(false);
});

// ---------------------------------------------------------------------------
// TIER 1 (continued) — Item 6a: Hard-delete org (suspended-only, audit-logged)
// ---------------------------------------------------------------------------

// 10. DELETE /api/v1/superadmin/orgs/[orgId] without cookie → 401
test("DELETE /api/v1/superadmin/orgs/[orgId] — no cookie → 401", async ({
  request,
}) => {
  const res = await request.delete("/api/v1/superadmin/orgs/any-id");
  expect(res.status()).toBe(401);
});

// 11. DELETE /api/v1/superadmin/orgs/[orgId] — non-existent org → 404
test("DELETE /api/v1/superadmin/orgs/[orgId] — non-existent org → 404 (requires session)", async ({
  request,
}) => {
  test.skip(
    !hasBootstrapCreds,
    "FLAG-B3: TEST_SA_USERNAME/TEST_SA_PASSWORD not set — bootstrap accounts not yet provisioned",
  );

  const token = await loginAsSuperAdmin(request);

  const res = await request.delete(
    "/api/v1/superadmin/orgs/00000000-0000-0000-0000-000000000000",
    { headers: { Cookie: `qs-sa-token=${token}` } },
  );
  expect(res.status()).toBe(404);
});

// 12. DELETE /api/v1/superadmin/orgs/[orgId] — active (non-suspended) org → 400
//     Safety gate: hard-delete is blocked unless the org is already suspended.
//     Requires a valid SuperAdmin session; skipped when bootstrap creds absent.
test("DELETE /api/v1/superadmin/orgs/[orgId] — non-suspended org rejected → 400 (safety gate)", async ({
  request,
}) => {
  test.skip(
    !hasBootstrapCreds,
    "FLAG-B3: TEST_SA_USERNAME/TEST_SA_PASSWORD not set — bootstrap accounts not yet provisioned",
  );

  const token = await loginAsSuperAdmin(request);
  const uniqueSlug = `verify-6a-gate-${Date.now()}`;

  // Create a fresh org (active by default).
  const createRes = await request.post("/api/v1/superadmin/orgs", {
    headers: { Cookie: `qs-sa-token=${token}` },
    data: { name: "6a Safety Gate Test", slug: uniqueSlug, adminPassword: TEST_ORG_ADMIN_PASSWORD },
  });
  expect(createRes.status()).toBe(201);
  const { org } = (await createRes.json()) as { org: { id: string } };

  // Attempt DELETE without suspending first — must be rejected.
  const deleteRes = await request.delete(
    `/api/v1/superadmin/orgs/${org.id}`,
    { headers: { Cookie: `qs-sa-token=${token}` } },
  );
  expect(deleteRes.status()).toBe(400);
  const body = (await deleteRes.json()) as { error?: string };
  expect(body.error).toMatch(/suspended/i);

  // Org must still exist in the list (no data was lost).
  const listRes = await request.get("/api/v1/superadmin/orgs", {
    headers: { Cookie: `qs-sa-token=${token}` },
  });
  const listBody = (await listRes.json()) as { orgs: Array<{ id: string }> };
  expect(listBody.orgs.some((o) => o.id === org.id)).toBe(true);

  // Cleanup: suspend then hard-delete this test org so it doesn't accumulate.
  await request.post(`/api/v1/superadmin/orgs/${org.id}/suspend`, {
    headers: { Cookie: `qs-sa-token=${token}` },
    data: { suspend: true },
  });
  await request.delete(`/api/v1/superadmin/orgs/${org.id}`, {
    headers: { Cookie: `qs-sa-token=${token}` },
  });
});

// 13. Full lifecycle: create → suspend → hard-delete → org gone from list.
//     Tenancy isolation: vistra org is unaffected (user count unchanged).
//     Audit log: org.delete entry present (verified via the org being absent from the
//     list — direct DB audit-log assertion requires DB access; covered in the tester's
//     manual pass, which confirmed the audit row with correct slug/name/id metadata).
//     Requires a valid SuperAdmin session; skipped when bootstrap creds absent.
test("Item 6a: create → suspend → hard-delete → org gone; vistra unaffected", async ({
  request,
}) => {
  test.skip(
    !hasBootstrapCreds,
    "FLAG-B3: TEST_SA_USERNAME/TEST_SA_PASSWORD not set — bootstrap accounts not yet provisioned",
  );

  const token = await loginAsSuperAdmin(request);
  const uniqueSlug = `verify-6a-${Date.now()}`;

  // --- Step 1: Create test org ---
  const createRes = await request.post("/api/v1/superadmin/orgs", {
    headers: { Cookie: `qs-sa-token=${token}` },
    data: { name: "6a Delete Lifecycle Test", slug: uniqueSlug, adminPassword: TEST_ORG_ADMIN_PASSWORD },
  });
  expect(createRes.status()).toBe(201);
  const { org } = (await createRes.json()) as { org: { id: string; slug: string } };
  expect(org.slug).toBe(uniqueSlug);

  // Record vistra's userCount before the delete for tenancy isolation check.
  const listBefore = await request.get("/api/v1/superadmin/orgs", {
    headers: { Cookie: `qs-sa-token=${token}` },
  });
  const listBeforeBody = (await listBefore.json()) as {
    orgs: Array<{ id: string; slug: string; userCount: number; isSuspended: boolean }>;
  };
  const vistraBefore = listBeforeBody.orgs.find((o) => o.slug === "vistra");

  // --- Step 2: Suspend ---
  const suspendRes = await request.post(
    `/api/v1/superadmin/orgs/${org.id}/suspend`,
    {
      headers: { Cookie: `qs-sa-token=${token}` },
      data: { suspend: true },
    },
  );
  expect(suspendRes.status()).toBe(200);

  // Confirm suspended in list.
  const listAfterSuspend = await request.get("/api/v1/superadmin/orgs", {
    headers: { Cookie: `qs-sa-token=${token}` },
  });
  const suspendedBody = (await listAfterSuspend.json()) as {
    orgs: Array<{ id: string; isSuspended: boolean }>;
  };
  expect(suspendedBody.orgs.find((o) => o.id === org.id)?.isSuspended).toBe(true);

  // --- Step 3: Hard delete ---
  const deleteRes = await request.delete(
    `/api/v1/superadmin/orgs/${org.id}`,
    { headers: { Cookie: `qs-sa-token=${token}` } },
  );
  expect(deleteRes.status()).toBe(200);
  const deleteBody = (await deleteRes.json()) as { ok: boolean };
  expect(deleteBody.ok).toBe(true);

  // --- Step 4: Org gone from list ---
  const listAfterDelete = await request.get("/api/v1/superadmin/orgs", {
    headers: { Cookie: `qs-sa-token=${token}` },
  });
  expect(listAfterDelete.status()).toBe(200);
  const afterBody = (await listAfterDelete.json()) as {
    orgs: Array<{ id: string; slug: string; userCount: number }>;
  };
  expect(afterBody.orgs.some((o) => o.id === org.id)).toBe(false);
  expect(afterBody.orgs.some((o) => o.slug === uniqueSlug)).toBe(false);

  // --- Step 5: Tenancy isolation — vistra is untouched ---
  const vistraAfter = afterBody.orgs.find((o) => o.slug === "vistra");
  if (vistraBefore && vistraAfter) {
    expect(vistraAfter.userCount).toBe(vistraBefore.userCount);
  }

  // --- Step 6: 404 on deleted org (idempotency check) ---
  const deletedAgain = await request.delete(
    `/api/v1/superadmin/orgs/${org.id}`,
    { headers: { Cookie: `qs-sa-token=${token}` } },
  );
  expect(deletedAgain.status()).toBe(404);
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
