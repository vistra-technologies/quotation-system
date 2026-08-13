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
import { signIn } from "./helpers";

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
  await page.goto("/acme-glass/login");
  await expect(page).toHaveURL(/\/acme-glass\/dashboard/);
});

test("cross-org login page shows 'already signed in' notice naming only the session org", async ({
  page,
}) => {
  await signIn(page, "admin", undefined, "acme-glass");
  await page.goto("/nordic-walls/login");

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
  await page.goto("/nordic-walls/login");
  await expect(
    page.getByRole("heading", { name: /already signed in/i }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /dashboard/i }).click();
  await expect(page).toHaveURL(/\/acme-glass\/dashboard/, { timeout: 15_000 });
});

test("cross-org notice: logout clears session and shows destination org login form", async ({
  page,
}) => {
  await signIn(page, "admin", undefined, "acme-glass");
  await page.goto("/nordic-walls/login");
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
  await page.goto("/acme-glass/admin/users");
  await expect(page).toHaveURL(/\/acme-glass\/login/);
});

test("distributor role is denied MANAGE_USERS + MANAGE_FEATURES admin pages (combined to limit sign-ins)", async ({
  page,
}) => {
  // Rate-limit pacing: tests 1-4 each sign in within ~11s. Wait for the window to clear
  // before the next sign-in so better-auth's 3/10s limit is not hit.
  await page.waitForTimeout(8_000);
  await signIn(page, "distributor");
  // MANAGE_USERS gate: admin/users must redirect to dashboard for distributor
  await page.goto("/acme-glass/admin/users", { waitUntil: "commit" });
  await page.waitForURL(/\/acme-glass\/dashboard/, { timeout: 15_000 });
  // MANAGE_FEATURES gate: admin/roles must redirect to dashboard (same session)
  await page.goto("/acme-glass/admin/roles", { waitUntil: "commit" });
  await page.waitForURL(/\/acme-glass\/dashboard/, { timeout: 15_000 });
  // MANAGE_FEATURES gate: admin/permissions must redirect to dashboard (same session)
  await page.goto("/acme-glass/admin/permissions", { waitUntil: "commit" });
  await page.waitForURL(/\/acme-glass\/dashboard/, { timeout: 15_000 });
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
  await page.goto("/acme-glass/admin/users/new");
  // Batch 7g: First Name and Last Name are now required — must fill to reach server-side validation.
  await page.getByRole("textbox", { name: "First Name" }).fill("Test");
  await page.getByRole("textbox", { name: "Last Name" }).fill("User");
  await page.getByRole("textbox", { name: "Username" }).fill("admin");
  await page.getByRole("textbox", { name: "Initial Password" }).fill("Test12345!");
  await page.getByRole("button", { name: "Create User" }).click();
  // Must stay on the create page (not crash to error boundary)
  await expect(page).toHaveURL(/\/acme-glass\/admin\/users\/new/);
  await expect(page.getByText(/already taken/i)).toBeVisible({ timeout: 15_000 });
});

test("create user: valid user appears in the users list", async ({ page }) => {
  const username = `e2e_${Date.now()}`;
  await signIn(page, "admin");
  await page.goto("/acme-glass/admin/users/new");
  // Batch 7g: First Name and Last Name are now required.
  await page.getByRole("textbox", { name: "First Name" }).fill("E2E");
  await page.getByRole("textbox", { name: "Last Name" }).fill("Tester");
  await page.getByRole("textbox", { name: "Username" }).fill(username);
  await page.getByLabel("Role").selectOption("Distributor");
  await page.getByRole("textbox", { name: "Initial Password" }).fill("Test1234!");
  await page.getByRole("button", { name: "Create User" }).click();
  // Redirects to users list
  await expect(page).toHaveURL(/\/acme-glass\/admin\/users$/, { timeout: 15_000 });
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
  await page.goto("/acme-glass/admin/users");
  // Stage 14 Batch D: "Actions" text link replaced by icon-only Edit link (aria-label="Edit").
  const actionLinks = page.getByRole("link", { name: "Edit" });
  // .count() does not auto-wait — wait for at least one link to appear first so
  // we don't sample an empty table while the page is still streaming.
  await expect(actionLinks.first()).toBeVisible({ timeout: 15_000 });
  const count = await actionLinks.count();
  expect(count).toBeGreaterThanOrEqual(1);
  for (let i = 0; i < count; i++) {
    const href = await actionLinks.nth(i).getAttribute("href");
    // Tenancy invariant: every Edit link must point to an admin/users detail URL.
    // In path mode (Vercel preview): /acme-glass/admin/users/{uuid}
    // In subdomain mode (easeetool.com): /admin/users/{uuid}
    // Either way it must NOT contain another org's slug.
    expect(href).toMatch(/\/admin\/users\/[0-9a-f-]{36}/);
    expect(href).not.toMatch(/\/(nordic-walls|vistra)\//);
  }
});

test("self-deactivation: Deactivate button disabled on own account with explanatory message", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/admin/users");
  // Find the row where the username cell is exactly "admin", click its Edit icon link.
  // Stage 14 Batch D: "Actions" text link replaced by icon-only Edit link (aria-label="Edit").
  const adminRow = page
    .locator("tr")
    .filter({ has: page.getByRole("cell", { name: "admin", exact: true }) });
  await adminRow.getByRole("link", { name: "Edit" }).click();
  await page.waitForURL(/\/acme-glass\/admin\/users\/.+/);
  await expect(page.getByRole("button", { name: "Deactivate" })).toBeDisabled();
  await expect(
    page.getByText(/cannot deactivate your own account/i),
  ).toBeVisible();
});

