/**
 * Login page spec, REAL-credential half (split from login.spec.ts, Stage 28 test-infra cleanup).
 *
 * Everything here sends real sign-in POSTs / mutates real auth state, so it needs the org admin's
 * password: set TEST_ADMIN_PASSWORD (no default any more — a wrong default used to fail the first
 * test and skip the rest of the serial chain, masking 19 tests). Without it every test here is
 * skipped with a reported reason. The mocked / anonymous tests live in login.spec.ts.
 *
 * Fail-fast: a `beforeAll` probe signs in once through the API; if that fails (wrong password,
 * wrong org, rate-limited, target down) the whole file fails ONCE with the actual status instead of
 * a confusing chain of downstream timeouts.
 *
 * LOGIN_E2E_ORG picks the org (default acme-glass); the cross-org test also needs "vistra".
 *
 * --- Rate-limit note ---
 * better-auth's default rate limiter caps /sign-in* at 3 requests per 10s (window: 10, max: 3)
 * keyed by clientIp:path. Real POSTs in this file: probe, test 1, test 2, inactive-account test,
 * cross-org test. The probe is followed by a bounded 11s pause so the window resets, the admin
 * session from test 1 is reused via storageState (no extra POSTs in the inactive-account hooks), and
 * the cross-org test keeps its own 11s pause.
 */

import { test, expect } from "@playwright/test";
import { orgUrl, orgUrlPattern, apiUrl } from "./helpers";
import { toAuthEmail } from "@/lib/auth-utils";

const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;
const ORG = process.env.LOGIN_E2E_ORG ?? "acme-glass";
const ORG2 = "vistra"; // secondary org for cross-org test
const LOGIN_URL = orgUrl(ORG, "/login");

// Playwright StorageState shape (cookies + origins).
type StorageState = Awaited<
  ReturnType<import("@playwright/test").BrowserContext["storageState"]>
>;

// Admin session captured after test 1's sign-in and reused by the "inactive account" hooks.
let adminStorageState: StorageState | undefined;

async function goToLogin(page: import("@playwright/test").Page, orgSlug = ORG) {
  await page.goto(orgUrl(orgSlug, "/login"));
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({
    timeout: 30_000,
  });
}

// Serial: these tests mutate shared auth state (cross-org session, inactive account).
test.describe("login — real credentials", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(
    !ADMIN_PASSWORD,
    "TEST_ADMIN_PASSWORD is not set — real-credential login tests need the org admin password (mocked tests: login.spec.ts)",
  );

  // Fail-fast probe: one real API sign-in, so a bad password/org/target fails here once, loudly.
  test.beforeAll(async ({ browser }) => {
    // A browser context inherits the config's baseURL + Vercel bypass headers.
    const ctx = await browser.newContext();
    try {
      const resp = await ctx.request.post(apiUrl(ORG, "/api/auth/sign-in/email"), {
        data: { email: toAuthEmail("admin", ORG), password: ADMIN_PASSWORD },
      });
      if (!resp.ok()) {
        throw new Error(
          `login probe failed: admin@${ORG} sign-in returned ${resp.status()} — check TEST_ADMIN_PASSWORD / LOGIN_E2E_ORG / the target; the real-credential tests were not run`,
        );
      }
    } finally {
      await ctx.close();
    }
    // Stay inside better-auth's 3-sign-in-POSTs-per-10s budget for the tests below.
    await new Promise((r) => setTimeout(r, 11_000));
  });

  // ---------------------------------------------------------------------------
  // 1. Correct credentials → redirect to dashboard
  // ---------------------------------------------------------------------------
  test("correct credentials redirect to dashboard", async ({ page }) => {
    await goToLogin(page);
    await page.getByLabel("User ID").fill("admin");
    await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /Sign in/i }).click();
    await page.waitForURL(orgUrlPattern(ORG, "/dashboard"), { timeout: 30_000 });
    expect(page.url()).toMatch(orgUrlPattern(ORG, "/dashboard"));

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
    await expect(page).toHaveURL(orgUrlPattern(ORG, "/login"));
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
          await adminPage.goto(orgUrl(ORG, "/admin/users"));
          // If the session were somehow invalid we'd be redirected to login;
          // waitForURL confirms we landed on the users page.
          await adminPage.waitForURL(orgUrlPattern(ORG, "/admin/users"), {
            timeout: 30_000,
          });
        } else {
          // Fallback: fresh sign-in (counts against the rate-limit budget).
          await adminPage.goto(LOGIN_URL);
          await expect(
            adminPage.locator('input[autocomplete="username"]'),
          ).toBeVisible({ timeout: 30_000 });
          await adminPage.getByLabel("User ID").fill("admin");
          await adminPage.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD!);
          await adminPage.getByRole("button", { name: /Sign in/i }).click();
          await adminPage.waitForURL(orgUrlPattern(ORG, "/dashboard"), {
            timeout: 30_000,
          });
          await adminPage.goto(orgUrl(ORG, "/admin/users"));
        }

        // Navigate to admin users list, find the "architect" row, open their detail.
        // Stage 14 Batch D: "Actions" text link replaced by icon-only Edit link (aria-label="Edit").
        const architectRow = adminPage
          .locator("table tbody tr")
          .filter({ has: adminPage.locator("td:first-child", { hasText: "architect" }) });
        await architectRow.getByRole("link", { name: "Edit" }).click();
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
      await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD!);
      await page.getByRole("button", { name: /Sign in/i }).click();

      // Use p[role="alert"] — the app's error element is a <p>, not Next.js's
      // <div id="__next-route-announcer__" role="alert"> which is always in the DOM.
      const alert = page.locator('p[role="alert"]');
      await expect(alert).toBeVisible({ timeout: 15_000 });
      await expect(alert).toContainText("deactivated");

      // Must stay on login page
      await expect(page).toHaveURL(orgUrlPattern(ORG, "/login"));
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
          await adminPage.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD!);
          await adminPage.getByRole("button", { name: /Sign in/i }).click();
          await adminPage.waitForURL(orgUrlPattern(ORG, "/dashboard"), {
            timeout: 30_000,
          });
        }

        // Reactivate the architect user — navigate directly to their detail page.
        await adminPage.goto(orgUrl(ORG, `/admin/users/${architectUserId}`));
        await adminPage.waitForURL(
          orgUrlPattern(ORG, `/admin/users/${architectUserId}`),
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
    await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD!);

    // Rate-limit guard: this is the 4th real sign-in POST in the suite (tests 1,
    // 2, and 5 each send one; tests 3 and 4 are blocked by the client-side empty
    // check before reaching the server).  better-auth's default rate limiter allows at most 3
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
    await page.waitForURL(orgUrlPattern(ORG2, "/dashboard"), { timeout: 30_000 });

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
});
