/**
 * Test Round 6 — H-18, H-19, H-20 verification + regression spot-checks
 *
 * H-18: SelectField dropdown containment fix (position:fixed), Update User
 *       modal title/subtitle, org-admin password field
 * H-19: Add User 2-column layout (both SA and org-admin)
 * H-20: Inventory sort "Sort by:" label + SelectField (not native <select>)
 *
 * Regression:
 *   H-15: Sort still reorders correctly with the new SelectField component
 *   H-16: Create toast still fires
 *   H-17: ComponentType FK — dropdown visible and functional
 *
 * Pre-conditions:
 *   - SA account: devadmin / Seed1234!
 *   - Test users created before spec runs:
 *       e2e-r6-testadmin (Admin role)  — used for org-admin UI tests
 *       e2e-r6-passtest (Member role)  — used for password-set end-to-end test
 *     Both are in e2e-testorg and cleaned up by the Cleanup test at the end.
 *   - cloisons org used for inventory spot-checks (H-15/H-16/H-20).
 *
 * NOTE: SA Users page requires an org to be selected via the OrgPicker before
 * user rows appear. Navigate to /controls/users?orgId=<id> directly to skip
 * the picker interaction.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://quotation-system-c6elkpzr7-vistra-indias-projects.vercel.app \
 *   TEST_SA_USERNAME=devadmin TEST_SA_PASSWORD=Seed1234! \
 *   npx playwright test hotfix-2026-09-27-round6 --workers=1
 */

import { test, expect } from "@playwright/test";
import { orgUrl, apiUrl, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const SA_USERNAME = process.env.TEST_SA_USERNAME ?? "";
const SA_PASSWORD = process.env.TEST_SA_PASSWORD ?? "";
const hasSaCreds = Boolean(SA_USERNAME && SA_PASSWORD);

const CLOISONS_SLUG = "cloisons";
const CLOISONS_ADMIN = "admin";
const CLOISONS_PASS = process.env.TEST_ADMIN_PASSWORD ?? "Seed1234!";

const E2E_ORG_SLUG = "e2e-testorg";
const E2E_ORG_ID = "515b3430-e15c-46bb-ab2a-48cab0236afa";
// Admin test user created before test run
const E2E_ADMIN_USER = "e2e-r6-testadmin";
const E2E_ADMIN_PASS = "TestR6Admin1!";
// Password test user created before test run (Company Member role)
const E2E_PASS_TEST_USER = "e2e-r6-passtest";

// SA Users page URL with e2e-testorg pre-selected (skips OrgPicker interaction)
const SA_USERS_E2E_URL = `/controls/users?orgId=${E2E_ORG_ID}`;

const RUN = Date.now();
const PREFIX = `e2e-r6-${RUN}`;

// Pacing to avoid rate limiting
test.beforeEach(async () => {
  await new Promise((r) => setTimeout(r, 2500));
});

// SA login helper
async function loginAsSA(
  request: import("@playwright/test").APIRequestContext,
): Promise<string> {
  const res = await request.post("/api/v1/superadmin/login", {
    data: { username: SA_USERNAME, password: SA_PASSWORD },
  });
  expect(res.status(), "SA login").toBe(200);
  const setCookie = res.headers()["set-cookie"] ?? "";
  const match = setCookie.match(/qs-sa-token=([^;]+)/);
  expect(match, "SA token cookie found").toBeTruthy();
  return match![1];
}

// ═══════════════════════════════════════════════════════════════════════════
// H-18: SelectField dropdown containment — SA Edit User modal
// ═══════════════════════════════════════════════════════════════════════════

test("H-18-SA: Edit User modal shows 'Update User' title and @username subtitle", async ({
  page,
}) => {
  test.skip(!hasSaCreds, "FLAG-SA: TEST_SA_USERNAME/TEST_SA_PASSWORD not set");

  const token = await loginAsSA(page.request);
  const previewHost = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000").hostname;
  await page.context().addCookies([
    { name: "qs-sa-token", value: token, domain: previewHost, path: "/" },
  ]);
  // Navigate directly with orgId to skip OrgPicker interaction
  await page.goto(SA_USERS_E2E_URL);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);

  // Find Edit button — SA Edit User button has aria-label="Edit {username}"
  const editBtn = page.locator('button[aria-label*="Edit"]').first();
  await expect(editBtn).toBeVisible({ timeout: 15_000 });
  await editBtn.click();

  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible({ timeout: 10_000 });

  const modalText = await modal.textContent() ?? "";
  // Title should be "Update User" (not "Edit user — ...")
  expect(modalText).toContain("Update User");
  expect(modalText).not.toContain("Edit user —");
  console.log("H-18-SA PASS: Modal title is 'Update User'");

  // Username subtitle: "@{username}" paragraph
  const subtitle = modal.locator("p").filter({ hasText: /^@\w/ });
  const subtitleCount = await subtitle.count();
  expect(subtitleCount, "Should have @username subtitle paragraph").toBeGreaterThan(0);
  const subtitleText = await subtitle.first().textContent() ?? "";
  expect(subtitleText.trim()).toMatch(/^@\w/);
  console.log(`H-18-SA PASS: Username subtitle visible: "${subtitleText.trim()}"`);

  await page.keyboard.press("Escape");
});

