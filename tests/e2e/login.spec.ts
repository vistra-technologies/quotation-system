/**
 * Login page spec, MOCKED / ANONYMOUS half — Task 1.5 (UI-inclusive exception, Stage 10), extended in
 * Stage 28 B1 for the restyled page (animated scene, inline field errors, footer, submitting state).
 * DOM/layout assertions are allowed everywhere now (CLAUDE.md rule 5, lifted 2026-09-15).
 *
 * Needs NO credentials: every sign-in call is mocked (page.route) or never sent, so this file spends
 * none of the real sign-in rate-limit budget and is safe to run against the Test Org
 * (LOGIN_E2E_ORG=e2e-testorg). The real-credential tests (correct/wrong password, inactive account,
 * cross-org notice) were split out to login-real.spec.ts (Stage 28 test-infra cleanup) so that one
 * real-login failure can no longer mask these.
 *
 * Run against the deployed preview:
 *   PLAYWRIGHT_BASE_URL=https://<branch-url>.vercel.app npx playwright test login.spec
 */

import { test, expect } from "@playwright/test";
import { orgUrl, orgUrlPattern } from "./helpers";

// Org under test. LOGIN_E2E_ORG lets a run point at the Test Org (e.g. LOGIN_E2E_ORG=e2e-testorg).
const ORG = process.env.LOGIN_E2E_ORG ?? "acme-glass";
// orgUrl() returns the routing-mode-correct login URL (path or subdomain mode).
const LOGIN_URL = orgUrl(ORG, "/login");
// Dummy value: the mocked tests below never reach a real sign-in.
const ADMIN_PASSWORD = "not-a-real-password-123";

// ---------------------------------------------------------------------------
// Shared helper — navigate to login page and wait for the form to be ready
// ---------------------------------------------------------------------------
async function goToLogin(page: import("@playwright/test").Page, orgSlug = ORG) {
  await page.goto(orgUrl(orgSlug, "/login"));
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({
    timeout: 30_000,
  });
}

