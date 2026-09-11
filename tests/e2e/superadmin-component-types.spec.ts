/**
 * SuperAdmin Component Types console spec (Stage 19 Batch 5).
 *
 * Verification strategy — two tiers (same pattern as superadmin-roles.spec.ts):
 *
 * TIER 1 — Tests that work against the per-branch Vercel preview URL
 *   (PLAYWRIGHT_BASE_URL): API-only tests, no proxy org-slug routing required.
 *   Covers: auth guards (401 without cookie), CRUD round-trips via API,
 *   tenancy isolation (SuperAdmin can only read/write types belonging to the
 *   specified org — cross-org typeId with wrong orgId returns 404).
 *
 * TIER 2 — Tests that navigate to /controls/** as a page:
 *   proxy.ts (see its own header comment + the `/controls/**` carve-out branches)
 *   serves /controls correctly on the exact apex hosts (easeetool.com,
 *   www.easeetool.com, test.easeetool.com) AND on any other host that isn't an
 *   {orgSlug}.easeetool.com / {orgSlug}.test.easeetool.com org subdomain — which
 *   covers every value PLAYWRIGHT_BASE_URL is ever actually set to in this suite
 *   (ad-hoc per-branch Vercel preview, test.easeetool.com, easeetool.com, or
 *   localhost — see tests/e2e/helpers.ts's own isSubdomain/orgUrl commentary:
 *   PLAYWRIGHT_BASE_URL is always an apex-level host, never an org subdomain).
 *   So these tests build their /controls URL from PLAYWRIGHT_BASE_URL directly
 *   and run unconditionally — no staging-only gate.
 *
 * FLAG-B3 (bootstrap creds not yet set): All tests requiring a valid SuperAdmin
 *   session skip when TEST_SA_USERNAME / TEST_SA_PASSWORD are absent.
 *
 * E2E fixture cleanup: Created types accumulate in the dev DB (no DELETE route
 * in scope for Stage 19). Timestamp-based codes prevent collision across runs.
 * A future stage should add a SuperAdmin delete route or a direct-DB cleanup step.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://quotation-system-<hash>-vistra-indias-projects.vercel.app \
 *   TEST_SA_USERNAME=... TEST_SA_PASSWORD=... \
 *   npx playwright test superadmin-component-types
 */

import { test, expect } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

// ── Environment probes ───────────────────────────────────────────────────────

// /controls resolves correctly on every host PLAYWRIGHT_BASE_URL is ever set to
// in this suite (see the file header comment + proxy.ts's carve-out branches) —
// derive the base origin from it rather than hardcoding test.easeetool.com, so
// Tier 2 runs against ad-hoc per-branch previews too, not just staging.
const CONTROLS_BASE_URL = (() => {
  try {
    return new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000")
      .origin;
  } catch {
    return "http://localhost:3000";
  }
})();
const CONTROLS_HOSTNAME = new URL(CONTROLS_BASE_URL).hostname;
const APEX_CONTROLS_CT = `${CONTROLS_BASE_URL}/controls/component-types`;

const SA_USERNAME = process.env.TEST_SA_USERNAME ?? "";
const SA_PASSWORD = process.env.TEST_SA_PASSWORD ?? "";
const hasBootstrapCreds = Boolean(SA_USERNAME && SA_PASSWORD);

// Known acme-glass org ID (seeded — same across preview and staging environments).
// The SuperAdmin API returns the org list so we can look this up dynamically,
// but hardcoding the seeded value avoids an extra login round-trip.
// If the seed changes, update this constant.
const ACME_GLASS_ORG_SLUG = "acme-glass";

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

// ── Helper: resolve acme-glass org ID from the SuperAdmin orgs list ──────────