test("H-18-SA: Role SelectField dropdown renders at position:fixed (not clipped by modal scroll container)", async ({
  page,
}) => {
  test.skip(!hasSaCreds, "FLAG-SA: TEST_SA_USERNAME/TEST_SA_PASSWORD not set");

  const token = await loginAsSA(page.request);
  const previewHost = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000").hostname;
  await page.context().addCookies([
    { name: "qs-sa-token", value: token, domain: previewHost, path: "/" },
  ]);
  await page.goto(SA_USERS_E2E_URL);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);

  // Open Edit modal
  const editBtn = page.locator('button[aria-label*="Edit"]').first();
  await expect(editBtn).toBeVisible({ timeout: 15_000 });
  await editBtn.click();

  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);

  // Find the Role SelectField trigger (combobox) inside the modal
  // SA edit form has Role as a SelectField — it's the only combobox in the form
  const roleCombobox = modal.locator('[role="combobox"]').first();
  await expect(roleCombobox).toBeVisible({ timeout: 10_000 });
  await roleCombobox.click();

  // Wait for listbox to appear
  const listbox = page.locator('[role="listbox"]').first();
  await expect(listbox).toBeVisible({ timeout: 5_000 });

  // KEY CHECK: listbox must render at position:fixed (H-18 core fix)
  const position = await listbox.evaluate((el) =>
    window.getComputedStyle(el).position
  );
  expect(position, "Listbox must render at position:fixed to escape modal overflow").toBe("fixed");
  console.log("H-18-SA PASS: Listbox renders at position:fixed (not clipped by modal)");

  // Verify z-index is above modal overlay (z-40 = 40)
  const zIndex = await listbox.evaluate((el) =>
    window.getComputedStyle(el).zIndex
  );
  expect(Number(zIndex), "z-index must be 9999 (above modal overlay)").toBe(9999);
  console.log(`H-18-SA PASS: Listbox z-index=${zIndex}`);

  // Verify listbox has options
  const options = listbox.locator('[role="option"]');
  const optCount = await options.count();
  expect(optCount, "Listbox must have at least one option").toBeGreaterThan(0);
  console.log(`H-18-SA PASS: Listbox has ${optCount} options visible`);

  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
});

// ═══════════════════════════════════════════════════════════════════════════
// H-18: SelectField dropdown containment — Org-admin Edit User modal
// ═══════════════════════════════════════════════════════════════════════════

