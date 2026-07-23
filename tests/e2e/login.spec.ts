/**
 * Login page spec — Task 1.5 (UI-inclusive exception).
 *
 * This is the ONE file this stage that includes DOM/layout/styling assertions,
 * per the explicit one-time exception documented in stage-10.md §1.5 and
 * decision #3.  The login page mockup was declared >90% final by the human,
 * lifting CLAUDE.md working-agreement rule 5 for this page only.
 *
 * All other new pages this stage (project-details restyle, configuration
 * restyle, orders placeholder) stay under the normal rule — behavior-level
 * assertions only, no DOM/layout/styling checks.
 *
 * Runs against localhost using the path-based proxy fallback (proxy.ts) — no
 * *.localhost DNS configuration required for local/CI runs.
 *
 * Run against the deployed preview:
 *   PLAYWRIGHT_BASE_URL=https://<branch-url>.vercel.app npx playwright test login
 */

import { test, expect } from "@playwright/test";

// Serial: some tests mutate shared auth state (cross-org session, inactive
// account) that would interfere with concurrent runs.
test.describe.configure({ mode: "serial" });

const ORG = "acme-glass"; // primary test org
const ORG2 = "vistra"; // secondary org for cross-org test
const LOGIN_URL = `/${ORG}/login`;
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "Seed1234!";

// ---------------------------------------------------------------------------
// Shared helper — navigate to login page and wait for the form to be ready
// ---------------------------------------------------------------------------
async function goToLogin(page: import("@playwright/test").Page, orgSlug = ORG) {
  await page.goto(`/${orgSlug}/login`);
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({
    timeout: 30_000,
  });
}

// ---------------------------------------------------------------------------
// 1. Correct credentials → redirect to dashboard
// ---------------------------------------------------------------------------
test("correct credentials redirect to dashboard", async ({ page }) => {
  await goToLogin(page);
  await page.getByLabel("User ID").fill("admin");
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Sign in/i }).click();
  await page.waitForURL(new RegExp(`/${ORG}/dashboard`), { timeout: 30_000 });
  expect(page.url()).toContain(`/${ORG}/dashboard`);

  // Sign out so subsequent tests start unauthenticated
  await page.getByRole("button", { name: /Sign out/i }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({
    timeout: 15_000,
  });
});

// ---------------------------------------------------------------------------
// 2. Wrong password → error message rendered
// ---------------------------------------------------------------------------
test("wrong password shows error message", async ({ page }) => {
  await goToLogin(page);
  await page.getByLabel("User ID").fill("admin");
  await page.getByLabel("Password").fill("definitely-wrong-password-123");
  await page.getByRole("button", { name: /Sign in/i }).click();

  // Error paragraph (role="alert") should appear; URL must not change
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(new RegExp(`/${ORG}/login`));
});

// ---------------------------------------------------------------------------
// 3. Empty username → form blocks submission
// ---------------------------------------------------------------------------
test("empty username blocks form submission", async ({ page }) => {
  await goToLogin(page);
  // Fill password but leave username empty
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Sign in/i }).click();

  // HTML5 required validation fires; page must stay on login
  await expect(page).toHaveURL(new RegExp(`/${ORG}/login`));
  // No error alert should appear (browser-native validation, not JS error)
  await expect(page.getByRole("alert")).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// 4. Empty password → form blocks submission
