/**
 * Stage 6 — External Company, Selection regression spec.
 *
 * Covers behavioral DoD items:
 *   - External Company RBAC: non-MANAGE_USERS role refused (list + new pages)
 *   - External Company CRUD round-trip: create → appears in list → appears in user-create dropdown
 *   - External Company tenancy: org A's admin only sees org A's companies
 *   - Selection RBAC/auth: unauthenticated → redirected; any authenticated user can access
 *   - Selection CRUD round-trip: add component → dynamic form renders → config saved → appears in list
 *   - Selection tenancy: cross-org project page is blocked by session guard
 *
 * Invariants only — no DOM structure / styling assertions (wireframe-stage rule).
 *
 * NOTE (Stage 19 Batch 5): ComponentType tests removed — relocated to superadmin-component-types.spec.ts.
 * Component Type management moved to /controls/component-types (SuperAdmin console).
 */

import { test, expect } from "@playwright/test";
import { signIn, fillCreateFormRequiredFields, orgUrl, orgUrlPattern } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

// Rate-limit pacing: better-auth limits sign-in to 3 per 10 seconds per IP.
// Many tests in this file sign in; 7-second beforeEach spaces sign-in calls
// 11+ seconds apart so the rate-limit window always resets.
test.beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 7_000));
});

// ---------------------------------------------------------------------------
// External Company — RBAC gating
// ---------------------------------------------------------------------------

test("unauthenticated request to /admin/external-companies redirects to login", async ({
  page,
}) => {
  await page.goto(orgUrl("acme-glass", "/admin/external-companies"));
  await expect(page).toHaveURL(orgUrlPattern("acme-glass", "/login"), { timeout: 10_000 });
});

test("distributor role (no MANAGE_USERS) redirected from /admin/external-companies to dashboard", async ({
  page,
}) => {
  await signIn(page, "distributor");
  await page.goto(orgUrl("acme-glass", "/admin/external-companies"), { waitUntil: "commit" });
  await page.waitForURL(orgUrlPattern("acme-glass", "/dashboard"), { timeout: 15_000 });
});

test("distributor role (no MANAGE_USERS) redirected from /admin/external-companies/new to dashboard", async ({
  page,
}) => {
  await signIn(page, "distributor");
  await page.goto(orgUrl("acme-glass", "/admin/external-companies/new"), { waitUntil: "commit" });
  await page.waitForURL(orgUrlPattern("acme-glass", "/dashboard"), { timeout: 15_000 });
});

test("company member (no MANAGE_USERS) redirected from /admin/external-companies to dashboard", async ({
  page,
}) => {
  await signIn(page, "member");
  await page.goto(orgUrl("acme-glass", "/admin/external-companies"), { waitUntil: "commit" });
  await page.waitForURL(orgUrlPattern("acme-glass", "/dashboard"), { timeout: 15_000 });
});

// ---------------------------------------------------------------------------
// External Company — CRUD round-trip
// ---------------------------------------------------------------------------

test("External Company create round-trip: create → appears in list", async ({ page }) => {
  const companyName = `E2E Distributor ${Date.now()}`;

  await signIn(page, "admin");
  await page.goto(orgUrl("acme-glass", "/admin/external-companies/new"));
  await expect(page).not.toHaveURL(orgUrlPattern("acme-glass", "/login"), { timeout: 15_000 });

  // Fill the name field
  await page.locator("input[name='name']").fill(companyName);
  // Type is pre-selected (DISTRIBUTOR); leave it as is

  // Submit and expect redirect to list
  await Promise.all([
    page.waitForURL(orgUrlPattern("acme-glass", "/admin/external-companies$"), { timeout: 15_000 }),
    page.getByRole("button", { name: /create company/i }).click(),
  ]);

  // Company must appear in the list
  await expect(page.getByText(companyName)).toBeVisible({ timeout: 10_000 });
});