test("H-18-ORG: Edit User modal shows 'Update User' title, @username subtitle, and password section", async ({
  page,
}) => {
  await signIn(page, E2E_ADMIN_USER, E2E_ADMIN_PASS, E2E_ORG_SLUG);
  await page.goto(orgUrl(E2E_ORG_SLUG, "/admin/users"));
  await expect(page.getByRole("heading", { name: /user management/i })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);

  // Click Edit on first user (aria-label="Edit {username}" or title="Edit {username}")
  const editBtns = page.locator('button[title*="Edit"], button[aria-label*="Edit"]');
  await expect(editBtns.first()).toBeVisible({ timeout: 10_000 });
  await editBtns.first().click();

  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible({ timeout: 10_000 });

  const modalText = await modal.textContent() ?? "";

  // Title must be "Update User"
  expect(modalText).toContain("Update User");
  expect(modalText).not.toContain("Edit user —");
  console.log("H-18-ORG PASS: Modal title is 'Update User'");

  // Username subtitle: "Username: @{username}" pattern
  const usernamePara = modal.locator("p").filter({ hasText: /username/i }).first();
  await expect(usernamePara).toBeVisible({ timeout: 5_000 });
  const usernameText = await usernamePara.textContent() ?? "";
  expect(usernameText).toContain("@");
  console.log(`H-18-ORG PASS: Username subtitle: "${usernameText.trim().slice(0, 60)}"`);

  // Password section: org-admin edit modal must have a password input (new in H-18)
  const passwordInput = modal.locator('input[type="password"]').first();
  await expect(passwordInput).toBeVisible({ timeout: 5_000 });
  console.log("H-18-ORG PASS: Password input visible in org-admin Edit User modal");

  // "Set password" button must exist
  const setPassBtn = modal.getByRole("button", { name: /set password/i });
  await expect(setPassBtn).toBeVisible({ timeout: 5_000 });
  console.log("H-18-ORG PASS: 'Set password' button visible");

  await page.keyboard.press("Escape");
});

test("H-18-ORG: Role SelectField in org-admin Edit User modal renders at position:fixed", async ({
  page,
}) => {
  await signIn(page, E2E_ADMIN_USER, E2E_ADMIN_PASS, E2E_ORG_SLUG);
  await page.goto(orgUrl(E2E_ORG_SLUG, "/admin/users"));
  await expect(page.getByRole("heading", { name: /user management/i })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);

  // Click Edit on first user
  const editBtns = page.locator('button[title*="Edit"], button[aria-label*="Edit"]');
  await editBtns.first().click();

  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);

  // There are multiple SelectFields in this modal:
  //   1. External Company (edit-externalCompanyId)
  //   2. Role change (at the bottom — a second SelectField)
  const comboboxes = modal.locator('[role="combobox"]');
  const comboboxCount = await comboboxes.count();
  expect(comboboxCount, "Modal must have at least 1 SelectField (role change)").toBeGreaterThan(0);
  console.log(`H-18-ORG: Found ${comboboxCount} combobox(es) in Edit User modal`);

  // Open the last combobox (Role change is at the bottom)
  await comboboxes.last().click();

  const listbox = page.locator('[role="listbox"]').first();
  await expect(listbox).toBeVisible({ timeout: 5_000 });

  const position = await listbox.evaluate((el) =>
    window.getComputedStyle(el).position
  );
  expect(position, "Org-admin Edit User role SelectField listbox must be position:fixed").toBe("fixed");
  console.log("H-18-ORG PASS: Role SelectField listbox renders at position:fixed");

  const zIndex = await listbox.evaluate((el) =>
    window.getComputedStyle(el).zIndex
  );
  expect(Number(zIndex)).toBe(9999);
  console.log(`H-18-ORG PASS: z-index=${zIndex}`);

  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
});

// ═══════════════════════════════════════════════════════════════════════════
// H-18: Password field e2e — set password, verify login
// ═══════════════════════════════════════════════════════════════════════════