// ---------------------------------------------------------------------------
test("empty password blocks form submission", async ({ page }) => {
  await goToLogin(page);
  // Fill username but leave password empty
  await page.getByLabel("User ID").fill("admin");
  await page.getByRole("button", { name: /Sign in/i }).click();

  // HTML5 required validation fires; page must stay on login
  await expect(page).toHaveURL(new RegExp(`/${ORG}/login`));
  await expect(page.getByRole("alert")).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// 5. Inactive account → error surfaced
// Uses admin UI flow to deactivate a test user before the test, then
// restores the user afterward via afterAll.
// ---------------------------------------------------------------------------
test.describe("inactive account", () => {
  let architectUserId = "";

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const adminPage = await ctx.newPage();
    try {
      // Sign in as admin
      await adminPage.goto(LOGIN_URL);
      await expect(
        adminPage.locator('input[autocomplete="username"]'),
      ).toBeVisible({ timeout: 30_000 });
      await adminPage.getByLabel("User ID").fill("admin");
      await adminPage.getByLabel("Password").fill(ADMIN_PASSWORD);
      await adminPage.getByRole("button", { name: /Sign in/i }).click();
      await adminPage.waitForURL(new RegExp(`/${ORG}/dashboard`), {
        timeout: 30_000,
      });

      // Navigate to admin users list, find the "architect" row, open their detail
      await adminPage.goto(`/${ORG}/admin/users`);
      const architectRow = adminPage
        .locator("table tbody tr")
        .filter({ has: adminPage.locator("td:first-child", { hasText: "architect" }) });
      await architectRow.getByRole("link", { name: "Actions" }).click();
      await adminPage.waitForURL(/\/admin\/users\/[^/]+$/, { timeout: 15_000 });
      architectUserId = adminPage.url().split("/").pop() ?? "";

      // Deactivate the architect user
      await adminPage.getByRole("button", { name: "Deactivate" }).click();
      // Activation button appears once deactivation succeeds
      await expect(
        adminPage.getByRole("button", { name: "Activate" }),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctx.close();
    }
  });

  test("inactive account login shows deactivated error", async ({ page }) => {
    await goToLogin(page);
    await page.getByLabel("User ID").fill("architect");
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /Sign in/i }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText("deactivated");

    // Must stay on login page
    await expect(page).toHaveURL(new RegExp(`/${ORG}/login`));
  });

  test.afterAll(async ({ browser }) => {
    if (!architectUserId) return; // nothing to clean up

    const ctx = await browser.newContext();
    const adminPage = await ctx.newPage();
    try {
      // Sign in as admin
      await adminPage.goto(LOGIN_URL);
      await expect(
        adminPage.locator('input[autocomplete="username"]'),
      ).toBeVisible({ timeout: 30_000 });
      await adminPage.getByLabel("User ID").fill("admin");
      await adminPage.getByLabel("Password").fill(ADMIN_PASSWORD);
      await adminPage.getByRole("button", { name: /Sign in/i }).click();
      await adminPage.waitForURL(new RegExp(`/${ORG}/dashboard`), {
        timeout: 30_000,
      });

      // Reactivate the architect user
      await adminPage.goto(`/${ORG}/admin/users/${architectUserId}`);
      await adminPage.getByRole("button", { name: "Activate" }).click();
      // Deactivation button appears once reactivation succeeds
      await expect(
        adminPage.getByRole("button", { name: "Deactivate" }),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctx.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Cross-org notice: renders when a different-org session exists;
//    names only the session org, never the URL org
// ---------------------------------------------------------------------------
test("cross-org notice names only the session org", async ({ page }) => {
  // Sign in to ORG2 (vistra)
  await goToLogin(page, ORG2);
  await page.getByLabel("User ID").fill("admin");
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Sign in/i }).click();
  await page.waitForURL(new RegExp(`/${ORG2}/dashboard`), { timeout: 30_000 });

  // Navigate to a different org's (ORG = acme-glass) login page
  await page.goto(LOGIN_URL);

  // Cross-org notice must render
  await expect(
    page.getByRole("heading", { name: /already signed in/i }),
  ).toBeVisible({ timeout: 15_000 });

  // Notice must name the SESSION org (Vistra Partitions), not the URL org
  await expect(page.getByText(/Vistra Partitions/)).toBeVisible();
  // Acme Glass Co. must NOT appear anywhere in the notice
  await expect(page.getByText(/Acme Glass/i)).not.toBeVisible();

  // Cleanup: sign out via the notice's logout button
  await page.getByRole("button", { name: /Log out of/i }).click();
  // After logout, the login form for ORG should render
  await expect(
    page.locator('input[autocomplete="username"]'),
  ).toBeVisible({ timeout: 15_000 });
});

// ---------------------------------------------------------------------------
// 7. Password reveal toggle: field type changes; aria-label updates Show↔Hide
// ---------------------------------------------------------------------------
test("password reveal toggle changes field type and aria-label", async ({
  page,
}) => {
  await goToLogin(page);

  const passwordInput = page.locator("#password");
  const showBtn = page.getByRole("button", { name: "Show password" });

  // Initial state: password hidden
  await expect(passwordInput).toHaveAttribute("type", "password");
  await expect(showBtn).toBeVisible();

  // Reveal
  await showBtn.click();

  await expect(passwordInput).toHaveAttribute("type", "text");
  const hideBtn = page.getByRole("button", { name: "Hide password" });
  await expect(hideBtn).toBeVisible();

  // Hide again
  await hideBtn.click();

  await expect(passwordInput).toHaveAttribute("type", "password");
  await expect(page.getByRole("button", { name: "Show password" })).toBeVisible();
});

// ---------------------------------------------------------------------------
// 8. Remember-me checkbox: present and checked by default
// ---------------------------------------------------------------------------
test("remember-me checkbox is present and checked by default", async ({
  page,
}) => {
  await goToLogin(page);

  const checkbox = page.getByRole("checkbox", { name: /remember me/i });
  await expect(checkbox).toBeVisible();
  await expect(checkbox).toBeChecked();
});

// ---------------------------------------------------------------------------
// 9. autocomplete attributes: username on user-id field, current-password on password
// ---------------------------------------------------------------------------
test("autocomplete attributes are correct", async ({ page }) => {
  await goToLogin(page);

  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
  await expect(
    page.locator('input[autocomplete="current-password"]'),
  ).toBeVisible();
});

// ---------------------------------------------------------------------------
// 10. Mobile viewport (390px): no horizontal overflow
// ---------------------------------------------------------------------------
test("mobile viewport has no horizontal overflow", async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 14 dimensions
  });
  const mobilePage = await ctx.newPage();
  try {
    await mobilePage.goto(LOGIN_URL);
    await expect(
      mobilePage.locator('input[autocomplete="username"]'),
    ).toBeVisible({ timeout: 30_000 });

    // Horizontal overflow check: scrollWidth must not exceed clientWidth
    const hasOverflow = await mobilePage.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasOverflow).toBe(false);
  } finally {
    await ctx.close();
  }
});
