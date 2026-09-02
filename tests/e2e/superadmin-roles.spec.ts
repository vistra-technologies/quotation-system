/**
 * SuperAdmin roles/permissions console spec (Stage 16 Batch D).
 *
 * Verification strategy — two tiers (same pattern as superadmin-orgs.spec.ts):
 *
 * TIER 1 — Tests that work against the per-branch Vercel preview URL
 *   (PLAYWRIGHT_BASE_URL): API-only tests, no proxy org-slug routing required.
 *   Covers: auth guards (401 without cookie), and tenancy isolation
 *   (toggling a permission on org A's role does not affect org B's role of the
 *   same name — the Batch D invariant).
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
 *   npx playwright test superadmin-roles
 */

import { test, expect } from "@playwright/test";

test.describe.configure({ mode: "serial" });

// ── Environment probes ───────────────────────────────────────────────────────

const APEX_CONTROLS_ROLES = "https://test.easeetool.com/controls/roles";

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

// ── Helper: create a throw-away org and return its id ────────────────────────

async function createTestOrg(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  suffix: string,
): Promise<string> {
  const slug = `e2e-roles-${suffix}-${Date.now()}`.slice(0, 63);
  const res = await request.post("/api/v1/superadmin/orgs", {
    headers: { Cookie: `qs-sa-token=${token}` },
    data: { name: `E2E Roles Test Org ${suffix}`, slug },
  });
  if (res.status() !== 201) {
    throw new Error(`Failed to create test org ${suffix}: HTTP ${res.status()}`);
  }
  const body = (await res.json()) as { org: { id: string } };
  return body.org.id;
}

// ---------------------------------------------------------------------------
// TIER 1 — API-only tests (per-branch preview URL)
// ---------------------------------------------------------------------------

// 1. GET /api/v1/superadmin/roles — no cookie → 401
test("GET /api/v1/superadmin/roles — no cookie → 401", async ({ request }) => {
  const res = await request.get("/api/v1/superadmin/roles?orgId=any");
  expect(res.status()).toBe(401);
});

// 2. POST /api/v1/superadmin/roles — no cookie → 401
test("POST /api/v1/superadmin/roles — no cookie → 401", async ({ request }) => {
  const res = await request.post("/api/v1/superadmin/roles", {
    data: { orgId: "any", name: "Test Role" },
  });
  expect(res.status()).toBe(401);
});

// 3. PATCH /api/v1/superadmin/roles/[roleId] — no cookie → 401
test("PATCH /api/v1/superadmin/roles/fake-id — no cookie → 401", async ({ request }) => {
  const res = await request.patch("/api/v1/superadmin/roles/fake-id", {
    data: { orgId: "any", name: "New Name" },
  });
  expect(res.status()).toBe(401);
});

// 4. POST /api/v1/superadmin/roles/[roleId]/permissions — no cookie → 401
test("POST /api/v1/superadmin/roles/fake-id/permissions — no cookie → 401", async ({
  request,
}) => {
  const res = await request.post("/api/v1/superadmin/roles/fake-id/permissions", {
    data: { orgId: "any", permissionId: "any" },
  });
  expect(res.status()).toBe(401);
});

// 5. DELETE /api/v1/superadmin/roles/[roleId]/permissions — no cookie → 401
test("DELETE /api/v1/superadmin/roles/fake-id/permissions — no cookie → 401", async ({
  request,
}) => {
  const res = await request.delete("/api/v1/superadmin/roles/fake-id/permissions", {
    data: { orgId: "any", permissionId: "any" },
  });
  expect(res.status()).toBe(401);
});

// 6. GET /api/v1/superadmin/permissions — no cookie → 401
test("GET /api/v1/superadmin/permissions — no cookie → 401", async ({ request }) => {
  const res = await request.get("/api/v1/superadmin/permissions");
  expect(res.status()).toBe(401);
});

// 7. POST /api/v1/superadmin/roles — missing orgId → 400 (requires session)
test("POST /api/v1/superadmin/roles — missing orgId → 400", async ({ request }) => {
  test.skip(
    !hasBootstrapCreds,
    "FLAG-B3: TEST_SA_USERNAME/TEST_SA_PASSWORD not set — bootstrap accounts not yet provisioned",
  );

  const token = await loginAsSuperAdmin(request);

  const res = await request.post("/api/v1/superadmin/roles", {
    headers: { Cookie: `qs-sa-token=${token}` },
    data: { name: "Missing OrgId" },
  });
  expect(res.status()).toBe(400);
});

// 8. TENANCY ISOLATION — the core Batch D invariant:
//    "A permission toggle for org A does not affect org B's role of the same name."
//
//    Steps:
//    a. Create two fresh orgs (org-a, org-b).
//    b. Create a role named "Test Role" in each org — they'll have the same name
//       but different IDs and different orgIds.
//    c. Fetch the global permission catalog; pick the first permission.
//    d. Grant that permission to org-a's role.
//    e. Verify org-a's role has the permission (granted).
//    f. Verify org-b's role does NOT have the permission (not affected).