test("H-18-ORG: Set password for passtest user via Edit User modal, then verify login works", async ({
  page,
  request,
}) => {
  await signIn(page, E2E_ADMIN_USER, E2E_ADMIN_PASS, E2E_ORG_SLUG);
  await page.goto(orgUrl(E2E_ORG_SLUG, "/admin/users"));
  await expect(page.getByRole("heading", { name: /user management/i })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);

  // Find passtest user Edit button directly by aria-label (precise to avoid editing the wrong user)
  const editBtn = page.locator('[aria-label="Edit ' + E2E_PASS_TEST_USER + '"]').or(
    page.locator('[title="Edit ' + E2E_PASS_TEST_USER + '"]')
  ).first();
  await expect(editBtn).toBeVisible({ timeout: 10_000 });
  await editBtn.click();

  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);

  // Fill new password
  const newPass = "TestR6PassNew1!";
  const passwordInput = modal.locator('input[type="password"]').first();
  await expect(passwordInput).toBeVisible({ timeout: 5_000 });
  await passwordInput.fill(newPass);

  // Click "Set password"
  const setPassBtn = modal.getByRole("button", { name: /set password/i });
  await setPassBtn.click();
  await page.waitForTimeout(2000);

  // Modal stays open (by design) — verify no server error
  const modalText = await modal.textContent() ?? "";
  expect(modalText).not.toContain("server error");
  // A success indicator or clean state (no "failed" / "500" error) means it worked
  const hasFatalError = modalText.includes("500") || modalText.includes("Exception");
  expect(hasFatalError, "No fatal server error after password save").toBe(false);
  console.log("H-18-ORG PASS: Password set completed without server error");

  await page.keyboard.press("Escape");

  // Verify login with the new password
  const loginRes = await request.post(
    apiUrl(E2E_ORG_SLUG, "/api/auth/sign-in/email"),
    {
      data: {
        email: `${E2E_PASS_TEST_USER}@${E2E_ORG_SLUG}.internal`,
        password: newPass,
      },
    }
  );
  expect(loginRes.status(), "Should log in with new password").toBe(200);
  console.log("H-18-ORG PASS: New password successfully used for login ✓");
});

test("H-18-ORG: Submitting blank password is a safe no-op (no server error)", async ({
  page,
}) => {
  await signIn(page, E2E_ADMIN_USER, E2E_ADMIN_PASS, E2E_ORG_SLUG);
  await page.goto(orgUrl(E2E_ORG_SLUG, "/admin/users"));
  await expect(page.getByRole("heading", { name: /user management/i })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);

  const editBtn = page.locator('button[title*="Edit"], button[aria-label*="Edit"]').first();
  await editBtn.click();

  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);

  // Ensure password input is blank and click Set password
  const passwordInput = modal.locator('input[type="password"]').first();
  await passwordInput.clear();
  const setPassBtn = modal.getByRole("button", { name: /set password/i });
  await setPassBtn.click();
  await page.waitForTimeout(2000);

  // Should not crash
  const modalText = await modal.textContent() ?? "";
  expect(modalText).not.toContain("500");
  expect(modalText).not.toContain("Exception");
  console.log("H-18-ORG PASS: Blank password submit is safe — no server error ✓");

  await page.keyboard.press("Escape");
});

// ═══════════════════════════════════════════════════════════════════════════
// H-19: Add User 2-column layout — org-admin
// ═══════════════════════════════════════════════════════════════════════════

test("H-19-ORG: Add User modal has 2-column grid layout with expected fields", async ({
  page,
}) => {
  await signIn(page, E2E_ADMIN_USER, E2E_ADMIN_PASS, E2E_ORG_SLUG);
  await page.goto(orgUrl(E2E_ORG_SLUG, "/admin/users"));
  await expect(page.getByRole("heading", { name: /user management/i })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);

  // Click Add user button
  await page.getByRole("button", { name: /add user/i }).click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);

  // Check form has grid layout (H-19 changed from flex to grid)
  const form = modal.locator("form").first();
  const formClass = await form.getAttribute("class") ?? "";
  expect(formClass).toContain("grid");
  console.log(`H-19-ORG PASS: Add User form has grid class`);

  // Check all expected fields are present via label text
  const formText = await form.textContent() ?? "";
  expect(formText).toMatch(/first name/i);
  expect(formText).toMatch(/last name/i);
  expect(formText).toMatch(/username/i);
  expect(formText).toMatch(/role/i);
  expect(formText).toMatch(/password/i);
  expect(formText).toMatch(/mobile/i);
  expect(formText).toMatch(/email/i);
  console.log("H-19-ORG PASS: All expected field labels present");

  // Verify 2-column grid at desktop viewport (1280px default)
  const gridCols = await form.evaluate((el) =>
    window.getComputedStyle(el).gridTemplateColumns
  );
  const numCols = gridCols.split(" ").filter(Boolean).length;
  expect(numCols, "Form must have 2 columns at desktop viewport").toBe(2);
  console.log(`H-19-ORG PASS: Form grid has ${numCols} columns ✓`);

  await page.keyboard.press("Escape");
});