// ---------------------------------------------------------------------------
// 3. Empty username → form blocks submission
// ---------------------------------------------------------------------------
test("empty username blocks form submission", async ({ page }) => {
  // Stage 28 B1: the form is noValidate; a client-side check shows an inline
  // field error and returns before any network call.
  let signInCalls = 0;
  await page.route("**/api/auth/sign-in/email", (route) => {
    signInCalls++;
    return route.abort();
  });
  await goToLogin(page);
  // Fill password but leave username empty
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Sign in/i }).click();

  await expect(page).toHaveURL(orgUrlPattern(ORG, "/login"));
  await expect(page.getByText("Enter your user ID.")).toBeVisible();
  await expect(page.getByLabel("User ID")).toBeFocused();
  // The inline field error is not a server error alert. Scope to <p role="alert">
  // to exclude Next.js's always-present <div id="__next-route-announcer__" role="alert">.
  await expect(page.locator('p[role="alert"]')).not.toBeVisible();
  expect(signInCalls).toBe(0);

  // The error clears as soon as the user types.
  await page.getByLabel("User ID").fill("a");
  await expect(page.getByText("Enter your user ID.")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 4. Empty password → form blocks submission
// ---------------------------------------------------------------------------
test("empty password blocks form submission", async ({ page }) => {
  let signInCalls = 0;
  await page.route("**/api/auth/sign-in/email", (route) => {
    signInCalls++;
    return route.abort();
  });
  await goToLogin(page);
  // Fill username but leave password empty
  await page.getByLabel("User ID").fill("admin");
  await page.getByRole("button", { name: /Sign in/i }).click();

  await expect(page).toHaveURL(orgUrlPattern(ORG, "/login"));
  await expect(page.getByText("Enter your password.")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
  await expect(page.locator('p[role="alert"]')).not.toBeVisible();
  expect(signInCalls).toBe(0);

  await page.getByLabel("Password", { exact: true }).fill("x");
  await expect(page.getByText("Enter your password.")).toHaveCount(0);
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
    // The backdrop is the outermost fixed div (data-testid, since CSS-module
    // class names are hashed); clicking inside the card is stopped by
    // stopPropagation, so we target {x:5, y:5} (top-left corner).
    await page.locator('[data-testid="modal-scrim"]').click({ position: { x: 5, y: 5 } });

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
// 9b. Rate-limited (429): fixed message, Sign in disabled with a countdown that
//     re-enables it and clears the error. Hotfix 2026-10-02.
//     The sign-in POST is mocked, so this spends none of the real 3-per-10s
//     rate-limit budget (and doesn't need to wait on it).
// ---------------------------------------------------------------------------
test("429 shows fixed message, disables Sign in with countdown, then re-enables", async ({
  page,
}) => {
  await page.route("**/api/auth/sign-in/email", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: { "x-retry-after": "10" },
      body: JSON.stringify({ message: "Too many requests. Please try again later." }),
    }),
  );

  await goToLogin(page);
  await page.getByLabel("User ID").fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("whatever-123");
  await page.getByRole("button", { name: /Sign in/i }).click();

  const alert = page.locator('p[role="alert"]');
  await expect(alert).toHaveText("Too many requests. Please try again after 10 secs.");

  // Disabled, with a live "Try again in Ns" label (N ≤ 10); fields stay filled.
  const button = page.getByRole("button", { name: /Try again in \d+s/ });
  await expect(button).toBeDisabled();
  await expect(page.getByLabel("User ID")).toHaveValue("admin");

  // After the countdown the button is back to "Sign in" and the error is gone.
  await expect(page.getByRole("button", { name: /^Sign in/ })).toBeEnabled({
    timeout: 15_000,
  });
  await expect(alert).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// 9c. Another session is active → confirmation dialog (hotfix 2026-10-02,
//     single-session-confirm). The feature is behind the build-time flag
//     NEXT_PUBLIC_SINGLE_SESSION_CONFIRM, which is OFF on Preview/staging by
//     default (so the rest of this suite isn't blocked by the dialog). Run these
//     only against a build with the flag on:
//       SINGLE_SESSION_CONFIRM_ENABLED=true PLAYWRIGHT_BASE_URL=... npx playwright test login
//     All auth calls are mocked — no real sessions are created or revoked.
// ---------------------------------------------------------------------------
test.describe("another session is active", () => {
  test.skip(
    process.env.SINGLE_SESSION_CONFIRM_ENABLED !== "true",
    "needs a build with NEXT_PUBLIC_SINGLE_SESSION_CONFIRM=true",
  );

  const json = (body: unknown) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

  async function mockSecondLogin(page: import("@playwright/test").Page) {
    const calls: string[] = [];
    const record = (name: string) => calls.push(name);
    await page.route("**/api/auth/sign-in/email", (r) => {
      record("sign-in");
      return r.fulfill(json({ token: "t", user: { id: "u1" } }));
    });
    await page.route("**/api/auth/get-session", (r) =>
      r.fulfill(json({ session: { id: "s-new" }, user: { id: "u1" } })),
    );
    await page.route("**/api/auth/list-sessions", (r) =>
      r.fulfill(
        json([
          {
            id: "s-new",
            userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Safari/537.36",
            updatedAt: new Date().toISOString(),
          },
          {
            id: "s-old",
            userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Safari/537.36",
            updatedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
          },
        ]),
      ),
    );
    await page.route("**/api/auth/revoke-other-sessions", (r) => {
      record("revoke-other-sessions");
      return r.fulfill(json({ status: true }));
    });
    await page.route("**/api/auth/sign-out", (r) => {
      record("sign-out");
      return r.fulfill(json({ success: true }));
    });
    return calls;
  }

  async function signIn(page: import("@playwright/test").Page) {
    await goToLogin(page);
    await page.getByLabel("User ID").fill("admin");
    await page.getByLabel("Password", { exact: true }).fill("whatever-123");
    await page.getByRole("button", { name: /Sign in/i }).click();
  }

  test("dialog shows the other session; Cancel signs the new one out and stays on login", async ({
    page,
  }) => {
    const calls = await mockSecondLogin(page);
    await signIn(page);

    const dialog = page.getByRole("dialog", { name: "Log out the other session?" });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText("Chrome · Windows");
    await expect(dialog).toContainText("12 minutes ago");

    await dialog.getByRole("button", { name: "Cancel" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(orgUrlPattern(ORG, "/login"));
    expect(calls).toContain("sign-out");
    expect(calls).not.toContain("revoke-other-sessions"); // nobody was logged out
  });

  test("Log out other session revokes the others and continues to the dashboard", async ({
    page,
  }) => {
    const calls = await mockSecondLogin(page);
    await signIn(page);

    const dialog = page.getByRole("dialog", { name: "Log out the other session?" });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    // Nothing is revoked until the user confirms.
    expect(calls).not.toContain("revoke-other-sessions");

    await dialog.getByRole("button", { name: "Log out other session" }).click();

    await expect.poll(() => calls).toContain("revoke-other-sessions");
    await page.waitForURL(orgUrlPattern(ORG, "/dashboard"), { timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// 10. Mobile viewport (390px): no horizontal overflow, and the sign-in form is
//     reachable without scrolling (Stage 28 mobile amendment: shortened scene)
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

    // The submit button sits within the first viewport height (no scrolling needed).
    const box = await mobilePage
      .getByRole("button", { name: /Sign in/i })
      .boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  } finally {
    await ctx.close();
  }
});

// ---------------------------------------------------------------------------
// 11. Stage 28 B1 — restyled page structure. All sign-in traffic is mocked, so
//     none of these spend the real sign-in rate-limit budget.
// ---------------------------------------------------------------------------
test.describe("restyled login page (Stage 28 B1)", () => {
  test("scene, flow tabs, footer and subtitle render", async ({ page }) => {
    await goToLogin(page);

    // Animated scene: five panes, a three-tab workflow rail, scene headline.
    const scene = page.getByRole("region", {
      name: /glass partition estimation/i,
    });
    await expect(scene).toBeVisible();
    await expect(scene.getByRole("heading", { level: 1 })).toContainText(
      "glass partition",
    );
    const tabs = page.getByRole("tablist", { name: "Workflow" }).getByRole("tab");
    await expect(tabs).toHaveCount(3);
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await tabs.nth(2).click();
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");

    // Subtitle (real text — the regression page table asserts it) + footer.
    await expect(page.getByText("Sign in to continue to your account")).toBeVisible();
    await expect(page.getByText("© 2026 EaseeTool")).toBeVisible();
    await expect(page.getByRole("link", { name: /privacy|terms/i })).toHaveCount(0);
  });

  test("footer Support opens the same contact popup", async ({ page }) => {
    await goToLogin(page);
    await page.getByRole("button", { name: "Support", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Contact support" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("link", { name: "+91 8149007006" }),
    ).toHaveAttribute("href", "tel:+918149007006");
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("prefers-reduced-motion: the workflow autoplay does not advance", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await goToLogin(page);
    const tabs = page.getByRole("tablist", { name: "Workflow" }).getByRole("tab");
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    // Autoplay steps every 3.6 s; give it comfortably longer than one step.
    await page.waitForTimeout(5_000);
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    // Tabs stay clickable under reduced motion.
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  });

  test("default motion: the workflow autoplay advances on its own", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await goToLogin(page);
    const tabs = page.getByRole("tablist", { name: "Workflow" }).getByRole("tab");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true", {
      timeout: 8_000,
    });
  });

  test("submitting shows 'Signing in…' then the result, with no success screen", async ({
    page,
  }) => {
    // Delay the (mocked) sign-in so the in-flight state is observable.
    await page.route("**/api/auth/sign-in/email", async (route) => {
      await new Promise((r) => setTimeout(r, 1_500));
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ message: "Invalid username or password" }),
      });
    });
    await goToLogin(page);
    await page.getByLabel("User ID").fill("admin");
    await page.getByLabel("Password", { exact: true }).fill("whatever-123");
    await page.getByRole("button", { name: /Sign in/i }).click();

    const busy = page.getByRole("button", { name: /Signing in/ });
    await expect(busy).toBeVisible();
    await expect(busy).toBeDisabled();

    // Then the server error shows; there is never a "You're in" success screen.
    await expect(page.locator('p[role="alert"]')).toHaveText(
      "Invalid username or password",
    );
    await expect(page.getByText(/You're in/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Sign in/ })).toBeEnabled();
  });

  test("privacy glass chip shows while the masked password field is focused", async ({
    page,
  }) => {
    await goToLogin(page);
    // The chip is aria-hidden decoration; its opacity (on the chip element, the
    // text's parent) is what the "show" state toggles.
    const chip = page.getByText("Privacy glass engaged").locator("xpath=..");
    await expect(chip).toHaveCSS("opacity", "0");
    await page.locator("#password").focus();
    await expect(chip).toHaveCSS("opacity", "1");
    // Revealing the password clears the glass.
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(chip).toHaveCSS("opacity", "0");
  });
});

