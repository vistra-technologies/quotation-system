/**
 * Stage 15 Batch F — C6 and C9 constraint verification.
 *
 * C6 — currency defaults to company's defaultCurrency, else INR:
 *   - Create forms: assert currency select starts at INR (no company), then
 *     updates to AED when an AED company is selected.
 *   - Edit forms: company is locked (no dropdown). Assert the currency select
 *     shows the value saved with the record (controlled by initialCurrency).
 *
 * C9 — HTML5 pattern constraints:
 *   - Budget field: assert inputMode="decimal" and a non-empty pattern are
 *     present via element.evaluate().
 *   - Name fields: fill an invalid character (@) and assert checkValidity()
 *     returns false; fill a valid alphanumeric+space+hyphen string and assert
 *     checkValidity() returns true.
 *
 * Depends on IDs created in stage15-f.spec.ts (the E2E budget-save tests).
 * Those tests write createdInquiryId / createdProjectId to module-level
 * variables — this separate file fetches those IDs fresh via the API instead.
 *
 * Visual-only checks (browser constraint tooltip, C6 visual indicator):
 *   verified manually against the preview and reported at the bottom of item-F.md.
 */

import { test, expect } from "@playwright/test";
import { signIn, fillCreateFormRequiredFields } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

// Rate-limit pacing.
test.beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 7_000));
});

// AED company known to exist in the dev DB (confirmed via API call before writing this spec).
// "E2E Test Co Stage13" id = 6b9f99ec-... (first 8 chars only shown above; full ID needed).
// Simpler: we select by button text in the popover, not by ID.
const AED_COMPANY_NAME = "E2E Test Co Stage13";

// ---------------------------------------------------------------------------
// C6 — Inquiry create: else-branch (no company) → INR; AED company → AED
// ---------------------------------------------------------------------------

test("C6 inquiry create: currency starts as INR (no company), updates to AED when AED company selected", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/inquiries/new");
  await page.waitForURL(/inquiries\/new/, { timeout: 20_000 });

  const currencySelect = page.locator("select[name='currency']");

  // C6 else-branch: no company selected → currency must be "INR".
  const initialCurrency = await currencySelect.inputValue();
  expect(initialCurrency).toBe("INR");

  // Open the CompanyDropdown and select the AED company.
  await page.locator("button#externalCompanyId").click();
  await page.locator(`[role="option"]`).getByText(AED_COMPANY_NAME, { exact: true }).click();

  // C6 happy-path: after selecting an AED company, currency select must update to "AED".
  const afterSelectionCurrency = await currencySelect.inputValue();
  expect(afterSelectionCurrency).toBe("AED");
});

// ---------------------------------------------------------------------------
// C6 — Project create: same two assertions
// ---------------------------------------------------------------------------

test("C6 project create: currency starts as INR (no company), updates to AED when AED company selected", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/projects/new");
  await page.waitForURL(/projects\/new/, { timeout: 20_000 });

  const currencySelect = page.locator("select[name='currency']");

  // Else-branch: no company → INR.
  const initialCurrency = await currencySelect.inputValue();
  expect(initialCurrency).toBe("INR");

  // Open dropdown and select the AED company.
  await page.locator("button#externalCompanyId").click();
  await page.locator(`[role="option"]`).getByText(AED_COMPANY_NAME, { exact: true }).click();

  // Currency select must now show "AED".
  const afterSelectionCurrency = await currencySelect.inputValue();
  expect(afterSelectionCurrency).toBe("AED");
});

// ---------------------------------------------------------------------------
// C6 — Inquiry edit: company locked, currency select shows saved currency (INR).
// Uses the inquiry created in stage15-f.spec.ts (last one saved "2500000"/INR).
// We fetch the most recent inquiry by this admin and open its edit form.
// ---------------------------------------------------------------------------

test("C6 inquiry edit: currency select shows the saved INR value (controlled by initialCurrency)", async ({
  page,
}) => {
  await signIn(page, "admin");

  // Find an inquiry that has INR currency (the C5 inquiry create test used INR).
  const listRes = await page.request.get(
    "/api/v1/orgs/acme-glass/inquiries?page=1&pageSize=20&scope=all",
  );
  expect(listRes.ok()).toBe(true);
  const listBody = (await listRes.json()) as { inquiries: { id: string; name: string }[] };

  // The stage15-f test created inquiries named "C5-inq-create-*" with INR currency.
  const c5Inquiry = listBody.inquiries.find((i) => i.name.startsWith("C5-inq-create-"));
  expect(c5Inquiry, "C5 inquiry create test must have run before this test").toBeTruthy();

  // Fetch its detail to confirm currency is INR.
  const detailRes = await page.request.get(
    `/api/v1/orgs/acme-glass/inquiries/${c5Inquiry!.id}`,
  );
  expect(detailRes.ok()).toBe(true);
  const detail = (await detailRes.json()) as { inquiry: { currency: string } };
  expect(detail.inquiry.currency).toBe("INR");

  // Open the edit form and assert the currency select shows "INR".
  await page.goto(`/acme-glass/inquiries/${c5Inquiry!.id}/edit`);
  await page.waitForURL(/\/edit$/, { timeout: 20_000 });

  const currencySelect = page.locator("select[name='currency']");
  const editCurrency = await currencySelect.inputValue();
  expect(editCurrency).toBe("INR");
});

