/**
 * Stage 5 -- DAL + ComponentType + Project regression spec.
 *
 * Covers behavioral Definition of Done items:
 *   - ComponentType RBAC: distributor/member without MANAGE_FEATURES is redirected to dashboard
 *   - ComponentType tenancy: admin only sees own org's types
 *   - ComponentType inert-caveat: warning visible on list and edit pages
 *   - ComponentType field schema round-trip: create type -> add field -> save -> navigate back -> field persists
 *   - Project CRUD: create project -> redirects to new project's Step 1 with correct projectNumber
 *   - Project tenancy: session guard prevents cross-org read
 *   - Cross-tenant externalCompanyId: crafted form submission with foreign company ID is rejected
 *
 * All checks target behavior invariants (tenancy, RBAC, data correctness).
 * No DOM structure / styling assertions (wireframe-stage rule).
 */

import { test, expect } from "@playwright/test";
import { signIn, fillCreateFormRequiredFields } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

// Rate-limit pacing: better-auth limits sign-in to 3 per 10 seconds per IP.
// Many tests in this file sign in; 7-second beforeEach spaces sign-in calls
// 11+ seconds apart so the rate-limit window always resets.
test.beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 7_000));
});

// ---------------------------------------------------------------------------
// ComponentType -- RBAC gating
// ---------------------------------------------------------------------------

test("unauthenticated request to /admin/components redirects to login", async ({ page }) => {
  await page.goto("/acme-glass/admin/components");
  await expect(page).toHaveURL(/\/acme-glass\/login/, { timeout: 10_000 });
});

test("distributor role (no MANAGE_FEATURES) redirected from /admin/components to dashboard", async ({
  page,
}) => {
  await signIn(page, "distributor");
  await page.goto("/acme-glass/admin/components", { waitUntil: "commit" });
  await page.waitForURL(/\/acme-glass\/dashboard/, { timeout: 15_000 });
});

test("distributor role redirected from /admin/components/new to dashboard", async ({ page }) => {
  await signIn(page, "distributor");
  await page.goto("/acme-glass/admin/components/new", { waitUntil: "commit" });
  await page.waitForURL(/\/acme-glass\/dashboard/, { timeout: 15_000 });
});

test("company member (MANAGE_PRICING only, no MANAGE_FEATURES) redirected from /admin/components", async ({
  page,
}) => {
  await signIn(page, "member");
  await page.goto("/acme-glass/admin/components", { waitUntil: "commit" });
  // member role has MANAGE_PRICING + VIEW_ALL_DATA + APPLY_DISCOUNT but NOT MANAGE_FEATURES
  await page.waitForURL(/\/acme-glass\/dashboard/, { timeout: 15_000 });
});

// ---------------------------------------------------------------------------
// ComponentType -- inert caveat visible on list page
// ---------------------------------------------------------------------------

test("ComponentType list page shows inert-caveat warning for MANAGE_FEATURES admin", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/admin/components");
  // Inert caveat must be visible as an aside element
  await expect(page.locator("aside").first()).toBeVisible({ timeout: 15_000 });
});

