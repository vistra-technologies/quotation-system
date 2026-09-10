/**
 * Stage 5 -- DAL + Project regression spec.
 *
 * Covers behavioral Definition of Done items:
 *   - Project CRUD: create project -> redirects to new project's Step 1 with correct projectNumber
 *   - Project tenancy: session guard prevents cross-org read
 *   - Cross-tenant externalCompanyId: crafted form submission with foreign company ID is rejected
 *
 * All checks target behavior invariants (tenancy, RBAC, data correctness).
 * No DOM structure / styling assertions (wireframe-stage rule).
 *
 * NOTE (Stage 19 Batch 5): ComponentType tests removed — relocated to superadmin-component-types.spec.ts.
 * Component Type management moved to /controls/component-types (SuperAdmin console).
 */

import { test, expect } from "@playwright/test";
import { signIn, fillCreateFormRequiredFields, orgUrl, orgUrlPattern, apiUrl } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

// Rate-limit pacing: better-auth limits sign-in to 3 per 10 seconds per IP.
// Many tests in this file sign in; 7-second beforeEach spaces sign-in calls
// 11+ seconds apart so the rate-limit window always resets.
test.beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 7_000));
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
  await page.goto(orgUrl("acme-glass", "/projects/new"));
  await expect(page).not.toHaveURL(orgUrlPattern("acme-glass", "/login"), { timeout: 10_000 });

  // Fill required fields.
  // Stage 14: destinationCountry removed from form (derived server-side);
  // currency changed to <select>; 7 end-client fields are now required.
  await page.locator("input[name='name']").fill(projectName);
  await fillCreateFormRequiredFields(page, "AED");

  // Stage 9: createProject now redirects to the new project's Step 1 (Project Details)
  // page, not the projects list. Wait for the UUID-shaped project detail URL.
  await Promise.all([
    page.waitForURL(orgUrlPattern("acme-glass", "/projects/[0-9a-f-]{36}$"), { timeout: 15_000 }),
    page.getByRole("button", { name: /create/i }).click(),
  ]);

  // Project name must be visible on the Project Details page.
  await expect(page.getByText(projectName)).toBeVisible({ timeout: 10_000 });

  // Project number must be assigned and visible on the detail card (format: "#N").
  // Stage 14: project number is shown as a text field in the Project Information card,
  // not as an h2 heading — the h2 assertion is stale.
  await expect(page.getByText(/#\d+/).first()).toBeVisible({ timeout: 10_000 });
});

test("Project list: any authenticated user can access /projects (no special RBAC required)", async ({
  page,
}) => {
  // Distributor (no special permissions) should be able to see the projects page
  await signIn(page, "distributor");
  await page.goto(orgUrl("acme-glass", "/projects"));
  await expect(page).not.toHaveURL(orgUrlPattern("acme-glass", "/login"));
  await expect(page).not.toHaveURL(orgUrlPattern("acme-glass", "/dashboard"));
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
  await page.goto(orgUrl("nordic-walls", "/projects"));
  // Cross-org guard rejects the session -- redirected to nordic-walls login
  await page.waitForURL(orgUrlPattern("nordic-walls", "/login"), { timeout: 10_000 });
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
    apiUrl("acme-glass", "/api/v1/orgs/acme-glass/external-companies"),
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
  await page.goto(orgUrl("acme-glass", "/dashboard"));
  // Stage 10: Log Out moved into profile dropdown (click to open, then click Log Out)
  await page.getByRole("button", { name: "Profile" }).click();
  await page.getByRole("button", { name: "Log Out" }).click();
  await expect(page).toHaveURL(orgUrlPattern("acme-glass", "/login"), { timeout: 15_000 });

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
    apiUrl("nordic-walls", "/api/v1/orgs/nordic-walls/projects"),
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