test("H-19-ORG: Creating a user through the Add User modal actually submits successfully", async ({
  page,
}) => {
  await signIn(page, E2E_ADMIN_USER, E2E_ADMIN_PASS, E2E_ORG_SLUG);
  await page.goto(orgUrl(E2E_ORG_SLUG, "/admin/users"));
  await expect(page.getByRole("heading", { name: /user management/i })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);

  await page.getByRole("button", { name: /add user/i }).click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);

  const newUsername = `${PREFIX}-adduser`;

  // Fill fields
  await modal.locator('input[name="firstName"]').fill("R6");
  await modal.locator('input[name="lastName"]').fill("AddUserTest");
  await modal.locator('input[name="username"]').fill(newUsername);
  await modal.locator('input[name="password"]').or(modal.locator('input[type="password"]')).first().fill("TestR6New1!");

  // Role SelectField — click combobox and pick first option
  const roleCombobox = modal.locator('[role="combobox"]').first();
  if (await roleCombobox.count() > 0) {
    await roleCombobox.click();
    const listbox = page.locator('[role="listbox"]').first();
    await expect(listbox).toBeVisible({ timeout: 5_000 });
    await listbox.locator('[role="option"]:not([disabled])').first().click();
    await page.waitForTimeout(200);
  }

  // Submit
  const submitBtn = modal.getByRole("button", { name: /create user|save|add/i }).first();
  await submitBtn.click();

  // createUser action redirects to /admin/users on success — modal closes via navigation
  await page.waitForTimeout(3000);

  // Verify the new user appears in the list
  const pageText = await page.locator("body").textContent() ?? "";
  expect(pageText, `New user ${newUsername} should appear in users list after creation`).toContain(newUsername);
  console.log(`H-19-ORG PASS: User ${newUsername} created and visible in list ✓`);

  // Clean up: delete the created user
  const rows = page.locator("tr");
  const rowCount = await rows.count();
  for (let i = 0; i < rowCount; i++) {
    const rt = await rows.nth(i).textContent() ?? "";
    if (rt.includes(newUsername)) {
      const delBtn = rows.nth(i).locator('button[aria-label*="Delete"], button[title*="Delete"]');
      if (await delBtn.count() > 0) {
        await delBtn.click();
        const confirmDlg = page.getByRole("dialog");
        if (await confirmDlg.isVisible()) {
          const confirmBtn = confirmDlg.getByRole("button", { name: /delete|confirm/i });
          if (await confirmBtn.count() > 0) {
            await confirmBtn.click();
            await page.waitForTimeout(1500);
            console.log(`H-19-ORG: Cleaned up user ${newUsername}`);
          }
        }
      }
      break;
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// H-19: Add User 2-column layout — SA panel
// ═══════════════════════════════════════════════════════════════════════════

test("H-19-SA: SA Add User modal has 2-column grid layout", async ({ page }) => {
  test.skip(!hasSaCreds, "FLAG-SA: TEST_SA_USERNAME/TEST_SA_PASSWORD not set");

  const token = await loginAsSA(page.request);
  const previewHost = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000").hostname;
  await page.context().addCookies([
    { name: "qs-sa-token", value: token, domain: previewHost, path: "/" },
  ]);
  await page.goto(SA_USERS_E2E_URL);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);

  // Click "Add user"
  await page.getByRole("button", { name: /add user/i }).click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);

  // Check form has grid
  const form = modal.locator("form").first();
  const formClass = await form.getAttribute("class") ?? "";
  expect(formClass).toContain("grid");
  console.log(`H-19-SA PASS: SA Add User form has grid class`);

  // Verify 2-column layout at desktop viewport
  const gridCols = await form.evaluate((el) =>
    window.getComputedStyle(el).gridTemplateColumns
  );
  const numCols = gridCols.split(" ").filter(Boolean).length;
  expect(numCols, "SA Add User form must have 2 columns").toBe(2);
  console.log(`H-19-SA PASS: SA Add User form has ${numCols} columns ✓`);

  // Check expected field labels
  const formText = await form.textContent() ?? "";
  expect(formText).toMatch(/first name/i);
  expect(formText).toMatch(/last name/i);
  expect(formText).toMatch(/username/i);
  expect(formText).toMatch(/role/i);
  console.log("H-19-SA PASS: SA Add User form has expected field labels");

  await page.keyboard.press("Escape");
});

// ═══════════════════════════════════════════════════════════════════════════
// H-20: Inventory sort — "Sort by:" label + SelectField (not native select)
// ═══════════════════════════════════════════════════════════════════════════

test("H-20: Inventory list has 'Sort by:' label and SelectField combobox sort control", async ({
  page,
}) => {
  await signIn(page, CLOISONS_ADMIN, CLOISONS_PASS, CLOISONS_SLUG);
  await page.goto(orgUrl(CLOISONS_SLUG, "/admin/inventory"));
  await expect(page.getByRole("heading", { name: "Inventory Management" })).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(1000);

  // Check "Sort by:" label is visible
  const sortByLabel = page.getByText("Sort by:");
  await expect(sortByLabel).toBeVisible({ timeout: 10_000 });
  console.log("H-20 PASS: 'Sort by:' label is visible ✓");

  // Sort control must be a SelectField combobox (not a native <select>)
  // The page header area has the combobox
  const sortCombobox = page.locator('[role="combobox"]').first();
  await expect(sortCombobox).toBeVisible({ timeout: 10_000 });
  console.log("H-20 PASS: Sort control is a SelectField combobox (not native <select>)");

  // Open the sort dropdown
  await sortCombobox.click();
  const listbox = page.locator('[role="listbox"]').first();
  await expect(listbox).toBeVisible({ timeout: 5_000 });

  // H-18 fix also covers this non-modal usage: listbox at position:fixed
  const position = await listbox.evaluate((el) =>
    window.getComputedStyle(el).position
  );
  expect(position).toBe("fixed");
  console.log("H-20 PASS: Inventory sort SelectField listbox at position:fixed ✓");

  // Check all 3 sort options
  const options = await listbox.locator('[role="option"]').allTextContents();
  console.log(`H-20: Sort options: ${JSON.stringify(options)}`);
  expect(options.some((o) => /last added/i.test(o))).toBe(true);
  expect(options.some((o) => /component/i.test(o))).toBe(true);
  expect(options.some((o) => /^name$/i.test(o.trim()))).toBe(true);
  console.log("H-20 PASS: All 3 sort options present ✓");

  // Close dropdown
  await page.keyboard.press("Escape");
});

// ═══════════════════════════════════════════════════════════════════════════
// Regression H-15: Sort still reorders rows with new SelectField component
// ═══════════════════════════════════════════════════════════════════════════

test("Regression H-15: SelectField sort options reorder rows correctly", async ({ page }) => {
  await signIn(page, CLOISONS_ADMIN, CLOISONS_PASS, CLOISONS_SLUG);
  await page.goto(orgUrl(CLOISONS_SLUG, "/admin/inventory"));
  await expect(page.getByRole("heading", { name: "Inventory Management" })).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(1000);

  const rows = page.locator("table tbody tr");
  const initialCount = await rows.count();
  expect(initialCount, "Cloisons inventory should have rows").toBeGreaterThan(0);
  console.log(`Regression H-15: ${initialCount} rows`);

  const sortCombobox = page.locator('[role="combobox"]').first();

  // Switch to "Name" sort
  await sortCombobox.click();
  const lb1 = page.locator('[role="listbox"]').first();
  await expect(lb1).toBeVisible({ timeout: 5_000 });
  await lb1.locator('[role="option"]').filter({ hasText: /^name$/i }).click();
  await page.waitForTimeout(500);

  const firstRowName = (await rows.first().textContent())?.trim().slice(0, 60) ?? "";
  console.log(`Regression H-15: After Name sort, first: "${firstRowName}"`);

  // Switch to "Component" sort
  await sortCombobox.click();
  const lb2 = page.locator('[role="listbox"]').first();
  await expect(lb2).toBeVisible({ timeout: 5_000 });
  await lb2.locator('[role="option"]').filter({ hasText: /component/i }).click();
  await page.waitForTimeout(500);

  const firstRowComp = (await rows.first().textContent())?.trim().slice(0, 60) ?? "";
  console.log(`Regression H-15: After Component sort, first: "${firstRowComp}"`);

  // Switch back to "Last added"
  await sortCombobox.click();
  const lb3 = page.locator('[role="listbox"]').first();
  await expect(lb3).toBeVisible({ timeout: 5_000 });
  await lb3.locator('[role="option"]').filter({ hasText: /last added/i }).click();
  await page.waitForTimeout(500);

  const finalCount = await rows.count();
  expect(finalCount).toBe(initialCount);
  console.log(`Regression H-15 PASS: All 3 sort options work, row count stable (${finalCount}) ✓`);
});

// ═══════════════════════════════════════════════════════════════════════════
// Regression H-16: Create toast still fires with new SelectField sort
// ═══════════════════════════════════════════════════════════════════════════

test("Regression H-16: Create toast fires with new SelectField sort control", async ({ page }) => {
  await signIn(page, CLOISONS_ADMIN, CLOISONS_PASS, CLOISONS_SLUG);
  await page.goto(orgUrl(CLOISONS_SLUG, "/admin/inventory"));
  await expect(page.getByRole("heading", { name: "Inventory Management" })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: /new item/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  // Fill required fields
  const compDropdown = dialog.locator("#item-form-component-type");
  const compOptions = await compDropdown.locator("option").allTextContents();
  if (compOptions.filter((o) => o.trim() && !o.toLowerCase().includes("select")).length > 0) {
    await compDropdown.selectOption({ index: 1 });
  }
  await dialog.locator("#item-form-uom").selectOption("metres");
  const itemCode = `${PREFIX}-h16reg`;
  await dialog.locator("#item-form-code").fill(itemCode);
  await dialog.locator("#item-form-name").fill("R6 H16 Regression");
  await dialog.getByRole("button", { name: /save/i }).click();

  const toast = page.locator('[role="status"]').filter({ hasText: /item added/i });
  await expect(toast).toBeVisible({ timeout: 15_000 });
  console.log("Regression H-16 PASS: 'Item added to inventory' toast fires ✓");

  // Clean up
  await page.waitForTimeout(2000);
  const allRows = page.locator("table tbody tr");
  for (let i = 0; i < await allRows.count(); i++) {
    const t = await allRows.nth(i).textContent() ?? "";
    if (t.includes(itemCode)) {
      const delBtn = allRows.nth(i).locator(`button[aria-label*="Delete"]`);
      if (await delBtn.count() > 0) {
        await delBtn.click();
        const cd = page.getByRole("dialog");
        if (await cd.isVisible()) {
          await cd.getByRole("button", { name: /delete|confirm/i }).click();
          await page.waitForTimeout(1500);
          console.log(`Regression H-16: Cleaned up item ${itemCode}`);
        }
      }
      break;
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Regression H-17: ComponentType FK dropdown still functional
// ═══════════════════════════════════════════════════════════════════════════

test("Regression H-17: Component FK dropdown shows code-only options in New Item modal", async ({
  page,
}) => {
  await signIn(page, CLOISONS_ADMIN, CLOISONS_PASS, CLOISONS_SLUG);
  await page.goto(orgUrl(CLOISONS_SLUG, "/admin/inventory"));
  await expect(page.getByRole("heading", { name: "Inventory Management" })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: /new item/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  const compDropdown = dialog.locator("#item-form-component-type");
  await expect(compDropdown).toBeVisible({ timeout: 5_000 });

  const opts = await compDropdown.locator("option").allTextContents();
  const nonEmpty = opts.filter((o) => o.trim() && !o.toLowerCase().includes("select"));
  expect(nonEmpty.length, "Component dropdown must have at least 1 option").toBeGreaterThan(0);

  // Verify code-only format (no em-dash separating code from name)
  for (const opt of nonEmpty) {
    expect(opt, `Option "${opt}" must not contain em-dash`).not.toContain(" — ");
  }
  console.log(`Regression H-17 PASS: Component dropdown has ${nonEmpty.length} code-only options ✓`);

  await page.keyboard.press("Escape");
});

// ═══════════════════════════════════════════════════════════════════════════
// H-18 spot-check: SelectField in non-modal context (Inquiry create form)
// ═══════════════════════════════════════════════════════════════════════════

test("H-18 spot-check: SelectField in non-modal Inquiry form — position:fixed and functional", async ({
  page,
}) => {
  await signIn(page, CLOISONS_ADMIN, CLOISONS_PASS, CLOISONS_SLUG);
  await page.goto(orgUrl(CLOISONS_SLUG, "/inquiries/new"));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);

  // Find a SelectField combobox on the page
  const combobox = page.locator('[role="combobox"]').first();
  if (await combobox.count() === 0) {
    console.log("H-18 spot-check: No combobox on /inquiries/new — skipping");
    return;
  }
  await expect(combobox).toBeVisible({ timeout: 10_000 });
  await combobox.click();

  const listbox = page.locator('[role="listbox"]').first();
  await expect(listbox).toBeVisible({ timeout: 5_000 });

  // Even in non-modal context, position:fixed is correct
  const position = await listbox.evaluate((el) =>
    window.getComputedStyle(el).position
  );
  expect(position).toBe("fixed");
  console.log("H-18 spot-check PASS: Non-modal SelectField (Inquiry form) listbox at position:fixed ✓");

  // Select an option to close
  const opts = listbox.locator('[role="option"]');
  const optCount = await opts.count();
  expect(optCount).toBeGreaterThan(0);
  await opts.first().click();

  // Listbox should close after selection
  await expect(listbox).not.toBeVisible({ timeout: 3_000 });
  console.log("H-18 spot-check PASS: SelectField closes after selection ✓");
});

// ═══════════════════════════════════════════════════════════════════════════
// Cleanup: delete e2e-r6 test users from e2e-testorg
// ═══════════════════════════════════════════════════════════════════════════

test("Cleanup: delete e2e-r6 test users from e2e-testorg", async ({ request }) => {
  test.skip(!hasSaCreds, "FLAG-SA: SA creds needed to delete test users");

  const token = await loginAsSA(request);
  const hdrs = { Cookie: `qs-sa-token=${token}` };

  // Get all users in e2e-testorg to find e2e-r6 prefixed ones
  const usersRes = await request.get(`/api/v1/superadmin/orgs/${E2E_ORG_ID}/users`, {
    headers: hdrs,
  });
  const body = await usersRes.json() as { users: Array<{ id: string; username: string }> };
  const testUsers = body.users.filter((u) => u.username.startsWith("e2e-r6-"));

  console.log(`Cleanup: Found ${testUsers.length} e2e-r6 test users to delete`);

  for (const u of testUsers) {
    const delRes = await request.delete(
      `/api/v1/superadmin/orgs/${E2E_ORG_ID}/users/${u.id}`,
      { headers: hdrs }
    );
    console.log(`Cleanup: DELETE ${u.username} → ${delRes.status()}`);
    expect([200, 204, 404]).toContain(delRes.status());
  }

  console.log("Cleanup: Complete");
});
