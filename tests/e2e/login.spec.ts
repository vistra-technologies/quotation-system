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
 *
 * --- Rate-limit note ---
 * better-auth's default rate limiter caps /sign-in* at 3 requests per 10s
 * (window: 10, max: 3) keyed by clientIp:path.  To stay within that budget
 * across the whole serial run this file shares the admin browser session via
 * storageState rather than firing a fresh sign-in POST in every beforeAll /
 * afterAll hook.  See the "inactive account" describe block for details.
 */

import { test, expect } from "@playwright/test";

// Serial: some tests mutate shared auth state (cross-org session, inactive
// account) that would interfere with concurrent runs.
test.describe.configure({ mode: "serial" });

const ORG = "acme-glass"; // primary test org
const ORG2 = "vistra"; // secondary org for cross-org test
const LOGIN_URL = `/${ORG}/login`;
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "Seed1234!";

// Playwright StorageState shape (cookies + origins) — matches both the return
// type of BrowserContext.storageState() and the storageState option accepted
// by Browser.newContext().
type StorageState = Awaited<
  ReturnType<import("@playwright/test").BrowserContext["storageState"]>
>;

// Admin session captured after test 1's sign-in and reused in the
// "inactive account" describe block's beforeAll, eliminating one of the four
// sign-in POSTs that would otherwise exceed better-auth's 3-per-10s limit.
// (Each test gets a fresh browser context from Playwright's fixture, so
// omitting an explicit sign-out here does not break test isolation.)
let adminStorageState: StorageState | undefined;

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
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Sign in/i }).click();
  await page.waitForURL(new RegExp(`/${ORG}/dashboard`), { timeout: 30_000 });
  expect(page.url()).toContain(`/${ORG}/dashboard`);

  // Capture the authenticated admin session so "inactive account" beforeAll/
  // afterAll can reuse it via storageState instead of firing fresh sign-in
  // POSTs.  Playwright cleans up each test's browser context independently,
  // so the server-side session remains valid for reuse without an explicit
  // sign-out here.
  adminStorageState = await page.context().storageState();
});

// ---------------------------------------------------------------------------
// 2. Wrong password → error message rendered
// ---------------------------------------------------------------------------
test("wrong password shows error message", async ({ page }) => {
  await goToLogin(page);
  await page.getByLabel("User ID").fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("definitely-wrong-password-123");
  await page.getByRole("button", { name: /Sign in/i }).click();

  // Error paragraph (role="alert") should appear; URL must not change
  // Use p[role="alert"] — the app's error element is a <p>, not Next.js's
  // <div id="__next-route-announcer__" role="alert"> which is always in the DOM.
  const alert = page.locator('p[role="alert"]');
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(new RegExp(`/${ORG}/login`));
});

// ---------------------------------------------------------------------------
// 3. Empty username → form blocks submission
// ---------------------------------------------------------------------------
test("empty username blocks form submission", async ({ page }) => {
  await goToLogin(page);
  // Fill password but leave username empty
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Sign in/i }).click();

  // HTML5 required validation fires; page must stay on login
  await expect(page).toHaveURL(new RegExp(`/${ORG}/login`));
  // No app error alert should appear (browser-native validation, not JS error).
  // Scope to <p role="alert"> to exclude Next.js's always-present
  // <div id="__next-route-announcer__" role="alert">.
  await expect(page.locator('p[role="alert"]')).not.toBeVisible();
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
  await expect(page.locator('p[role="alert"]')).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// 5. Inactive account → error surfaced