// ---------------------------------------------------------------------------
// C6 — Project edit: company locked, currency select shows saved currency (USD).
// ---------------------------------------------------------------------------

test("C6 project edit: currency select shows the saved USD value (controlled by initialCurrency)", async ({
  page,
}) => {
  await signIn(page, "admin");

  // Find a project with USD currency (stage15-f created "C5-proj-create-*" with USD).
  const listRes = await page.request.get(
    "/api/v1/orgs/acme-glass/projects?page=1&pageSize=20&scope=all",
  );
  expect(listRes.ok()).toBe(true);
  const listBody = (await listRes.json()) as { projects: { id: string; name: string }[] };

  const c5Project = listBody.projects.find((p) => p.name.startsWith("C5-proj-create-"));
  expect(c5Project, "C5 project create test must have run before this test").toBeTruthy();

  const detailRes = await page.request.get(
    `/api/v1/orgs/acme-glass/projects/${c5Project!.id}`,
  );
  expect(detailRes.ok()).toBe(true);
  const detail = (await detailRes.json()) as { project: { currency: string } };
  expect(detail.project.currency).toBe("USD");

  await page.goto(`/acme-glass/projects/${c5Project!.id}/edit`);
  await page.waitForURL(/\/edit$/, { timeout: 20_000 });

  const currencySelect = page.locator("select[name='currency']");
  const editCurrency = await currencySelect.inputValue();
  expect(editCurrency).toBe("USD");
});

// ---------------------------------------------------------------------------
// C9 — Budget field: inputMode and pattern present on all four forms
// ---------------------------------------------------------------------------

test("C9 inquiry create: budget field has inputMode=decimal and a pattern constraint", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/inquiries/new");
  await page.waitForURL(/inquiries\/new/, { timeout: 20_000 });

  const budgetInput = page.locator("input[name='projectBudget']");
  const attrs = await budgetInput.evaluate((el: HTMLInputElement) => ({
    inputMode: el.inputMode,
    pattern: el.pattern,
  }));

  expect(attrs.inputMode).toBe("decimal");
  expect(attrs.pattern).toBeTruthy();
  // Pattern must reject non-numeric characters — a comma and dot are allowed,
  // but % or @ are not. Verify via checkValidity():
  await budgetInput.fill("abc@123");
  const invalidBudgetValid = await budgetInput.evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(invalidBudgetValid).toBe(false);

  await budgetInput.fill("1000000");
  const validBudgetValid = await budgetInput.evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(validBudgetValid).toBe(true);
});

test("C9 inquiry edit: budget field has inputMode=decimal and pattern constraint", async ({
  page,
}) => {
  await signIn(page, "admin");

  const listRes = await page.request.get(
    "/api/v1/orgs/acme-glass/inquiries?page=1&pageSize=20&scope=all",
  );
  const listBody = (await listRes.json()) as { inquiries: { id: string; name: string }[] };
  const c5Inquiry = listBody.inquiries.find((i) => i.name.startsWith("C5-inq-create-"));
  expect(c5Inquiry).toBeTruthy();

  await page.goto(`/acme-glass/inquiries/${c5Inquiry!.id}/edit`);
  await page.waitForURL(/\/edit$/, { timeout: 20_000 });

  const budgetInput = page.locator("input[name='projectBudget']");
  const attrs = await budgetInput.evaluate((el: HTMLInputElement) => ({
    inputMode: el.inputMode,
    pattern: el.pattern,
  }));
  expect(attrs.inputMode).toBe("decimal");
  expect(attrs.pattern).toBeTruthy();

  // C5 edit form has a controlled budget — fill triggers onChange which sets budgetValue.
  await budgetInput.fill("abc@");
  const invalid = await budgetInput.evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(invalid).toBe(false);

  await budgetInput.fill("2000000");
  const valid = await budgetInput.evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(valid).toBe(true);
});

test("C9 project create: budget field has inputMode=decimal and pattern constraint", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/projects/new");
  await page.waitForURL(/projects\/new/, { timeout: 20_000 });

  const budgetInput = page.locator("input[name='projectBudget']");
  const attrs = await budgetInput.evaluate((el: HTMLInputElement) => ({
    inputMode: el.inputMode,
    pattern: el.pattern,
  }));
  expect(attrs.inputMode).toBe("decimal");
  expect(attrs.pattern).toBeTruthy();

  await budgetInput.fill("abc@");
  const invalid = await budgetInput.evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(invalid).toBe(false);

  await budgetInput.fill("1500000");
  const valid = await budgetInput.evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(valid).toBe(true);
});

