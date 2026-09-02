/**
 * Stage 4 — Admin & User Management UI regression spec.
 *
 * Covers all Definition of Done items that are practical to automate:
 *   - Auth-UX: same-org login redirect, cross-org notice (security invariants)
 *   - RBAC gating: admin section behind MANAGE_USERS / MANAGE_FEATURES
 *   - Users CRUD: create (with duplicate-username error path), deactivate,
 *     self-deactivation guard, change role
 *   - Roles CRUD: create, add/remove permissions
 *   - Permissions: catalog inert caveat, create (with duplicate-code error path)
 *   - Tenancy isolation: action links scoped to the session org
 *
 * Items verified manually but not automated (noted in the bug report):
 *   - Loading overlay visibility (sub-second transitions; hard to assert reliably)
 *   - Submit-button disable during pending (same reason)
 *   - Password-field-clear-after-set (side effect of server redirect; behaviour
 *     verified manually in the test run — page reloads with empty field)
 *   - Login round-trip for a created user (tested via curl — auth API response)
 *
 * Known debt (from profile §11): networkidle waits in pricing-stage3.spec.ts
 * should be replaced with explicit DOM assertions. That debt is not introduced
 * here; all waits in this file use explicit locator expectations.
 */

import { test, expect } from "@playwright/test";
import { signIn, orgUrl, orgUrlPattern } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

// Rate-limit pacing: better-auth limits sign-in to 3 per 10 seconds per IP.
// Almost every test in this file signs in; 7-second beforeEach spaces sign-in
// calls 11+ seconds apart so the rate-limit window always resets.
test.beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 7_000));
});

// ---------------------------------------------------------------------------
// Auth-UX: login page behaviour for authenticated users (Stage 4 item 4)
// ---------------------------------------------------------------------------

test("same-org login page redirects authenticated user to dashboard", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto(orgUrl("acme-glass", "/login"));
  await expect(page).toHaveURL(orgUrlPattern("acme-glass", "/dashboard"));
});

test("cross-org login page shows 'already signed in' notice naming only the session org", async ({
  page,
}) => {
  await signIn(page, "admin", undefined, "acme-glass");
  await page.goto(orgUrl("nordic-walls", "/login"));

  // Should show the cross-org notice, not the login form
  await expect(
    page.getByRole("heading", { name: /already signed in/i }),
  ).toBeVisible({ timeout: 15_000 });

  // Notice must name the SESSION org (Acme Glass Co.) — never the URL org
  const pageText = await page.textContent("body");
  expect(pageText).toContain("Acme Glass Co.");
  // Must not reveal the URL org's identity — security invariant
  expect(pageText).not.toContain("Nordic Walls");

  // Both action buttons must be present (loose match — exact copy will change with wireframe)
  await expect(page.getByRole("button", { name: /log out|sign out/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /dashboard/i })).toBeVisible();
});

test("cross-org notice: 'Go to my dashboard' navigates to session-org dashboard", async ({
  page,
}) => {
  await signIn(page, "admin", undefined, "acme-glass");
  await page.goto(orgUrl("nordic-walls", "/login"));
  await expect(
    page.getByRole("heading", { name: /already signed in/i }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /dashboard/i }).click();
  await expect(page).toHaveURL(orgUrlPattern("acme-glass", "/dashboard"), { timeout: 15_000 });
});

test("cross-org notice: logout clears session and shows destination org login form", async ({
  page,
}) => {
  await signIn(page, "admin", undefined, "acme-glass");
  await page.goto(orgUrl("nordic-walls", "/login"));
  await expect(
    page.getByRole("heading", { name: /already signed in/i }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /log out|sign out/i }).click();
  // After logout, the login form must be present (username input signals we're on the real login page)
  // Stage 10 Task 1.4: login label changed "Username" → "User ID"; use autocomplete attribute as stable anchor.
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
});

// ---------------------------------------------------------------------------
// RBAC: admin section gating
// ---------------------------------------------------------------------------

test("unauthenticated request to admin/users redirects to login", async ({ page }) => {
  await page.goto(orgUrl("acme-glass", "/admin/users"));
  await expect(page).toHaveURL(orgUrlPattern("acme-glass", "/login"));
});

test("distributor role is denied MANAGE_USERS admin page (redirects to dashboard)", async ({
  page,
}) => {
  // Rate-limit pacing: tests 1-4 each sign in within ~11s. Wait for the window to clear
  // before the next sign-in so better-auth's 3/10s limit is not hit.
  await page.waitForTimeout(8_000);
  await signIn(page, "distributor");
  // MANAGE_USERS gate: admin/users must redirect to dashboard for distributor
  await page.goto(orgUrl("acme-glass", "/admin/users"), { waitUntil: "commit" });
  await page.waitForURL(orgUrlPattern("acme-glass", "/dashboard"), { timeout: 15_000 });
  // Note (Stage 16 Batch F): admin/roles and admin/permissions are removed from the org
  // admin UI — those routes now return 404, no longer need RBAC-redirect testing here.
});

test("admin side panel shows admin section links (Users link visible)", async ({ page }) => {
  // Rate-limit pause: the 3 preceding RBAC tests each sign in within ~10 seconds total.
  // better-auth limits sign-ins to 3/10s per IP; wait for the window to clear.
  await page.waitForTimeout(5_000);
  await signIn(page, "admin");
  // Stage 11: Admin links moved into a CSS hover flyout (group-hover:visible).
  // Must hover over the "Admin" trigger button first to reveal the flyout,
  // otherwise the link exists in the DOM but has visibility:hidden → toBeVisible() fails.
  const adminTrigger = page.getByRole("button", { name: "Admin" });
  await expect(adminTrigger).toBeVisible({ timeout: 15_000 });
  await adminTrigger.hover();
  // Flyout is visible; now the Users link must be visible too.
  await expect(page.getByRole("link", { name: "Users" })).toBeVisible({ timeout: 5_000 });
});