// Uses admin UI flow to deactivate a test user before the test, then
// restores the user afterward via afterAll.
//
// Rate-limit budget: better-auth caps /sign-in* at 3 requests per 10s.
// Across this file the sign-in POSTs are: test 1 (admin correct), test 2
// (admin wrong password), test 5 (architect, deactivated) = 3 total in the
// relevant burst window.  beforeAll and afterAll reuse the admin session
// captured in test 1 via storageState, so neither fires a sign-in POST.
// ---------------------------------------------------------------------------
test.describe("inactive account", () => {
  let architectUserId = "";

  // Admin session state saved from beforeAll — reused in afterAll so no
  // second sign-in POST is needed to restore the architect account.
  let savedAdminCtxState: StorageState | undefined;

  test.beforeAll(async ({ browser }) => {
    // Reuse the admin session from test 1 if available; otherwise fall back
    // to a fresh sign-in (should only happen if test 1 failed before saving).
    const ctx = adminStorageState
      ? await browser.newContext({ storageState: adminStorageState })
      : await browser.newContext();
    const adminPage = await ctx.newPage();
    try {
      if (adminStorageState) {
        // Session already authenticated — navigate directly, no sign-in POST.
        await adminPage.goto(`/${ORG}/admin/users`);
        // If the session were somehow invalid we'd be redirected to login;
        // waitForURL confirms we landed on the users page.
        await adminPage.waitForURL(new RegExp(`/${ORG}/admin/users`), {
          timeout: 30_000,
        });
      } else {
        // Fallback: fresh sign-in (counts against the rate-limit budget).
        await adminPage.goto(LOGIN_URL);
        await expect(
          adminPage.locator('input[autocomplete="username"]'),
        ).toBeVisible({ timeout: 30_000 });
        await adminPage.getByLabel("User ID").fill("admin");
        await adminPage.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
        await adminPage.getByRole("button", { name: /Sign in/i }).click();
        await adminPage.waitForURL(new RegExp(`/${ORG}/dashboard`), {
          timeout: 30_000,
        });
        await adminPage.goto(`/${ORG}/admin/users`);
      }

      // Navigate to admin users list, find the "architect" row, open their detail
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

      // Save context state for afterAll to reuse — avoids a second sign-in POST.
      savedAdminCtxState = await ctx.storageState();
    } finally {
      await ctx.close();
    }
  });

  test("inactive account login shows deactivated error", async ({ page }) => {
    await goToLogin(page);
    await page.getByLabel("User ID").fill("architect");
    await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /Sign in/i }).click();

    // Use p[role="alert"] — the app's error element is a <p>, not Next.js's
    // <div id="__next-route-announcer__" role="alert"> which is always in the DOM.
    const alert = page.locator('p[role="alert"]');
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText("deactivated");

    // Must stay on login page
    await expect(page).toHaveURL(new RegExp(`/${ORG}/login`));
  });

  test.afterAll(async ({ browser }) => {
    if (!architectUserId) return; // nothing to clean up

    // Reuse the admin session from beforeAll; fall back to fresh sign-in only
    // if savedAdminCtxState was not captured (e.g. beforeAll threw early).
    const ctx = savedAdminCtxState
      ? await browser.newContext({ storageState: savedAdminCtxState })
      : await browser.newContext();
    const adminPage = await ctx.newPage();
    try {
      if (!savedAdminCtxState) {
        // Fallback: fresh sign-in.
        await adminPage.goto(LOGIN_URL);
        await expect(
          adminPage.locator('input[autocomplete="username"]'),
        ).toBeVisible({ timeout: 30_000 });
        await adminPage.getByLabel("User ID").fill("admin");
        await adminPage.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
        await adminPage.getByRole("button", { name: /Sign in/i }).click();
        await adminPage.waitForURL(new RegExp(`/${ORG}/dashboard`), {
          timeout: 30_000,
        });
      }

      // Reactivate the architect user — navigate directly to their detail page.
      await adminPage.goto(`/${ORG}/admin/users/${architectUserId}`);
      await adminPage.waitForURL(
        new RegExp(`/${ORG}/admin/users/${architectUserId}`),
        { timeout: 15_000 },
      );
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
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);

  // Rate-limit guard: this is the 4th real sign-in POST in the suite (tests 1,
  // 2, and 5 each send one; tests 3 and 4 are blocked by HTML5 validation before
  // reaching the server).  better-auth's default rate limiter allows at most 3
  // /sign-in* requests per 10-second window per IP (see
  // node_modules/better-auth/dist/api/rate-limiter/index.mjs,
  // getDefaultSpecialRules() — window: 10, max: 3).  Without a wait, all four
  // POSTs can land within the same 10s window and this one gets silently 429'd,
  // causing waitForURL below to time out instead of showing an error message.
  //
  // 11 000 ms is just over the 10s window — enough to guarantee the limiter's
  // counter has reset regardless of how fast tests 1–5 ran.  This is NOT a
  // general flaky-test workaround; it is a deliberate, bounded pause tied to a
  // known, documented rate-limiter contract.  Do not add similar waits elsewhere
  // in this file — only this test lands as the 4th consecutive real POST.
  await page.waitForTimeout(11_000);

  await page.getByRole("button", { name: /Sign in/i }).click();
  await page.waitForURL(new RegExp(`/${ORG2}/dashboard`), { timeout: 30_000 });

  // Navigate to a different org's (ORG = acme-glass) login page
  await page.goto(LOGIN_URL);

  // Cross-org notice must render
  await expect(
    page.getByRole("heading", { name: /already signed in/i }),
  ).toBeVisible({ timeout: 15_000 });

  // Notice must name the SESSION org (Vistra Partitions), not the URL org.
  // Scoped to <p> to avoid matching the "Log out of Vistra Partitions" <button>
  // which also contains this text (getByText on its own is too broad here).
  await expect(page.locator("p", { hasText: /Vistra Partitions/ })).toBeVisible();
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
// 8. Remember-me checkbox: removed in the 2026-07-23 hotfix — must be absent
// ---------------------------------------------------------------------------
test("remember-me checkbox is absent", async ({ page }) => {
  await goToLogin(page);

  // The checkbox was removed entirely (not hidden) — assert count 0 so a future
  // accidental re-addition is caught as a regression.
  await expect(
    page.getByRole("checkbox", { name: /remember me/i }),
  ).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 8b. Contact popup — "Contact here" opens a support dialog; closes via button
//     and via backdrop; added 2026-07-23 hotfix.
// ---------------------------------------------------------------------------
test.describe("contact popup", () => {
  test("Contact here button opens support popup with phone and email", async ({
    page,
  }) => {
    await goToLogin(page);

    await page.getByRole("button", { name: /contact here/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Phone link — href is the tel: URI; visible text is the formatted number.
    const phoneLink = page.getByRole("link", { name: "+91 8149007006" });
    await expect(phoneLink).toBeVisible();
    await expect(phoneLink).toHaveAttribute("href", "tel:+918149007006");

    // Email link
    const emailLink = page.getByRole("link", {
      name: "support@easeetool.com",
    });
    await expect(emailLink).toBeVisible();
    await expect(emailLink).toHaveAttribute(
      "href",
      "mailto:support@easeetool.com",
    );
  });

  test("contact popup closes via close button", async ({ page }) => {
    await goToLogin(page);
    await page.getByRole("button", { name: /contact here/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });

    await page.getByRole("button", { name: "Close" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("contact popup closes via backdrop click", async ({ page }) => {
    await goToLogin(page);
    await page.getByRole("button", { name: /contact here/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });

    // Click the fixed backdrop overlay at a corner well outside the inner card.
    // The backdrop is the outermost fixed div; clicking inside the card is
    // stopped by stopPropagation, so we target {x:5, y:5} (top-left corner).
    await page.locator(".fixed.inset-0").click({ position: { x: 5, y: 5 } });

    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
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
