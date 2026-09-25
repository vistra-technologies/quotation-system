/**
 * SuperAdmin Formula Sets UI spec (Stage 25 Batch 4).
 *
 * Verification strategy — Tier 2 (browser navigation via Playwright page fixture):
 *
 * Navigates to /controls/formula-sets and /controls/formula-sets/[setId] as a
 * SuperAdmin, exercising the list page, create form, and detail page states
 * (locked / unlocked). Uses the SA session cookie established via the login API.
 *
 * /controls resolves correctly on every host PLAYWRIGHT_BASE_URL is set to
 * (ad-hoc per-branch Vercel preview, test.easeetool.com, easeetool.com, or
 * localhost) — same rationale as superadmin-component-types.spec.ts.
 *
 * FLAG-SA (SA creds not set): All tests skip when TEST_SA_USERNAME /
 * TEST_SA_PASSWORD are absent.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://quotation-system-<hash>-vistra-indias-projects.vercel.app \
 *   TEST_SA_USERNAME=... TEST_SA_PASSWORD=... \
 *   npx playwright test superadmin-formula-sets-ui
 */

import { test, expect, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

// ── Environment probes ───────────────────────────────────────────────────────

const CONTROLS_BASE_URL = (() => {
  try {
    return new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000").origin;
  } catch {
    return "http://localhost:3000";
  }
})();

const SA_USERNAME = process.env.TEST_SA_USERNAME ?? "";
const SA_PASSWORD = process.env.TEST_SA_PASSWORD ?? "";
const hasBootstrapCreds = Boolean(SA_USERNAME && SA_PASSWORD);

const FORMULA_SETS_URL = `${CONTROLS_BASE_URL}/controls/formula-sets`;

/** Minimal valid FormulaSetBody — passes validateFormulaSetBody(). */
const VALID_BODY_JSON = JSON.stringify({ slots: { GLASS: { role: "glass" } } }, null, 2);

/** Invalid body — slots must be an object, not a string. */
const INVALID_BODY_JSON = JSON.stringify({ slots: "not-an-object" });

// ── Shared state ─────────────────────────────────────────────────────────────

/** Created in UI-C1; used by UI-C2 and UI-L1. */
let createdSetId = "";

/** A name unique to this test run. */
const TEST_SET_NAME = `ui-fs-${Date.now()}`;

// ── Helper: log in and return a page with SA session cookie set ──────────────

async function loginAsSuperAdminPage(page: Page): Promise<void> {
  // Log in via the API to get the cookie, then set it on the page context.
  const res = await page.request.post(`${CONTROLS_BASE_URL}/api/v1/superadmin/login`, {
    data: { username: SA_USERNAME, password: SA_PASSWORD },
  });
  if (res.status() !== 200) {
    throw new Error(`SuperAdmin login failed: HTTP ${res.status()}`);
  }
  const setCookie = res.headers()["set-cookie"] ?? "";
  const match = setCookie.match(/qs-sa-token=([^;]+)/);
  if (!match) throw new Error("qs-sa-token cookie not found in login response");
  const token = match[1];

  // Inject the cookie so subsequent page navigations include it.
  await page.context().addCookies([
    {
      name: "qs-sa-token",
      value: token,
      url: CONTROLS_BASE_URL,
    },
  ]);
}

// ─── UI-L1: List page renders table rows ─────────────────────────────────────

test("UI-L1: /controls/formula-sets renders table with at least one row", async ({ page }) => {
  if (!hasBootstrapCreds) {
    test.skip();
    return;
  }
  await loginAsSuperAdminPage(page);
  await page.goto(FORMULA_SETS_URL);

  // Page heading
  await expect(page.getByRole("heading", { name: "Formula Sets" })).toBeVisible();

  // Table should be present with at least one tbody row.
  const tbody = page.locator("table tbody");
  await expect(tbody).toBeVisible();
  const rows = tbody.locator("tr");
  await expect(rows.first()).toBeVisible();
});

// ─── UI-C1: Create with new name → v1, appears in list ───────────────────────

test("UI-C1: Create new formula set with new name → version 1, appears in list", async ({
  page,
}) => {
  if (!hasBootstrapCreds) {
    test.skip();
    return;
  }
  await loginAsSuperAdminPage(page);
  await page.goto(FORMULA_SETS_URL);

  // Fill in the create form.
  await page.locator("#create-name").fill(TEST_SET_NAME);
  await page.locator("#create-body").fill(VALID_BODY_JSON);
  await page.locator('#create-form button[type="submit"]').click();

  // After create, the action redirects to the detail page of the new set.
  await page.waitForURL(/\/controls\/formula-sets\/[a-z0-9-]+/);
  const url = page.url();
  const match = url.match(/\/controls\/formula-sets\/([a-z0-9-]+)/);
  expect(match).toBeTruthy();
  createdSetId = match![1];

  // Detail page should show the correct name and version.
  await expect(page.getByRole("heading", { name: TEST_SET_NAME, exact: false })).toBeVisible();
  // Version badge should show "v1".
  await expect(page.locator("text=v1")).toBeVisible();
});

// ─── UI-C2: Create with existing name → auto-increments version ──────────────

test("UI-C2: Create with existing name → auto-increments to v2", async ({ page }) => {
  if (!hasBootstrapCreds) {
    test.skip();
    return;
  }
  await loginAsSuperAdminPage(page);
  await page.goto(FORMULA_SETS_URL);

  // Create with the same name again → should get v2.
  await page.locator("#create-name").fill(TEST_SET_NAME);
  await page.locator("#create-body").fill(VALID_BODY_JSON);
  await page.locator('#create-form button[type="submit"]').click();

  await page.waitForURL(/\/controls\/formula-sets\/[a-z0-9-]+/);

  // Version badge should show "v2".
  await expect(page.locator("text=v2")).toBeVisible();
});

// ─── UI-D1: Locked set shows read-only fields + "Create new version", no Save ─

test("UI-D1: Locked set detail shows read-only fields and 'Create new version' button, no Save", async ({
  page,
}) => {
  if (!hasBootstrapCreds) {
    test.skip();
    return;
  }
  await loginAsSuperAdminPage(page);

  // Find the cloisons org's active formula set via the list API.
  const listRes = await page.request.get(`${CONTROLS_BASE_URL}/api/v1/superadmin/formula-sets`, {
    headers: {
      // Re-use the already-set cookie.
    },
  });
  if (listRes.status() !== 200) {
    test.skip();
    return;
  }
  const { formulaSets } = (await listRes.json()) as {
    formulaSets: { id: string; locked: boolean; name: string }[];
  };
  const lockedSet = formulaSets.find((fs) => fs.locked);
  if (!lockedSet) {
    console.warn("UI-D1: No locked formula set found — skipping");
    test.skip();
    return;
  }

  await page.goto(`${CONTROLS_BASE_URL}/controls/formula-sets/${lockedSet.id}`);

  // Locked banner should be visible.
  await expect(page.locator("text=This formula set is locked")).toBeVisible();

  // "Create new version" button should be present.
  await expect(page.getByRole("link", { name: /Create new version/i }).first()).toBeVisible();

  // "Save Changes" button must NOT be present (locked sets are read-only).
  await expect(page.locator("button", { hasText: /Save Changes/i })).toHaveCount(0);

  // The body should be rendered as a <pre>, not a textarea.
  await expect(page.locator("pre")).toBeVisible();
  await expect(page.locator("textarea[name='bodyJson']")).toHaveCount(0);
});

// ─── UI-E1: Validation error shows inline and disables Save ──────────────────

test("UI-E1: Submit invalid body → inline validation errors shown, Save disabled", async ({
  page,
}) => {
  if (!hasBootstrapCreds) {
    test.skip();
    return;
  }
  if (!createdSetId) {
    // UI-C1 must have run to create the set.
    test.skip();
    return;
  }
  await loginAsSuperAdminPage(page);
  await page.goto(`${CONTROLS_BASE_URL}/controls/formula-sets/${createdSetId}`);

  // The detail page for an unlocked set should have an editable form.
  const bodyTextarea = page.locator("textarea[name='bodyJson']");
  await expect(bodyTextarea).toBeVisible();

  // Replace body with invalid JSON.
  await bodyTextarea.fill(INVALID_BODY_JSON);

  // Click Save.
  const saveButton = page.locator("button", { hasText: "Save Changes" });
  await saveButton.click();

  // Wait for the action to complete (page will NOT redirect on error).
  await page.waitForLoadState("networkidle");

  // Validation error panel should be visible.
  await expect(page.locator("text=Validation failed")).toBeVisible();

  // Save button should now be disabled.
  await expect(saveButton).toBeDisabled();
});