test("C9 project edit: budget field has inputMode=decimal and pattern constraint", async ({
  page,
}) => {
  await signIn(page, "admin");

  const listRes = await page.request.get(
    "/api/v1/orgs/acme-glass/projects?page=1&pageSize=20&scope=all",
  );
  const listBody = (await listRes.json()) as { projects: { id: string; name: string }[] };
  const c5Project = listBody.projects.find((p) => p.name.startsWith("C5-proj-create-"));
  expect(c5Project).toBeTruthy();

  await page.goto(`/acme-glass/projects/${c5Project!.id}/edit`);
  await page.waitForURL(/\/edit$/, { timeout: 20_000 });

  const budgetInput = page.locator("input[name='projectBudget']");
  const attrs = await budgetInput.evaluate((el: HTMLInputElement) => ({
    inputMode: el.inputMode,
    pattern: el.pattern,
  }));
  expect(attrs.inputMode).toBe("decimal");
  expect(attrs.pattern).toBeTruthy();

  await budgetInput.fill("abc@");
  const invalid = await budgetInput.evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(invalid).toBe(false);

  await budgetInput.fill("3000000");
  const valid = await budgetInput.evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(valid).toBe(true);
});

// ---------------------------------------------------------------------------
// C9 — Name fields: pattern constraint on all four forms
// Check: the `name` (project name) input rejects "@" and accepts "Valid Name-1"
// ---------------------------------------------------------------------------

test("C9 inquiry create: name field pattern rejects invalid chars, accepts alphanumeric+space+hyphen", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/inquiries/new");
  await page.waitForURL(/inquiries\/new/, { timeout: 20_000 });

  const nameInput = page.locator("input[name='name']");
  const patternAttr = await nameInput.evaluate((el: HTMLInputElement) => el.pattern);
  expect(patternAttr).toBeTruthy();

  // Fill with an invalid character (@) — pattern mismatch → checkValidity false.
  await nameInput.fill("Test@Invalid");
  const invalidCheck = await nameInput.evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(invalidCheck).toBe(false);

  // Fill with a valid value — alphanumeric + space + hyphen.
  await nameInput.fill("Valid Name-123");
  const validCheck = await nameInput.evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(validCheck).toBe(true);
});

test("C9 inquiry edit: name field pattern rejects invalid chars, accepts alphanumeric+space+hyphen", async ({
  page,
}) => {
  await signIn(page, "admin");

  const listRes = await page.request.get(
    "/api/v1/orgs/acme-glass/inquiries?page=1&pageSize=20&scope=all",
  );
  const listBody = (await listRes.json()) as { inquiries: { id: string; name: string }[] };
  const c5Inquiry = listBody.inquiries.find((i) => i.name.startsWith("C5-inq-create-"));
  expect(c5Inquiry).toBeTruthy();

  await page.goto(`/acme-glass/inquiries/${c5Inquiry!.id}/edit`);
  await page.waitForURL(/\/edit$/, { timeout: 20_000 });

  const nameInput = page.locator("input[name='name']");
  const patternAttr = await nameInput.evaluate((el: HTMLInputElement) => el.pattern);
  expect(patternAttr).toBeTruthy();

  await nameInput.fill("Test@Invalid");
  const invalidCheck = await nameInput.evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(invalidCheck).toBe(false);

  await nameInput.fill("Valid Name-123");
  const validCheck = await nameInput.evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(validCheck).toBe(true);
});

test("C9 project create: name field pattern rejects invalid chars, accepts alphanumeric+space+hyphen", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/projects/new");
  await page.waitForURL(/projects\/new/, { timeout: 20_000 });

  const nameInput = page.locator("input[name='name']");
  const patternAttr = await nameInput.evaluate((el: HTMLInputElement) => el.pattern);
  expect(patternAttr).toBeTruthy();

  await nameInput.fill("Test@Invalid");
  const invalidCheck = await nameInput.evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(invalidCheck).toBe(false);

  await nameInput.fill("Valid Name-123");
  const validCheck = await nameInput.evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(validCheck).toBe(true);
});

test("C9 project edit: name field pattern rejects invalid chars, accepts alphanumeric+space+hyphen", async ({
  page,
}) => {
  await signIn(page, "admin");

  const listRes = await page.request.get(
    "/api/v1/orgs/acme-glass/projects?page=1&pageSize=20&scope=all",
  );
  const listBody = (await listRes.json()) as { projects: { id: string; name: string }[] };
  const c5Project = listBody.projects.find((p) => p.name.startsWith("C5-proj-create-"));
  expect(c5Project).toBeTruthy();

  await page.goto(`/acme-glass/projects/${c5Project!.id}/edit`);
  await page.waitForURL(/\/edit$/, { timeout: 20_000 });

  const nameInput = page.locator("input[name='name']");
  const patternAttr = await nameInput.evaluate((el: HTMLInputElement) => el.pattern);
  expect(patternAttr).toBeTruthy();

  await nameInput.fill("Test@Invalid");
  const invalidCheck = await nameInput.evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(invalidCheck).toBe(false);

  await nameInput.fill("Valid Name-123");
  const validCheck = await nameInput.evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(validCheck).toBe(true);
});