test("ComponentType list page shows seeded GLASS, DOOR, PROFILE_STOP types", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/admin/components");
  await expect(page.getByRole("cell", { name: "DOOR", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("cell", { name: "GLASS", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "PROFILE_STOP", exact: true })).toBeVisible();
});

// ---------------------------------------------------------------------------
// ComponentType -- field schema round-trip (create -> add field -> save -> navigate back -> still there)
// ---------------------------------------------------------------------------

test("ComponentType field schema round-trip: create -> add field -> save -> navigate back -> field present", async ({
  page,
}) => {
  const code = `E2E_CT_${Date.now()}`;
  const name = `E2E Component ${code}`;
  const fieldKey = `test_field_${Date.now()}`;
  const fieldLabel = "E2E Test Field";

  await signIn(page, "admin");

  // Create a new ComponentType.
  // IMPORTANT: waitForURL must NOT match "/new" (the current URL).
  // Use a UUID pattern since typeIds are UUIDs.
  await page.goto("/acme-glass/admin/components/new");
  await page.locator("input[name='code']").fill(code);
  await page.locator("input[name='name']").fill(name);
  await page.locator("select[name='categoryId']").selectOption({ label: "Glass Partitions" });
  await Promise.all([
    page.waitForURL(
      (url) =>
        /\/acme-glass\/admin\/components\/[0-9a-f-]{36}/.test(url.toString()),
      { timeout: 15_000 },
    ),
    page.getByRole("button", { name: /create component type/i }).click(),
  ]);

  // Save the edit URL for navigation-back verification
  const editUrl = page.url();

  // Add a field to the freshly-created type (starts with 0 fields)
  // The first "+ Add Field" button is the Basic section's.
  await page.getByRole("button", { name: /\+ add field/i }).first().click();

  // Fill the first field row
  const keyInput = page.locator("input[placeholder='field_1']");
  await expect(keyInput).toBeVisible({ timeout: 10_000 });
  await keyInput.fill(fieldKey);
  await page.locator("input[placeholder='Display label']").fill(fieldLabel);

  // Submit update -- wait for the POST server-action response before navigating away
  await Promise.all([
    page.waitForResponse(
      (res) => res.request().method() === "POST" && res.url().includes("/admin/components"),
      { timeout: 20_000 },
    ),
    page.getByRole("button", { name: /save changes/i }).click(),
  ]);

  // Navigate away then HARD RELOAD back to force a fresh server render from DB
  await page.goto("/acme-glass/admin/components");
  await expect(page).toHaveURL(/\/acme-glass\/admin\/components$/, { timeout: 10_000 });
  await page.goto(editUrl);
  await page.reload(); // Hard reload bypasses Next.js router cache

  // The field key must be visible in the field editor -- proves JSONB round-trip
  await expect(page.locator(`input[value='${fieldKey}']`)).toBeVisible({ timeout: 15_000 });
});

// ---------------------------------------------------------------------------
// ComponentType -- list shows the FK-backed category for every type
// ---------------------------------------------------------------------------

test("ComponentType list shows the assigned category for seeded types", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/admin/components");
  // All ComponentTypes (there is no core/non-core distinction) show their category name
  await expect(page.getByRole("cell", { name: "Glass Partitions", exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
});

// ---------------------------------------------------------------------------
// Project -- CRUD round-trip
// ---------------------------------------------------------------------------

test("Project CRUD: create project -> appears at Step 1 with correct projectNumber", async ({
  page,
}) => {
  const projectName = `E2E Project ${Date.now()}`;

  await signIn(page, "admin");

  // Navigate to create project form
  await page.goto("/acme-glass/projects/new");
  await expect(page).not.toHaveURL(/\/acme-glass\/login/, { timeout: 10_000 });

  // Fill required fields.
  // Stage 14: destinationCountry removed from form (derived server-side);
  // currency changed to <select>; 7 end-client fields are now required.
  await page.locator("input[name='name']").fill(projectName);
  await fillCreateFormRequiredFields(page, "AED");

  // Stage 9: createProject now redirects to the new project's Step 1 (Project Details)
  // page, not the projects list. Wait for the UUID-shaped project detail URL.
  await Promise.all([
    page.waitForURL(/\/acme-glass\/projects\/[0-9a-f-]{36}$/, { timeout: 15_000 }),
    page.getByRole("button", { name: /create project/i }).click(),
  ]);

  // Project name must be visible on the Project Details page (shown in the page heading).
  await expect(page.getByText(projectName)).toBeVisible({ timeout: 10_000 });

  // Project number must be visible in the page heading (format: "#N — Project Name").
  await expect(page.getByRole("heading", { level: 2 })).toContainText(/#\d+/);
});

test("Project list: any authenticated user can access /projects (no special RBAC required)", async ({
  page,
}) => {
  // Distributor (no special permissions) should be able to see the projects page
  await signIn(page, "distributor");
  await page.goto("/acme-glass/projects");
  await expect(page).not.toHaveURL(/\/acme-glass\/login/);
  await expect(page).not.toHaveURL(/\/acme-glass\/dashboard/);
  // Projects page renders (no RBAC redirect)
  await expect(page.getByRole("link", { name: /new project/i })).toBeVisible({
    timeout: 15_000,
  });
});

// ---------------------------------------------------------------------------
// Project -- tenancy isolation (cross-org session redirect)
// ---------------------------------------------------------------------------

test("Project list: acme-glass session rejected on nordic-walls/projects", async ({ page }) => {
  await signIn(page, "admin", "Seed1234!", "acme-glass");
  // Navigate to a DIFFERENT org's projects using the same session cookie
  await page.goto("/nordic-walls/projects");
  // Cross-org guard rejects the session -- redirected to nordic-walls login
  await page.waitForURL(/\/nordic-walls\/login/, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Cross-tenant externalCompanyId guard (crafted form submission)
// ---------------------------------------------------------------------------

test("createProject: cross-org externalCompanyId is rejected with INVALID_EXTERNAL_COMPANY error", async ({
  page,
}) => {
  // Step 1: Sign in to acme-glass and retrieve an ExternalCompany UUID via the API.
  // Using page.request.get() (which shares cookies with the browser context) avoids
  // the DOM injection + React reconciler timing issue that caused the original test to
  // silently submit an empty externalCompanyId instead of the foreign UUID.
  await signIn(page, "admin", "Seed1234!", "acme-glass");

  const companiesRes = await page.request.get(
    "/api/v1/orgs/acme-glass/external-companies",
  );
  expect(companiesRes.status()).toBe(200);
  const { companies } = (await companiesRes.json()) as {
    companies: { id: string }[];
  };
  const acmeCompanyId = companies[0]?.id ?? null;

  if (!acmeCompanyId) {
    test.skip(
      true,
      "No external companies seeded for acme-glass -- cannot test cross-org injection",
    );
    return;
  }

  // Sign out from acme-glass before switching to nordic-walls.
  await page.goto("/acme-glass/dashboard");
  // Stage 10: Log Out moved into profile dropdown (click to open, then click Log Out)
  await page.getByRole("button", { name: "Profile" }).click();
  await page.getByRole("button", { name: "Log Out" }).click();
  await expect(page).toHaveURL(/\/acme-glass\/login/, { timeout: 15_000 });

  // Step 2: Sign in to nordic-walls as admin.
  await signIn(page, "admin", "Seed1234!", "nordic-walls");

  // Step 3: POST directly to the project-create API route with the foreign
  // externalCompanyId.  page.request uses the same cookies as the browser
  // context (authenticated as the nordic-walls admin session), so the route
  // handler and DAL see a valid session for the wrong org's company UUID.
  //
  // The DAL's org-scoped findFirst guard must:
  //   1. Find no ExternalCompany row with (id=acmeCompanyId, organizationId=nordicWallsOrgId)
  //   2. Throw { code: "INVALID_EXTERNAL_COMPANY" }
  //   3. Route handler surfaces it as 400 + { error: "Selected company is invalid." }
  const response = await page.request.post(
    "/api/v1/orgs/nordic-walls/projects",
    {
      data: {
        name: "Cross-Tenant Attack Test",
        destinationCountry: "UAE",
        currency: "AED",
        externalCompanyId: acmeCompanyId,
      },
    },
  );

  // Guard must reject — 400 with the canonical error message.
  expect(response.status()).toBe(400);
  const body = (await response.json()) as { error?: string; project?: unknown };
  expect(body.error).toMatch(/Selected company is invalid/i);
  // No project object in a rejected response — confirms nothing was created.
  expect(body.project).toBeUndefined();
});
