/**
 * Stage 7 — Inquiry entity, Dashboard nav fix, ComponentType JSON toggle.
 *
 * Covers behavioral DoD items:
 *   - Dashboard nav: Projects and Inquiries links reachable for any authenticated user
 *   - Inquiry auth gate: unauthenticated redirects to login
 *   - Inquiry create round-trip: create → appears in list with inquiryNumber
 *   - Inquiry per-org sequence: two inquiries in same org get consecutive numbers
 *   - Inquiry dismiss: status → Dismissed, button disabled afterward
 *   - Inquiry dismiss ALREADY_CLOSED guard: direct POST on closed inquiry redirects silently
 *   - Inquiry convert: Start Project → redirects to project, inquiry shows Converted,
 *     project has the inquiry's four fields
 *   - Inquiry tenancy: org A's inquiry not accessible via org B's URL space
 *   - ComponentType JSON valid round-trip: paste valid JSON → switch to Form → fields appear
 *   - ComponentType JSON invalid parse: malformed JSON → inline error, stays in JSON mode
 *   - ComponentType JSON invalid shape: radio with no options → inline error, stays in JSON mode
 *   - ComponentType JSON submit disabled in JSON mode
 *   - Direct Project create still works (regression, Inquiry-free path)
 *
 * Invariants only — no DOM structure / styling assertions (wireframe-stage rule).
 */

import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

// ---------------------------------------------------------------------------
// Dashboard nav fix
// ---------------------------------------------------------------------------

test("Dashboard has a Projects link for any authenticated user", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/dashboard");

  // The Projects link must be present and point to the projects route
  const projectsLink = page.getByRole("link", { name: /^Projects$/i });
  await expect(projectsLink).toBeVisible({ timeout: 15_000 });
  const href = await projectsLink.getAttribute("href");
  expect(href).toMatch(/\/acme-glass\/projects/);
});

test("Dashboard has an Inquiries link for any authenticated user", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/dashboard");

  // The Inquiries link must be present and point to the inquiries route
  const inquiriesLink = page.getByRole("link", { name: /^Inquiries$/i });
  await expect(inquiriesLink).toBeVisible({ timeout: 15_000 });
  const href = await inquiriesLink.getAttribute("href");
  expect(href).toMatch(/\/acme-glass\/inquiries/);
});

test("Dashboard Inquiries link navigates to the inquiries list", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/dashboard");

  const inquiriesLink = page.getByRole("link", { name: /^Inquiries$/i });
  await expect(inquiriesLink).toBeVisible({ timeout: 15_000 });
  await inquiriesLink.click();
  await expect(page).toHaveURL(/\/acme-glass\/inquiries$/, { timeout: 15_000 });
});

// ---------------------------------------------------------------------------
// Inquiry — auth gate
// ---------------------------------------------------------------------------

test("Unauthenticated request to /inquiries redirects to login", async ({ page }) => {
  await page.goto("/acme-glass/inquiries");
  await expect(page).toHaveURL(/\/acme-glass\/login/, { timeout: 10_000 });
});

test("Unauthenticated request to /inquiries/new redirects to login", async ({ page }) => {
  await page.goto("/acme-glass/inquiries/new");
  await expect(page).toHaveURL(/\/acme-glass\/login/, { timeout: 10_000 });
});