async function getAcmeGlassOrgId(
  request: import("@playwright/test").APIRequestContext,
  saToken: string,
): Promise<string> {
  const res = await request.get("/api/v1/superadmin/orgs", {
    headers: { Cookie: `qs-sa-token=${saToken}` },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { orgs: { id: string; slug: string }[] };
  const org = body.orgs.find((o) => o.slug === ACME_GLASS_ORG_SLUG);
  if (!org) throw new Error(`Org with slug "${ACME_GLASS_ORG_SLUG}" not found`);
  return org.id;
}

// ── Helper: create a ComponentType via the SuperAdmin API ────────────────────

async function createTestComponentType(
  request: import("@playwright/test").APIRequestContext,
  saToken: string,
  orgId: string,
  overrides: Partial<{
    code: string;
    name: string;
    categoryId: string;
    fieldsSchema: unknown[];
  }> = {},
): Promise<{ id: string; code: string; name: string }> {
  // First get a valid categoryId for the org
  const catsRes = await request.get(
    `/api/v1/superadmin/component-categories?orgId=${encodeURIComponent(orgId)}`,
    { headers: { Cookie: `qs-sa-token=${saToken}` } },
  );
  expect(catsRes.status()).toBe(200);
  const catsBody = (await catsRes.json()) as {
    categories: { id: string; name: string }[];
  };
  const firstCategory = catsBody.categories[0];
  if (!firstCategory) throw new Error("No categories found for org");

  const code = overrides.code ?? `SA_E2E_CT_${Date.now()}`;
  const name = overrides.name ?? `SA E2E Component ${code}`;
  const categoryId = overrides.categoryId ?? firstCategory.id;
  const fieldsSchema = overrides.fieldsSchema ?? [];

  const res = await request.post("/api/v1/superadmin/component-types", {
    headers: { Cookie: `qs-sa-token=${saToken}` },
    data: { orgId, code, name, categoryId, fieldsSchema },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as {
    componentType: { id: string; code: string; name: string };
  };
  return body.componentType;
}

// ─── TIER 1 TESTS (API-level, work against any preview URL) ──────────────────

// ── Test 1: Auth gate ─────────────────────────────────────────────────────────
//
// Replaces 4 RBAC tests from stage5 + 2 from stage6 that tested org-RBAC
// at the old /admin/components URL. Now a single 401 check suffices — the
// route is SuperAdmin-only.

test("auth gate: GET /api/v1/superadmin/component-types without cookie → 401", async ({
  request,
}) => {
  const res = await request.get(
    "/api/v1/superadmin/component-types?orgId=00000000-0000-0000-0000-000000000000",
  );
  expect(res.status()).toBe(401);
});

test("auth gate: POST /api/v1/superadmin/component-types without cookie → 401", async ({
  request,
}) => {
  const res = await request.post("/api/v1/superadmin/component-types", {
    data: {
      orgId: "00000000-0000-0000-0000-000000000000",
      code: "TEST",
      name: "Test",
      categoryId: "00000000-0000-0000-0000-000000000000",
    },
  });
  expect(res.status()).toBe(401);
});

test("auth gate: GET /api/v1/superadmin/component-categories without cookie → 401", async ({
  request,
}) => {
  const res = await request.get(
    "/api/v1/superadmin/component-categories?orgId=00000000-0000-0000-0000-000000000000",
  );
  expect(res.status()).toBe(401);
});

// ── Test 2: List — seeded types visible ───────────────────────────────────────
//
// Replaces stage5 tests 5-6 (GLASS/DOOR/PROFILE_STOP visible, category display).

test("list seeded types: GLASS, DOOR, PROFILE_STOP codes visible for acme-glass", async ({
  request,
}) => {
  if (!hasBootstrapCreds) {
    test.skip(true, "TEST_SA_USERNAME / TEST_SA_PASSWORD not set");
    return;
  }

  const saToken = await loginAsSuperAdmin(request);
  const orgId = await getAcmeGlassOrgId(request, saToken);

  const res = await request.get(
    `/api/v1/superadmin/component-types?orgId=${encodeURIComponent(orgId)}`,
    { headers: { Cookie: `qs-sa-token=${saToken}` } },
  );
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    componentTypes: { code: string; category: { name: string } }[];
  };

  const codes = body.componentTypes.map((ct) => ct.code);
  expect(codes).toContain("GLASS");
  expect(codes).toContain("DOOR");
  expect(codes).toContain("PROFILE_STOP");

  // Category name "Glass Partitions" should appear on at least one type.
  const hasGlassPartitionsCategory = body.componentTypes.some(
    (ct) => ct.category.name === "Glass Partitions",
  );
  expect(hasGlassPartitionsCategory).toBe(true);
});

// ── Test 3: Create + field schema round-trip ─────────────────────────────────
//
// Replaces stage5 test 7 (field schema round-trip) and stage6 category round-trip.

test("create and field schema round-trip: create type → add text field → reload → field present", async ({
  request,
}) => {
  if (!hasBootstrapCreds) {
    test.skip(true, "TEST_SA_USERNAME / TEST_SA_PASSWORD not set");
    return;
  }

  const saToken = await loginAsSuperAdmin(request);
  const orgId = await getAcmeGlassOrgId(request, saToken);

  const fieldKey = `e2e_field_${Date.now()}`;
  const fieldsSchema = [
    { key: fieldKey, label: "E2E Test Field", type: "field", required: false, basic: true },
  ];

  const created = await createTestComponentType(request, saToken, orgId, { fieldsSchema });

  // Reload via GET single
  const getRes = await request.get(
    `/api/v1/superadmin/component-types/${encodeURIComponent(created.id)}?orgId=${encodeURIComponent(orgId)}`,
    { headers: { Cookie: `qs-sa-token=${saToken}` } },
  );
  expect(getRes.status()).toBe(200);
  const getBody = (await getRes.json()) as {
    componentType: { fieldsSchema: { key: string }[] };
  };
  const fieldKeys = getBody.componentType.fieldsSchema.map((f) => f.key);
  expect(fieldKeys).toContain(fieldKey);
});

// ── Test 4: `options` on a dropdown field is now rejected outright ────────────
//
// Stage 20 Batch 2 decision #3/#7: SuperAdmin no longer authors option values
// at all — they moved to the org-owned ComponentTypeOrgConfig table. This
// replaces the old "dropdown field round-trip: options persist" test (which
// tested the exact behavior this batch inverts) with a rejection test, and is
// the server-side backstop `validateFieldsSchema` (wired into this POST route
// in this batch) is meant to catch for a caller bypassing the SuperAdmin form.

test("dropdown field with `options` key is rejected: POST → 400", async ({ request }) => {
  if (!hasBootstrapCreds) {
    test.skip(true, "TEST_SA_USERNAME / TEST_SA_PASSWORD not set");
    return;
  }

  const saToken = await loginAsSuperAdmin(request);
  const orgId = await getAcmeGlassOrgId(request, saToken);

  const catsRes = await request.get(
    `/api/v1/superadmin/component-categories?orgId=${encodeURIComponent(orgId)}`,
    { headers: { Cookie: `qs-sa-token=${saToken}` } },
  );
  const catsBody = (await catsRes.json()) as { categories: { id: string }[] };
  const categoryId = catsBody.categories[0]?.id;
  if (!categoryId) {
    test.skip(true, "No categories found — cannot test options-rejection guard");
    return;
  }

  const res = await request.post("/api/v1/superadmin/component-types", {
    headers: { Cookie: `qs-sa-token=${saToken}` },
    data: {
      orgId,
      code: `SA_E2E_OPTREJECT_${Date.now()}`,
      name: "E2E Options Rejected Test",
      categoryId,
      fieldsSchema: [
        {
          key: "e2e_dropdown",
          label: "E2E Dropdown",
          type: "dropdown",
          required: false,
          basic: true,
          options: ["Option Alpha", "Option Beta"],
        },
      ],
    },
  });
  expect(res.status()).toBe(400);
});

// ── Test 5: Empty-`options` key is rejected too, not just non-empty ──────────
//
// "Reject options outright" (decision #7) means presence of the key, not just
// non-empty content — an empty array must be rejected the same as a populated
// one, since SuperAdmin has no business setting this key at all anymore.

test("dropdown field with empty `options` array is still rejected: POST → 400", async ({
  request,
}) => {
  if (!hasBootstrapCreds) {
    test.skip(true, "TEST_SA_USERNAME / TEST_SA_PASSWORD not set");
    return;
  }

  const saToken = await loginAsSuperAdmin(request);
  const orgId = await getAcmeGlassOrgId(request, saToken);

  const catsRes = await request.get(
    `/api/v1/superadmin/component-categories?orgId=${encodeURIComponent(orgId)}`,
    { headers: { Cookie: `qs-sa-token=${saToken}` } },
  );
  const catsBody = (await catsRes.json()) as { categories: { id: string }[] };
  const categoryId = catsBody.categories[0]?.id;
  if (!categoryId) {
    test.skip(true, "No categories found — cannot test empty-options guard");
    return;
  }

  const res = await request.post("/api/v1/superadmin/component-types", {
    headers: { Cookie: `qs-sa-token=${saToken}` },
    data: {
      orgId,
      code: `SA_E2E_EMPTYOPT_${Date.now()}`,
      name: "E2E Empty Options Test",
      categoryId,
      fieldsSchema: [
        {
          key: "empty_opts",
          label: "Empty Opts",
          type: "dropdown",
          required: false,
          basic: true,
          options: [],
        },
      ],
    },
  });
  expect(res.status()).toBe(400);
});

// ── Test 6: dependsOn — valid earlier-field wiring round-trips ───────────────
//
// Stage 20 Batch 2 (decision #4): a dropdown/radio field may depend on any
// earlier dropdown/radio field in the same array, not just its immediate
// predecessor. This exercises a two-hop chain (category → glassType, skipping
// glassType → thickness) to specifically cover "any earlier field."

test("dependsOn: valid earlier-dropdown wiring round-trips through POST → GET", async ({
  request,
}) => {
  if (!hasBootstrapCreds) {
    test.skip(true, "TEST_SA_USERNAME / TEST_SA_PASSWORD not set");
    return;
  }

  const saToken = await loginAsSuperAdmin(request);
  const orgId = await getAcmeGlassOrgId(request, saToken);

  const fieldsSchema = [
    { key: "category", label: "Category", type: "dropdown", required: true, basic: true },
    { key: "spacer", label: "Spacer (non-choice)", type: "field", required: false, basic: true },
    {
      key: "glassType",
      label: "Glass Type",
      type: "dropdown",
      required: true,
      basic: true,
      dependsOn: "category",
    },
  ];

  const created = await createTestComponentType(request, saToken, orgId, { fieldsSchema });

  const getRes = await request.get(
    `/api/v1/superadmin/component-types/${encodeURIComponent(created.id)}?orgId=${encodeURIComponent(orgId)}`,
    { headers: { Cookie: `qs-sa-token=${saToken}` } },
  );
  expect(getRes.status()).toBe(200);
  const getBody = (await getRes.json()) as {
    componentType: { fieldsSchema: { key: string; dependsOn?: string }[] };
  };
  const glassTypeField = getBody.componentType.fieldsSchema.find(
    (f) => f.key === "glassType",
  );
  expect(glassTypeField?.dependsOn).toBe("category");
});

// ── Test 7: dependsOn pointing at a later field is rejected ──────────────────

test("dependsOn pointing at a later field is rejected: POST → 400", async ({ request }) => {
  if (!hasBootstrapCreds) {
    test.skip(true, "TEST_SA_USERNAME / TEST_SA_PASSWORD not set");
    return;
  }

  const saToken = await loginAsSuperAdmin(request);
  const orgId = await getAcmeGlassOrgId(request, saToken);

  const catsRes = await request.get(
    `/api/v1/superadmin/component-categories?orgId=${encodeURIComponent(orgId)}`,
    { headers: { Cookie: `qs-sa-token=${saToken}` } },
  );
  const catsBody = (await catsRes.json()) as { categories: { id: string }[] };
  const categoryId = catsBody.categories[0]?.id;
  if (!categoryId) {
    test.skip(true, "No categories found — cannot test dependsOn ordering guard");
    return;
  }

  const res = await request.post("/api/v1/superadmin/component-types", {
    headers: { Cookie: `qs-sa-token=${saToken}` },
    data: {
      orgId,
      code: `SA_E2E_DEPLATER_${Date.now()}`,
      name: "E2E dependsOn Later Field Test",
      categoryId,
      fieldsSchema: [
        {
          key: "glassType",
          label: "Glass Type",
          type: "dropdown",
          required: true,
          basic: true,
          dependsOn: "category", // "category" doesn't exist yet at this point in the array
        },
        { key: "category", label: "Category", type: "dropdown", required: true, basic: true },
      ],
    },
  });
  expect(res.status()).toBe(400);
});

// ── Test 8: dependsOn pointing at a non-dropdown/radio field is rejected ─────

test("dependsOn pointing at a non-dropdown/radio field is rejected: POST → 400", async ({
  request,
}) => {
  if (!hasBootstrapCreds) {
    test.skip(true, "TEST_SA_USERNAME / TEST_SA_PASSWORD not set");
    return;
  }

  const saToken = await loginAsSuperAdmin(request);
  const orgId = await getAcmeGlassOrgId(request, saToken);

  const catsRes = await request.get(
    `/api/v1/superadmin/component-categories?orgId=${encodeURIComponent(orgId)}`,
    { headers: { Cookie: `qs-sa-token=${saToken}` } },
  );
  const catsBody = (await catsRes.json()) as { categories: { id: string }[] };
  const categoryId = catsBody.categories[0]?.id;
  if (!categoryId) {
    test.skip(true, "No categories found — cannot test dependsOn type guard");
    return;
  }

  const res = await request.post("/api/v1/superadmin/component-types", {
    headers: { Cookie: `qs-sa-token=${saToken}` },
    data: {
      orgId,
      code: `SA_E2E_DEPWRONGTYPE_${Date.now()}`,
      name: "E2E dependsOn Wrong Target Type Test",
      categoryId,
      fieldsSchema: [
        { key: "notes", label: "Notes", type: "field", required: false, basic: true },
        {
          key: "glassType",
          label: "Glass Type",
          type: "dropdown",
          required: true,
          basic: true,
          dependsOn: "notes", // "notes" is type "field" — no value list to narrow
        },
      ],
    },
  });
  expect(res.status()).toBe(400);
});

// ── Test 6: Tenancy isolation ─────────────────────────────────────────────────
//
// SuperAdmin reads a typeId from orgA with orgB's orgId → 404.
// Confirms cross-org injection via typeId is blocked even for SuperAdmins.

test("tenancy isolation: typeId from org A with org B's orgId → 404", async ({
  request,
}) => {
  if (!hasBootstrapCreds) {
    test.skip(true, "TEST_SA_USERNAME / TEST_SA_PASSWORD not set");
    return;
  }

  const saToken = await loginAsSuperAdmin(request);
  const acmeOrgId = await getAcmeGlassOrgId(request, saToken);

  // Create a type in acme-glass
  const created = await createTestComponentType(request, saToken, acmeOrgId);

  // Try to read it with a different org ID (nordic-walls or a random UUID)
  const nordicWallsRes = await request.get("/api/v1/superadmin/orgs", {
    headers: { Cookie: `qs-sa-token=${saToken}` },
  });
  const orgsBody = (await nordicWallsRes.json()) as {
    orgs: { id: string; slug: string }[];
  };
  const otherOrg = orgsBody.orgs.find(
    (o) => o.slug !== ACME_GLASS_ORG_SLUG && !o.slug.includes("suspended"),
  );

  if (!otherOrg) {
    test.skip(true, "No second org found for tenancy isolation test");
    return;
  }

  // Reading acme-glass type with nordic-walls orgId must return 404
  const crossRes = await request.get(
    `/api/v1/superadmin/component-types/${encodeURIComponent(created.id)}?orgId=${encodeURIComponent(otherOrg.id)}`,
    { headers: { Cookie: `qs-sa-token=${saToken}` } },
  );
  expect(crossRes.status()).toBe(404);
});

// ── TIER 2 TESTS (page-level, run against PLAYWRIGHT_BASE_URL's own origin) ───

// ── Test 7: Controls page loads + org picker renders ─────────────────────────
//
// Replaces stage5 tests 5 (list visible) and stage5 RBAC tests by verifying
// the /controls auth gate at the page level.

test("controls page: unauthenticated visit to /controls/component-types → redirected to /controls/login", async ({
  page,
}) => {
  await page.goto(APEX_CONTROLS_CT);
  await expect(page).toHaveURL(/\/controls\/login/, { timeout: 15_000 });
});

// ── Test 8: SuperAdmin can navigate to edit page via /controls ─────────────────
//
// Replaces the "admin component types: Edit link + back-link" test removed from
// subdomain-navigation.spec.ts.

test("controls component types: SuperAdmin can select org and navigate to edit page", async ({
  page,
  request,
}) => {
  if (!hasBootstrapCreds) {
    test.skip(true, "TEST_SA_USERNAME / TEST_SA_PASSWORD not set");
    return;
  }

  // Sign in via API to get cookie, then set it on the browser context
  const saToken = await loginAsSuperAdmin(request);
  await page.context().addCookies([
    {
      name: "qs-sa-token",
      value: saToken,
      domain: CONTROLS_HOSTNAME,
      path: "/",
      secure: CONTROLS_BASE_URL.startsWith("https://"),
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  // Navigate to component-types page and select acme-glass org
  const acmeOrgId = await getAcmeGlassOrgId(request, saToken);
  await page.goto(
    `${APEX_CONTROLS_CT}?orgId=${encodeURIComponent(acmeOrgId)}`,
  );

  // h1 "Component Types" should be visible
  await expect(
    page.getByRole("heading", { name: /Component Types/i, level: 1 }),
  ).toBeVisible({ timeout: 15_000 });

  // GLASS type should appear in the list
  await expect(
    page.getByRole("cell", { name: "GLASS", exact: true }),
  ).toBeVisible({ timeout: 15_000 });

  // Click the Edit link for GLASS
  const editLink = page.getByRole("link", { name: "Edit" }).first();
  await expect(editLink).toBeVisible({ timeout: 10_000 });
  await editLink.click();

  // URL should contain typeId param
  await expect(page).toHaveURL(/typeId=/, { timeout: 15_000 });

  // h1 still visible after navigation
  await expect(
    page.getByRole("heading", { name: /Component Types/i, level: 1 }),
  ).toBeVisible({ timeout: 10_000 });

  // "Back to list" link should be present
  await expect(
    page.getByRole("link", { name: /Back to list/i }),
  ).toBeVisible({ timeout: 10_000 });
});