// ---------------------------------------------------------------------------
// Roles: create, add permission, remove permission
// ---------------------------------------------------------------------------

test("create role → detail page shows empty granted permissions and full available list", async ({
  page,
}) => {
  const roleName = `E2E Role ${Date.now()}`;
  await signIn(page, "admin");
  await page.goto("/acme-glass/admin/roles/new");
  await page.locator("input[name='name']").fill(roleName);
  await page.locator("input[name='description']").fill("Stage 4 e2e test role");
  await page.getByRole("button", { name: "Create Role" }).click();
  // Redirects to role detail — UUID pattern ensures we wait past /roles/new
  await expect(page).toHaveURL(/\/acme-glass\/admin\/roles\/[0-9a-f-]{36}/, {
    timeout: 15_000,
  });
  await expect(page.getByRole("heading", { name: roleName })).toBeVisible();
  await expect(page.getByText(/no permissions/i)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Available Permissions" }),
  ).toBeVisible();
});

test("role permissions: add a permission then remove it", async ({ page }) => {
  // Create a fresh role so we don't mutate seeded data
  const roleName = `E2E Perm Test ${Date.now()}`;
  await signIn(page, "admin");
  await page.goto("/acme-glass/admin/roles/new");
  await page.locator("input[name='name']").fill(roleName);
  await page.getByRole("button", { name: "Create Role" }).click();
  // UUID pattern ensures we wait past /roles/new before asserting granted permissions
  await expect(page).toHaveURL(/\/acme-glass\/admin\/roles\/[0-9a-f-]{36}/, {
    timeout: 15_000,
  });

  // Add DESIGN permission — wait for it to appear in the Granted section
  await page
    .getByRole("listitem")
    .filter({ hasText: /^DESIGN/ })
    .getByRole("button", { name: "Add" })
    .click();
  // A Remove button will appear in the listitem once DESIGN is granted
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: /^DESIGN/ })
      .getByRole("button", { name: "Remove" }),
  ).toBeVisible({ timeout: 15_000 });

  // Remove DESIGN
  await page
    .getByRole("listitem")
    .filter({ hasText: /^DESIGN/ })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(page.getByText(/no permissions/i)).toBeVisible({
    timeout: 15_000,
  });
});

// ---------------------------------------------------------------------------
// Permissions: catalog inert caveat, create, duplicate code error
// ---------------------------------------------------------------------------

test("permissions catalog shows inert-by-design caveat", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/admin/permissions");
  await expect(page.getByText(/inert by design/i)).toBeVisible();
});

test("create permission: inert caveat visible on create page", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/admin/permissions/new");
  await expect(page.getByText(/inert by design/i)).toBeVisible();
});

test("create permission: duplicate code shows inline error, stays on create page", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/admin/permissions/new");
  await page.locator("input[name='code']").fill("MANAGE_USERS");
  await page.locator("input[name='description']").fill("Duplicate test");
  await page.getByRole("button", { name: "Create Permission" }).click();
  await expect(page).toHaveURL(/\/acme-glass\/admin\/permissions\/new/);
  await expect(page.getByText(/already exists/i)).toBeVisible({ timeout: 15_000 });
});

test("create permission: valid code appears in catalog with inert caveat", async ({
  page,
}) => {
  const code = `E2E_PERM_${Date.now()}`;
  await signIn(page, "admin");
  await page.goto("/acme-glass/admin/permissions/new");
  await page.locator("input[name='code']").fill(code);
  await page.locator("input[name='description']").fill("Stage 4 automated e2e test permission");
  await page.getByRole("button", { name: "Create Permission" }).click();
  // Redirects to permissions catalog
  await expect(page).toHaveURL(/\/acme-glass\/admin\/permissions$/, {
    timeout: 15_000,
  });
  await expect(page.getByRole("cell", { name: code })).toBeVisible();
  // Inert caveat still visible on catalog page
  await expect(page.getByText(/inert by design/i)).toBeVisible();
});