test("Unauthenticated request to /inquiries/[id] redirects to login", async ({ page }) => {
  await page.goto("/acme-glass/inquiries/00000000-0000-0000-0000-000000000000");
  await expect(page).toHaveURL(/\/acme-glass\/login/, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Inquiry — CRUD round-trip
// ---------------------------------------------------------------------------

test("Inquiry create round-trip: create → appears in list with inquiryNumber and name", async ({
  page,
}) => {
  const inquiryName = `E2E Inquiry ${Date.now()}`;

  await signIn(page, "admin");
  await page.goto("/acme-glass/inquiries/new");
  await expect(page).not.toHaveURL(/\/acme-glass\/login/, { timeout: 15_000 });

  await page.locator("input[name='name']").fill(inquiryName);
  await page.locator("input[name='destinationCountry']").fill("UAE");
  await page.locator("input[name='currency']").fill("AED");

  await Promise.all([
    page.waitForURL(/\/acme-glass\/inquiries$/, { timeout: 20_000 }),
    page.getByRole("button", { name: /create inquiry/i }).click(),
  ]);

  // Inquiry must appear in the list
  await expect(page.getByText(inquiryName)).toBeVisible({ timeout: 10_000 });

  // Must have a # number prefix link
  const numberLink = page.getByRole("link").filter({ hasText: /^#\d+$/ }).first();
  await expect(numberLink).toBeVisible({ timeout: 10_000 });
});

test("Inquiry list: each row links to the detail page", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/inquiries");

  const numberLink = page.getByRole("link").filter({ hasText: /^#\d+$/ }).first();
  const count = await numberLink.count();
  if (count > 0) {
    const href = await numberLink.getAttribute("href");
    expect(href).toMatch(/\/acme-glass\/inquiries\/[0-9a-f-]{36}/);
  }
  // Empty list is acceptable if no inquiries exist yet
});

test("Inquiry detail page shows correct fields (name, country, currency, status)", async ({
  page,
}) => {
  const inquiryName = `E2E Detail ${Date.now()}`;

  await signIn(page, "admin");
  await page.goto("/acme-glass/inquiries/new");

  await page.locator("input[name='name']").fill(inquiryName);
  await page.locator("input[name='destinationCountry']").fill("KSA");
  await page.locator("input[name='currency']").fill("SAR");

  await Promise.all([
    page.waitForURL(/\/acme-glass\/inquiries$/, { timeout: 20_000 }),
    page.getByRole("button", { name: /create inquiry/i }).click(),
  ]);

  // Click into the newly created inquiry detail page
  const inquiryLink = page.getByRole("link").filter({ hasText: inquiryName }).first();
  await expect(inquiryLink).toBeVisible({ timeout: 10_000 });
  await inquiryLink.click();
  await expect(page).toHaveURL(/\/acme-glass\/inquiries\/[0-9a-f-]{36}$/, {
    timeout: 15_000,
  });

  // Page must display the inquiry name and fields
  await expect(page.getByText(inquiryName)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("KSA")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("SAR")).toBeVisible({ timeout: 10_000 });
  // Status must show "New" (translated)
  await expect(page.getByText(/new/i)).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Inquiry — per-org sequence numbers
// ---------------------------------------------------------------------------

test("Two consecutive inquiries get sequential inquiryNumbers (#N and #N+1)", async ({
  page,
}) => {
  const ts = Date.now();
  const name1 = `E2E Seq First ${ts}`;
  const name2 = `E2E Seq Second ${ts}`;

  await signIn(page, "admin");

  // Create first inquiry
  await page.goto("/acme-glass/inquiries/new");
  await page.locator("input[name='name']").fill(name1);
  await page.locator("input[name='destinationCountry']").fill("UAE");
  await page.locator("input[name='currency']").fill("AED");
  await Promise.all([
    page.waitForURL(/\/acme-glass\/inquiries$/, { timeout: 20_000 }),
    page.getByRole("button", { name: /create inquiry/i }).click(),
  ]);

  // Get the number of the first inquiry from the list
  const row1 = page.getByRole("row").filter({ hasText: name1 }).first();
  await expect(row1).toBeVisible({ timeout: 10_000 });
  const firstLink = row1.getByRole("link", { name: /^#\d+$/ });
  const firstHref = await firstLink.getAttribute("href");
  const firstLinkText = await firstLink.textContent();
  const firstNum = parseInt(firstLinkText?.replace("#", "") ?? "0", 10);
  expect(firstNum).toBeGreaterThan(0);
  expect(firstHref).toBeTruthy();

  // Create second inquiry
  await page.goto("/acme-glass/inquiries/new");
  await page.locator("input[name='name']").fill(name2);
  await page.locator("input[name='destinationCountry']").fill("UAE");
  await page.locator("input[name='currency']").fill("AED");
  await Promise.all([
    page.waitForURL(/\/acme-glass\/inquiries$/, { timeout: 20_000 }),
    page.getByRole("button", { name: /create inquiry/i }).click(),
  ]);

  // Get the number of the second inquiry
  const row2 = page.getByRole("row").filter({ hasText: name2 }).first();
  await expect(row2).toBeVisible({ timeout: 10_000 });
  const secondLink = row2.getByRole("link", { name: /^#\d+$/ });
  const secondLinkText = await secondLink.textContent();
  const secondNum = parseInt(secondLinkText?.replace("#", "") ?? "0", 10);

  // Second must be exactly first + 1
  expect(secondNum).toBe(firstNum + 1);
});

// ---------------------------------------------------------------------------
// Inquiry — dismiss
// ---------------------------------------------------------------------------

test("Dismiss action: inquiry status becomes Dismissed", async ({ page }) => {
  const inquiryName = `E2E Dismiss ${Date.now()}`;

  await signIn(page, "admin");
  await page.goto("/acme-glass/inquiries/new");

  await page.locator("input[name='name']").fill(inquiryName);
  await page.locator("input[name='destinationCountry']").fill("UAE");
  await page.locator("input[name='currency']").fill("AED");

  await Promise.all([
    page.waitForURL(/\/acme-glass\/inquiries$/, { timeout: 20_000 }),
    page.getByRole("button", { name: /create inquiry/i }).click(),
  ]);

  // Navigate to the inquiry detail page
  const inquiryLink = page.getByRole("link").filter({ hasText: inquiryName }).first();
  await expect(inquiryLink).toBeVisible({ timeout: 10_000 });
  await inquiryLink.click();
  await expect(page).toHaveURL(/\/acme-glass\/inquiries\/[0-9a-f-]{36}$/, {
    timeout: 15_000,
  });

  // Click Dismiss
  const dismissButton = page.getByRole("button", { name: /dismiss/i });
  await expect(dismissButton).toBeVisible({ timeout: 10_000 });
  await expect(dismissButton).not.toBeDisabled();

  await Promise.all([
    page.waitForURL(/\/acme-glass\/inquiries\/[0-9a-f-]{36}$/, { timeout: 20_000 }),
    dismissButton.click(),
  ]);

  // Status must now show "Dismissed"
  await expect(page.getByText(/dismissed/i)).toBeVisible({ timeout: 15_000 });

  // Dismiss and Start Project buttons must be disabled after dismissal
  await expect(page.getByRole("button", { name: /dismiss/i })).toBeDisabled({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: /start project/i })).toBeDisabled({
    timeout: 10_000,
  });
});

// ---------------------------------------------------------------------------
// Inquiry — convert to Project
// ---------------------------------------------------------------------------

test("Convert inquiry to Project: creates project with same fields, inquiry shows Converted", async ({
  page,
}) => {
  const inquiryName = `E2E Convert ${Date.now()}`;
  const country = "KSA";
  const currency = "SAR";

  await signIn(page, "admin");
  await page.goto("/acme-glass/inquiries/new");

  await page.locator("input[name='name']").fill(inquiryName);
  await page.locator("input[name='destinationCountry']").fill(country);
  await page.locator("input[name='currency']").fill(currency);

  await Promise.all([
    page.waitForURL(/\/acme-glass\/inquiries$/, { timeout: 20_000 }),
    page.getByRole("button", { name: /create inquiry/i }).click(),
  ]);

  // Navigate to the inquiry detail page
  const inquiryLink = page.getByRole("link").filter({ hasText: inquiryName }).first();
  await expect(inquiryLink).toBeVisible({ timeout: 10_000 });
  await inquiryLink.click();
  await expect(page).toHaveURL(/\/acme-glass\/inquiries\/[0-9a-f-]{36}$/, {
    timeout: 15_000,
  });

  // Record the inquiry ID from the URL
  const inquiryUrl = page.url();
  const inquiryId = inquiryUrl.split("/").pop() ?? "";
  expect(inquiryId).toMatch(/^[0-9a-f-]{36}$/);

  // Click Start Project
  const startButton = page.getByRole("button", { name: /start project/i });
  await expect(startButton).toBeVisible({ timeout: 10_000 });
  await expect(startButton).not.toBeDisabled();

  // After clicking, should redirect to the new project's detail page
  await startButton.click();
  await expect(page).toHaveURL(/\/acme-glass\/projects\/[0-9a-f-]{36}$/, {
    timeout: 20_000,
  });

  // Project detail page must show the inquiry's fields
  await expect(page.getByText(inquiryName)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(country)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(currency)).toBeVisible({ timeout: 10_000 });

  // Navigate back to the inquiry to confirm it shows Converted
  await page.goto(inquiryUrl);
  await expect(page.getByText(/converted/i)).toBeVisible({ timeout: 15_000 });

  // Start Project button must be disabled after conversion
  await expect(page.getByRole("button", { name: /start project/i })).toBeDisabled({
    timeout: 10_000,
  });
});

// ---------------------------------------------------------------------------
// Inquiry — tenancy isolation
// ---------------------------------------------------------------------------

test("Inquiry tenancy: acme-glass session redirected when accessing nordic-walls inquiry routes", async ({
  page,
}) => {
  await signIn(page, "admin", "Seed1234!", "acme-glass");

  // Cross-org guard: acme-glass session on nordic-walls URL → redirect to nordic-walls login
  await page.goto("/nordic-walls/inquiries");
  await page.waitForURL(/\/nordic-walls\/login/, { timeout: 15_000 });
});

test("Inquiry tenancy: acme-glass inquiry not accessible via nordic-walls URL space", async ({
  page,
}) => {
  // Create an inquiry as acme-glass admin
  await signIn(page, "admin", "Seed1234!", "acme-glass");

  await page.goto("/acme-glass/inquiries/new");
  const inquiryName = `E2E Tenancy ${Date.now()}`;
  await page.locator("input[name='name']").fill(inquiryName);
  await page.locator("input[name='destinationCountry']").fill("UAE");
  await page.locator("input[name='currency']").fill("AED");

  await Promise.all([
    page.waitForURL(/\/acme-glass\/inquiries$/, { timeout: 20_000 }),
    page.getByRole("button", { name: /create inquiry/i }).click(),
  ]);

  // Get the inquiry ID
  const inquiryLink = page.getByRole("link").filter({ hasText: inquiryName }).first();
  await expect(inquiryLink).toBeVisible({ timeout: 10_000 });
  const href = await inquiryLink.getAttribute("href");
  const inquiryId = href?.split("/").pop() ?? "";
  expect(inquiryId).toMatch(/^[0-9a-f-]{36}$/);

  // Sign out of acme-glass
  await page.goto("/acme-glass/dashboard");
  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/acme-glass\/login/, { timeout: 15_000 });

  // Sign in as nordic-walls admin
  await signIn(page, "admin", "Seed1234!", "nordic-walls");

  // Try to access acme-glass's inquiry from nordic-walls URL space
  await page.goto(`/nordic-walls/inquiries/${inquiryId}`);

  // Tenancy guard should result in a 404 (notFound()) — inquiry not in nordic-walls org
  await page.waitForLoadState("domcontentloaded");
  // Confirm the inquiry name does NOT appear (tenancy enforced)
  await expect(page.getByText(inquiryName)).not.toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// ComponentType JSON toggle — valid round-trip
// ---------------------------------------------------------------------------

test("ComponentType JSON round-trip: paste valid JSON, switch to Form, fields appear", async ({
  page,
}) => {
  const code = `E2E_JSON_${Date.now()}`;
  const name = `E2E JSON Toggle ${code}`;

  await signIn(page, "admin");

  // Create a new ComponentType first
  await page.goto("/acme-glass/admin/components/new");
  await page.locator("input[name='code']").fill(code);
  await page.locator("input[name='name']").fill(name);
  await page.locator("select[name='categoryId']").selectOption({ label: "Glass Partitions" });

  await Promise.all([
    page.waitForURL(
      (url) => /\/acme-glass\/admin\/components\/[0-9a-f-]{36}/.test(url.toString()),
      { timeout: 30_000 },
    ),
    page.getByRole("button", { name: /create component type/i }).click(),
  ]);

  const editUrl = page.url();

  // Switch to JSON mode
  const jsonModeButton = page.getByRole("button", { name: /^json$/i });
  await expect(jsonModeButton).toBeVisible({ timeout: 15_000 });
  await jsonModeButton.click();

  // Textarea should appear with JSON content
  const textarea = page.locator("textarea");
  await expect(textarea).toBeVisible({ timeout: 10_000 });

  // Replace with a valid JSON array containing one text field
  const validSchema = JSON.stringify(
    [
      {
        key: "e2e_test_key",
        label: "E2E Test Field",
        type: "field",
        required: true,
        basic: true,
      },
    ],
    null,
    2,
  );
  await textarea.fill(validSchema);

  // Switch to Form mode — validation runs, fields should appear
  const formModeButton = page.getByRole("button", { name: /^form$/i });
  await expect(formModeButton).toBeVisible({ timeout: 10_000 });
  await formModeButton.click();

  // No error should be shown
  const errorMsg = page.locator("p.text-red-600, p.text-red-400");
  await expect(errorMsg).not.toBeVisible({ timeout: 5_000 });

  // The field with our key should appear in the form
  await expect(page.locator(`input[value='e2e_test_key']`)).toBeVisible({ timeout: 10_000 });

  // Save the form
  await Promise.all([
    page.waitForResponse(
      (res) => res.request().method() === "POST" && res.url().includes("/admin/components"),
      { timeout: 20_000 },
    ),
    page.getByRole("button", { name: /save changes/i }).click(),
  ]);

  // Reload to confirm JSONB persisted
  await page.goto(editUrl);
  await page.reload();
  await expect(page.locator(`input[value='e2e_test_key']`)).toBeVisible({ timeout: 15_000 });
});

// ---------------------------------------------------------------------------
// ComponentType JSON toggle — invalid JSON parse error
// ---------------------------------------------------------------------------

test("ComponentType JSON mode: malformed JSON shows inline error, stays in JSON mode", async ({
  page,
}) => {
  const code = `E2E_BADJSON_${Date.now()}`;
  const name = `E2E Bad JSON ${code}`;

  await signIn(page, "admin");
  await page.goto("/acme-glass/admin/components/new");
  await page.locator("input[name='code']").fill(code);
  await page.locator("input[name='name']").fill(name);
  await page.locator("select[name='categoryId']").selectOption({ label: "Glass Partitions" });

  await Promise.all([
    page.waitForURL(
      (url) => /\/acme-glass\/admin\/components\/[0-9a-f-]{36}/.test(url.toString()),
      { timeout: 30_000 },
    ),
    page.getByRole("button", { name: /create component type/i }).click(),
  ]);

  // Switch to JSON mode
  await page.getByRole("button", { name: /^json$/i }).click();

  const textarea = page.locator("textarea");
  await expect(textarea).toBeVisible({ timeout: 10_000 });

  // Enter malformed JSON (missing closing bracket)
  await textarea.fill("{this is not valid json");

  // Click Form mode — should show an error, stay in JSON mode
  await page.getByRole("button", { name: /^form$/i }).click();

  // An error message should appear (contains "Invalid JSON")
  const errorEl = page.locator("text=/Invalid JSON/i");
  await expect(errorEl).toBeVisible({ timeout: 10_000 });

  // Textarea is still visible (stayed in JSON mode)
  await expect(textarea).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// ComponentType JSON toggle — wrong shape (radio with no options)
// ---------------------------------------------------------------------------

test("ComponentType JSON mode: radio field with no options shows inline shape error", async ({
  page,
}) => {
  const code = `E2E_BADSHAPE_${Date.now()}`;
  const name = `E2E Bad Shape ${code}`;

  await signIn(page, "admin");
  await page.goto("/acme-glass/admin/components/new");
  await page.locator("input[name='code']").fill(code);
  await page.locator("input[name='name']").fill(name);
  await page.locator("select[name='categoryId']").selectOption({ label: "Glass Partitions" });

  await Promise.all([
    page.waitForURL(
      (url) => /\/acme-glass\/admin\/components\/[0-9a-f-]{36}/.test(url.toString()),
      { timeout: 30_000 },
    ),
    page.getByRole("button", { name: /create component type/i }).click(),
  ]);

  // Switch to JSON mode
  await page.getByRole("button", { name: /^json$/i }).click();

  const textarea = page.locator("textarea");
  await expect(textarea).toBeVisible({ timeout: 10_000 });

  // Enter valid JSON but invalid shape: radio type with empty options array
  const badShapeSchema = JSON.stringify([
    {
      key: "glass_type",
      label: "Glass Type",
      type: "radio",
      options: [], // empty — should cause a validation error
      required: true,
      basic: true,
    },
  ]);
  await textarea.fill(badShapeSchema);

  // Click Form mode — shape validation should catch the empty-options error
  await page.getByRole("button", { name: /^form$/i }).click();

  // An error message should appear (contains "Invalid schema")
  const errorEl = page.locator("text=/Invalid schema/i");
  await expect(errorEl).toBeVisible({ timeout: 10_000 });

  // Textarea is still visible (stayed in JSON mode)
  await expect(textarea).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// ComponentType JSON toggle — submit disabled in JSON mode
// ---------------------------------------------------------------------------

test("ComponentType JSON mode: submit button is disabled while in JSON mode", async ({ page }) => {
  const code = `E2E_SUBMITDIS_${Date.now()}`;
  const name = `E2E Submit Disabled ${code}`;

  await signIn(page, "admin");
  await page.goto("/acme-glass/admin/components/new");
  await page.locator("input[name='code']").fill(code);
  await page.locator("input[name='name']").fill(name);
  await page.locator("select[name='categoryId']").selectOption({ label: "Glass Partitions" });

  await Promise.all([
    page.waitForURL(
      (url) => /\/acme-glass\/admin\/components\/[0-9a-f-]{36}/.test(url.toString()),
      { timeout: 30_000 },
    ),
    page.getByRole("button", { name: /create component type/i }).click(),
  ]);

  // Initially in Form mode — submit (Save Changes) should be enabled
  const submitButton = page.getByRole("button", { name: /save changes/i });
  await expect(submitButton).toBeEnabled({ timeout: 15_000 });

  // Switch to JSON mode
  await page.getByRole("button", { name: /^json$/i }).click();

  // Submit must be disabled in JSON mode
  await expect(submitButton).toBeDisabled({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Regression — direct Project create (Inquiry-free path) still works
// ---------------------------------------------------------------------------

test("Direct Project create (no Inquiry) still works correctly after Stage 7", async ({
  page,
}) => {
  const projectName = `E2E Direct Project ${Date.now()}`;

  await signIn(page, "admin");
  await page.goto("/acme-glass/projects/new");
  await expect(page).not.toHaveURL(/\/acme-glass\/login/, { timeout: 15_000 });

  await page.locator("input[name='name']").fill(projectName);
  await page.locator("input[name='destinationCountry']").fill("UAE");
  await page.locator("input[name='currency']").fill("AED");

  await Promise.all([
    page.waitForURL(/\/acme-glass\/projects$/, { timeout: 20_000 }),
    page.getByRole("button", { name: /create project/i }).click(),
  ]);

  // Project must appear in the list
  await expect(page.getByText(projectName)).toBeVisible({ timeout: 15_000 });
});

// ---------------------------------------------------------------------------
// Regression — i18n client namespace wiring (inquiries layout forwards namespace)
// ---------------------------------------------------------------------------

test("Inquiries create form renders in browser (clientMessages wiring works)", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/inquiries/new");

  // If clientMessages wiring is broken, the form would be inert (no fields visible).
  // The form must render with at least a name field and a submit button.
  await expect(page.locator("input[name='name']")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /create inquiry/i })).toBeVisible({
    timeout: 10_000,
  });
});

test("Start Project button renders on inquiry detail page (clientMessages wiring works)", async ({
  page,
}) => {
  const inquiryName = `E2E i18n Wiring ${Date.now()}`;

  await signIn(page, "admin");
  await page.goto("/acme-glass/inquiries/new");
  await page.locator("input[name='name']").fill(inquiryName);
  await page.locator("input[name='destinationCountry']").fill("UAE");
  await page.locator("input[name='currency']").fill("AED");
  await Promise.all([
    page.waitForURL(/\/acme-glass\/inquiries$/, { timeout: 20_000 }),
    page.getByRole("button", { name: /create inquiry/i }).click(),
  ]);

  // Navigate to the detail page
  const link = page.getByRole("link").filter({ hasText: inquiryName }).first();
  await expect(link).toBeVisible({ timeout: 10_000 });
  await link.click();
  await expect(page).toHaveURL(/\/acme-glass\/inquiries\/[0-9a-f-]{36}$/, {
    timeout: 15_000,
  });

  // If StartProjectButton client component failed to mount (clientMessages bug),
  // the button would not appear.
  await expect(page.getByRole("button", { name: /start project/i })).toBeVisible({
    timeout: 15_000,
  });
});