test("distributor dashboard does not show admin section links", async ({ page }) => {
  await signIn(page, "distributor");
  // Distributor has no MANAGE_USERS / MANAGE_FEATURES → Admin section links must be hidden.
  await expect(page.getByRole("link", { name: "Users" })).not.toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// Users: create, duplicate-username error, tenancy, self-deactivation guard
// ---------------------------------------------------------------------------

test("create user: duplicate username shows inline error, stays on create page", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto(orgUrl("acme-glass", "/admin/users/new"));
  // Batch 7g: First Name and Last Name are now required — must fill to reach server-side validation.
  await page.getByRole("textbox", { name: "First Name" }).fill("Test");
  await page.getByRole("textbox", { name: "Last Name" }).fill("User");
  await page.getByRole("textbox", { name: "Username" }).fill("admin");
  await page.getByRole("textbox", { name: "Initial Password" }).fill("Test12345!");
  await page.getByRole("button", { name: "Create User" }).click();
  // Must stay on the create page (not crash to error boundary)
  await expect(page).toHaveURL(orgUrlPattern("acme-glass", "/admin/users/new"));
  await expect(page.getByText(/already taken/i)).toBeVisible({ timeout: 15_000 });
});

test("create user: valid user appears in the users list", async ({ page }) => {
  const username = `e2e_${Date.now()}`;
  await signIn(page, "admin");
  await page.goto(orgUrl("acme-glass", "/admin/users/new"));
  // Batch 7g: First Name and Last Name are now required.
  await page.getByRole("textbox", { name: "First Name" }).fill("E2E");
  await page.getByRole("textbox", { name: "Last Name" }).fill("Tester");
  await page.getByRole("textbox", { name: "Username" }).fill(username);
  // Stage 15 U3 (Batch G): external roles (Distributor) now require an external company.
  // Use Company Member (an internal role, isInternalRole:true) so no company is needed here.
  // The U3 rule itself is verified by stage15-user-mgmt.spec.ts.
  await page.getByLabel("Role").selectOption("Company Member");
  await page.getByRole("textbox", { name: "Initial Password" }).fill("Test1234!");
  await page.getByRole("button", { name: "Create User" }).click();
  // Redirects to users list
  await expect(page).toHaveURL(orgUrlPattern("acme-glass", "/admin/users$"), { timeout: 15_000 });
  // Stage 14 Batch D: the actions cell now contains "Edit" + "Delete user <username>"
  // which gives that cell an accessible name that also includes the username — causing
  // a strict-mode violation without exact: true. The username cell itself has an exact
  // accessible name equal to the username string.
  await expect(page.getByRole("cell", { name: username, exact: true }).first()).toBeVisible();
});

test("users list: all action links belong to the session org (tenancy check)", async ({
  page,
}) => {
  await signIn(page, "admin", undefined, "acme-glass");
  await page.goto(orgUrl("acme-glass", "/admin/users"));
  // Stage 14 Batch D: "Actions" text link replaced by icon-only Edit link (aria-label="Edit").
  const actionLinks = page.getByRole("link", { name: "Edit" });
  // .count() does not auto-wait — wait for at least one link to appear first so
  // we don't sample an empty table while the page is still streaming.
  await expect(actionLinks.first()).toBeVisible({ timeout: 15_000 });
  const count = await actionLinks.count();
  expect(count).toBeGreaterThanOrEqual(1);
  for (let i = 0; i < count; i++) {
    const href = await actionLinks.nth(i).getAttribute("href");
    // Tenancy invariant: every Edit link must point to THIS org's admin/users detail URL.
    // Positive allowlist — passes only the two valid shapes, fails on any third org:
    //   Path mode (Vercel preview):      /acme-glass/admin/users/{uuid}
    //   Subdomain mode (easeetool.com):  /admin/users/{uuid}
    // A leak to /nordic-walls/admin/users/{uuid} or any other slug does NOT match
    // this pattern (starts with wrong prefix) → toMatch throws → test fails → leak caught.
    expect(href).toMatch(/^(\/acme-glass)?\/admin\/users\/[0-9a-f-]{36}$/);
  }
});

test("self-deactivation: Deactivate button disabled on own account with explanatory message", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto(orgUrl("acme-glass", "/admin/users"));
  // Find the row where the username cell is exactly "admin", click its Edit icon link.
  // Stage 14 Batch D: "Actions" text link replaced by icon-only Edit link (aria-label="Edit").
  const adminRow = page
    .locator("tr")
    .filter({ has: page.getByRole("cell", { name: "admin", exact: true }) });
  // Wait for the row to appear (users table renders after SSR stream completes).
  await expect(adminRow).toBeVisible({ timeout: 15_000 });
  await adminRow.getByRole("link", { name: "Edit" }).click();
  await page.waitForURL(orgUrlPattern("acme-glass", "/admin/users/.+"), { timeout: 15_000 });
  // User edit page renders via RSC; allow 15 s for the Deactivate button to appear.
  await expect(page.getByRole("button", { name: "Deactivate" })).toBeDisabled({ timeout: 15_000 });
  await expect(
    page.getByText(/cannot deactivate your own account/i),
  ).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// NOTE (Stage 16 Batch F): Roles and Permissions sections removed.
// The org-admin roles/permissions UI (app/[orgSlug]/admin/roles/**,
// app/[orgSlug]/admin/permissions/**) has been deleted. Roles and permissions
// management is now exclusively in the SuperAdmin console (/controls/roles).
// See tests/e2e/superadmin-roles.spec.ts for the replacement coverage.
// ---------------------------------------------------------------------------