test("Permission toggle for org A does not affect org B role of the same name", async ({
  request,
}) => {
  test.skip(
    !hasBootstrapCreds,
    "FLAG-B3: TEST_SA_USERNAME/TEST_SA_PASSWORD not set — bootstrap accounts not yet provisioned",
  );

  const token = await loginAsSuperAdmin(request);

  // a. Create two test orgs.
  const ts = Date.now();
  const orgAId = await createTestOrg(request, token, `a-${ts}`);
  const orgBId = await createTestOrg(request, token, `b-${ts}`);

  // b. Create a role named "Test Role" in each org.
  const roleNameShared = "Test Role";

  const roleARes = await request.post("/api/v1/superadmin/roles", {
    headers: { Cookie: `qs-sa-token=${token}` },
    data: { orgId: orgAId, name: roleNameShared },
  });
  expect(roleARes.status()).toBe(201);
  const roleAId = ((await roleARes.json()) as { role: { id: string } }).role.id;

  const roleBRes = await request.post("/api/v1/superadmin/roles", {
    headers: { Cookie: `qs-sa-token=${token}` },
    data: { orgId: orgBId, name: roleNameShared },
  });
  expect(roleBRes.status()).toBe(201);
  const roleBId = ((await roleBRes.json()) as { role: { id: string } }).role.id;

  // c. Fetch the global permission catalog; pick the first available permission.
  const permsRes = await request.get("/api/v1/superadmin/permissions", {
    headers: { Cookie: `qs-sa-token=${token}` },
  });
  expect(permsRes.status()).toBe(200);
  const { permissions } = (await permsRes.json()) as {
    permissions: Array<{ id: string; code: string }>;
  };
  expect(permissions.length).toBeGreaterThan(0);
  const testPermId = permissions[0].id;

  // d. Grant the permission to org-a's role only.
  const grantRes = await request.post(
    `/api/v1/superadmin/roles/${roleAId}/permissions`,
    {
      headers: { Cookie: `qs-sa-token=${token}` },
      data: { orgId: orgAId, permissionId: testPermId },
    },
  );
  expect(grantRes.status()).toBe(201);

  // e. Verify org-a's role has the permission.
  const roleAPermsRes = await request.get(
    `/api/v1/superadmin/roles/${roleAId}/permissions?orgId=${orgAId}`,
    { headers: { Cookie: `qs-sa-token=${token}` } },
  );
  expect(roleAPermsRes.status()).toBe(200);
  const roleAPerms = (
    (await roleAPermsRes.json()) as {
      rolePermissions: Array<{ permissionId: string }>;
    }
  ).rolePermissions;
  expect(roleAPerms.some((rp) => rp.permissionId === testPermId)).toBe(true);

  // f. Verify org-b's role does NOT have the permission.
  const roleBPermsRes = await request.get(
    `/api/v1/superadmin/roles/${roleBId}/permissions?orgId=${orgBId}`,
    { headers: { Cookie: `qs-sa-token=${token}` } },
  );
  expect(roleBPermsRes.status()).toBe(200);
  const roleBPerms = (
    (await roleBPermsRes.json()) as {
      rolePermissions: Array<{ permissionId: string }>;
    }
  ).rolePermissions;
  // Org B's role must not have acquired the permission that was only assigned to org A.
  expect(roleBPerms.some((rp) => rp.permissionId === testPermId)).toBe(false);
});

// 9. Cross-org role ownership guard:
//    Attempting to grant a permission to org-a's role using org-b's orgId → 404.
//    This verifies that the superadmin cannot accidentally modify a role via a
//    mismatched orgId.

test("Grant permission using wrong orgId → 404", async ({ request }) => {
  test.skip(
    !hasBootstrapCreds,
    "FLAG-B3: TEST_SA_USERNAME/TEST_SA_PASSWORD not set — bootstrap accounts not yet provisioned",
  );

  const token = await loginAsSuperAdmin(request);

  const ts = Date.now();
  const orgAId = await createTestOrg(request, token, `guard-a-${ts}`);
  const orgBId = await createTestOrg(request, token, `guard-b-${ts}`);

  // Create a role in org A.
  const roleARes = await request.post("/api/v1/superadmin/roles", {
    headers: { Cookie: `qs-sa-token=${token}` },
    data: { orgId: orgAId, name: "Guard Test Role" },
  });
  expect(roleARes.status()).toBe(201);
  const roleAId = ((await roleARes.json()) as { role: { id: string } }).role.id;

  // Fetch a permission id.
  const permsRes = await request.get("/api/v1/superadmin/permissions", {
    headers: { Cookie: `qs-sa-token=${token}` },
  });
  const { permissions } = (await permsRes.json()) as {
    permissions: Array<{ id: string }>;
  };
  const testPermId = permissions[0].id;

  // Try to grant using org B's id for a role that belongs to org A → should be 404.
  const badGrantRes = await request.post(
    `/api/v1/superadmin/roles/${roleAId}/permissions`,
    {
      headers: { Cookie: `qs-sa-token=${token}` },
      data: { orgId: orgBId, permissionId: testPermId },
    },
  );
  expect(badGrantRes.status()).toBe(404);
});

// ---------------------------------------------------------------------------
// TIER 2 — Page navigation (test.easeetool.com only, post-staging-merge)
// ---------------------------------------------------------------------------

// 10. /controls/roles page — unauthenticated → redirects to /controls/login
test("test.easeetool.com/controls/roles — unauthenticated redirects to /controls/login", async ({
  page,
}) => {
  test.skip(!isOnStaging, "Tier 2: requires test.easeetool.com (not per-branch preview)");

  await page.goto(APEX_CONTROLS_ROLES, { waitUntil: "commit" });
  expect(page.url()).toContain("/controls/login");
});