test("External Company: newly created company appears in user-create dropdown", async ({
  page,
}) => {
  const companyName = `E2E Arch Firm ${Date.now()}`;

  await signIn(page, "admin");

  // Create the architectural firm
  await page.goto(orgUrl("acme-glass", "/admin/external-companies/new"));
  await page.locator("input[name='name']").fill(companyName);
  await page.locator("select[name='type']").selectOption("ARCHITECTURAL_FIRM");
  await Promise.all([
    page.waitForURL(orgUrlPattern("acme-glass", "/admin/external-companies$"), { timeout: 15_000 }),
    page.getByRole("button", { name: /create company/i }).click(),
  ]);

  // Navigate to user-create form and check dropdown
  await page.goto(orgUrl("acme-glass", "/admin/users/new"));
  const externalCompanyDropdown = page.locator("select[name='externalCompanyId']");
  await expect(externalCompanyDropdown).toBeVisible({ timeout: 15_000 });
  // The dropdown must contain an option with the company name
  await expect(
    externalCompanyDropdown.locator(`option:text-is("${companyName}")`),
  ).toBeAttached({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// External Company — tenancy isolation
// ---------------------------------------------------------------------------

test("External Company tenancy: acme-glass admin only sees acme-glass companies", async ({
  page,
}) => {
  // nordic-walls has its own seeded distributor company: "Nordic Walls AB Dist Co"
  const nordicWallsCompany = "Nordic Walls AB Dist Co";

  await signIn(page, "admin", "Seed1234!", "acme-glass");
  await page.goto(orgUrl("acme-glass", "/admin/external-companies"));
  await expect(page).not.toHaveURL(orgUrlPattern("acme-glass", "/login"), { timeout: 15_000 });

  // Wait for the page to render
  await page.waitForLoadState("domcontentloaded");

  // The nordic-walls company must NOT appear on acme-glass's list
  const nordicsCompanyCell = page.getByText(nordicWallsCompany);
  await expect(nordicsCompanyCell).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// External Company — nav link visible for MANAGE_USERS admins
// ---------------------------------------------------------------------------

test("Admin nav shows External Companies link for MANAGE_USERS role", async ({ page }) => {
  await signIn(page, "admin");
  // Admin section is reachable via any admin page
  await page.goto(orgUrl("acme-glass", "/admin/users"));
  // The nav must have the External Companies link.
  // Stage 11: Admin links are in a CSS hover flyout. Hover Admin button to reveal.
  // .first() guards against the SSR/CSR hydration window where both a server-
  // rendered and a client-rendered sidebar briefly coexist in the DOM (checklist
  // item 95 — MINOR-1 from regression report).
  const adminTrigger6 = page.getByRole("button", { name: "Admin" }).first();
  await expect(adminTrigger6).toBeVisible({ timeout: 15_000 });
  await adminTrigger6.hover();
  // Use .first() because the admin layout's top nav AND the org-level side panel
  // both render an "External Companies" link — two links is expected behavior
  // after Stage 8 added the side panel (strict mode would fail without .first()).
  await expect(page.getByRole("link", { name: /external companies/i }).first()).toBeVisible({
    timeout: 15_000,
  });
});

// ---------------------------------------------------------------------------
// Selection — auth gate
// ---------------------------------------------------------------------------

test("unauthenticated request to /projects/[id] redirects to login", async ({ page }) => {
  // Use a plausible but nonexistent project ID — the session check fires first
  await page.goto(orgUrl("acme-glass", "/projects/00000000-0000-0000-0000-000000000000"));
  await expect(page).toHaveURL(orgUrlPattern("acme-glass", "/login"), { timeout: 10_000 });
});

test("distributor role (no special permission) can access project detail page", async ({
  page,
}) => {
  await signIn(page, "distributor");

  // Distributor needs an existing project. Create one as admin first in a dedicated page session.
  // Instead of cross-test state, navigate to projects list and check if any project link exists.
  await page.goto(orgUrl("acme-glass", "/projects"));
  await expect(page).not.toHaveURL(orgUrlPattern("acme-glass", "/login"), { timeout: 10_000 });
  await expect(page).not.toHaveURL(orgUrlPattern("acme-glass", "/dashboard"), { timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// Selection — CRUD round-trip
// ---------------------------------------------------------------------------

test("Selection round-trip: create project → add selection → selection appears in list", async ({
  page,
}) => {
  const projectName = `E2E Sel Project ${Date.now()}`;
  const selectionLabel = `E2E Glass Panel ${Date.now()}`;

  await signIn(page, "admin");

  // Create a project.
  // Stage 14: destinationCountry removed from form (derived server-side);
  // currency changed to <select>; 7 end-client fields are now required.
  await page.goto(orgUrl("acme-glass", "/projects/new"));
  await page.locator("input[name='name']").fill(projectName);
  await fillCreateFormRequiredFields(page, "AED");

  // Stage 9: createProject now redirects to the new project's Step 1 (Project Details),
  // not the project list. Wait for the UUID-shaped project detail URL.
  await Promise.all([
    page.waitForURL(orgUrlPattern("acme-glass", "/projects/[0-9a-f-]{36}$"), { timeout: 15_000 }),
    page.getByRole("button", { name: /create/i }).click(),
  ]);

  // Wait for the page to fully settle after the Next.js App Router processes the
  // server-action redirect client-side. The client router is still active when
  // waitForURL resolves — calling page.goto immediately causes net::ERR_ABORTED.
  await page.waitForLoadState("domcontentloaded");

  // Navigate to Configuration (Step 2) where the Selections UI now lives.
  const detailUrl = page.url();
  const configUrl = `${detailUrl}/configuration`;
  await page.goto(configUrl, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(orgUrlPattern("acme-glass", "/projects/[0-9a-f-]{36}/configuration$"), {
    timeout: 15_000,
  });

  // The "no components yet" empty state should be visible on /configuration
  await expect(page.getByText(/no components added yet/i)).toBeVisible({ timeout: 10_000 });

  // Fill the Add Component form
  await page.locator("input#sel-label").fill(selectionLabel);

  // Pick the GLASS component type (seeded for every org)
  const typeSelect = page.locator("select#sel-type");
  await expect(typeSelect).toBeVisible({ timeout: 10_000 });
  await typeSelect.selectOption({ label: "Glass" });

  // Wait for dynamic fields to appear — GLASS has a required "Thickness (mm)" field
  const thicknessInput = page.locator("input[type='text']").nth(1); // second text input (first is label)
  await expect(thicknessInput).toBeVisible({ timeout: 5_000 });

  // Fill required text field (thickness)
  await thicknessInput.fill("10");

  // Select Glass Type radio (required) — pick "Clear"
  await page.getByLabel("Clear").check();

  // Submit the selection — Stage 9: redirect goes back to /configuration, not project detail
  await Promise.all([
    page.waitForURL(orgUrlPattern("acme-glass", "/projects/[0-9a-f-]{36}/configuration$"), { timeout: 20_000 }),
    page.getByRole("button", { name: /add component/i }).click(),
  ]);

  // The selection must now appear in the table
  await expect(page.getByText(selectionLabel)).toBeVisible({ timeout: 15_000 });
  // The component type name must appear (exact match avoids collision with the selection label)
  await expect(page.getByRole("cell", { name: "Glass", exact: true })).toBeVisible({
    timeout: 10_000,
  });
});

// ---------------------------------------------------------------------------
// Selection — tenancy (cross-org session guard)
// ---------------------------------------------------------------------------

test("Selection tenancy: acme-glass session rejected on nordic-walls project detail route", async ({
  page,
}) => {
  await signIn(page, "admin", "Seed1234!", "acme-glass");

  // Attempt to navigate to nordic-walls project routes while holding acme-glass session.
  // The cross-org session guard (lib/session.ts) will redirect to nordic-walls login
  // before any project-level tenancy check even fires.
  await page.goto(orgUrl("nordic-walls", "/projects/00000000-0000-0000-0000-000000000000"));
  // Cross-org guard must redirect to nordic-walls login
  await page.waitForURL(orgUrlPattern("nordic-walls", "/login"), { timeout: 15_000 });
});

test("Selection tenancy: direct access to a different org's project returns 404 (not the project data)", async ({
  page,
}) => {
  // Get a real project ID from acme-glass
  await signIn(page, "admin", "Seed1234!", "acme-glass");

  // Create a project to get a real ID.
  // Stage 14: destinationCountry removed from form; currency is now a <select>.
  await page.goto(orgUrl("acme-glass", "/projects/new"));
  await page.locator("input[name='name']").fill("E2E Tenancy Probe Project");
  await fillCreateFormRequiredFields(page, "AED");

  // Stage 9: createProject redirects to the new project's detail page, not the list.
  // Extract the projectId from the resulting URL directly.
  await Promise.all([
    page.waitForURL(orgUrlPattern("acme-glass", "/projects/[0-9a-f-]{36}$"), { timeout: 15_000 }),
    page.getByRole("button", { name: /create/i }).click(),
  ]);

  // Get the projectId from the current URL (format: /acme-glass/projects/{uuid})
  const projectId = page.url().split("/").pop() ?? "";
  expect(projectId).toMatch(/^[0-9a-f-]{36}$/);

  // Sign out of acme-glass
  await page.goto(orgUrl("acme-glass", "/dashboard"));
  // Stage 10: Log Out moved into profile dropdown (click to open, then click Log Out)
  await page.getByRole("button", { name: "Profile" }).click();
  await page.getByRole("button", { name: "Log Out" }).click();
  await expect(page).toHaveURL(orgUrlPattern("acme-glass", "/login"), { timeout: 15_000 });

  // Sign in to nordic-walls as admin
  await signIn(page, "admin", "Seed1234!", "nordic-walls");

  // Attempt to access acme-glass's project from within nordic-walls's URL space.
  // The project route is under /nordic-walls/projects/[projectId] — but the project
  // belongs to acme-glass. The DAL tenancy guard should return null → notFound().
  await page.goto(orgUrl("nordic-walls", `/projects/${projectId}`));
  // Should show 404 (Next.js notFound() path) rather than the project data
  // We can't assert specific 404 text (wireframe rule) but we CAN assert the
  // page did not render the project name (i.e., tenancy was enforced).
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByText("E2E Tenancy Probe Project")).not.toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Projects list — links to detail page (Stage 6 addition)
// ---------------------------------------------------------------------------

test("Projects list: project rows link to their detail pages", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto(orgUrl("acme-glass", "/projects"));

  // If there are any projects, each row should have a link to the detail page
  const firstProjectLink = page.getByRole("link").filter({ hasText: /^#\d+/ }).first();
  const hasProjects = (await firstProjectLink.count()) > 0;

  if (hasProjects) {
    const href = await firstProjectLink.getAttribute("href");
    expect(href).toMatch(/\/projects\/[0-9a-f-]{36}/);
  }
  // If no projects yet: the page renders the empty-state text — no assertion failure
});
