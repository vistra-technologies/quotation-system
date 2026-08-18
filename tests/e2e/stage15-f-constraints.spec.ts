/**
 * Stage 15 Batch F — C6 and C9 constraint verification.
 *
 * C6 — currency defaults to company's defaultCurrency, else INR:
 *   - Create forms: assert currency select updates to AED when an AED company is selected.
 *   - Edit forms: change the currency select, blur the budget, assert the re-formatted
 *     display uses the NEW currency's grouping. This assertion fails on revert (old code
 *     used defaultValue={initialCurrency}, so handleBudgetBlur always reads the stale
 *     initialCurrency, not the user's new selection).
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
 * Visual-only checks (browser constraint tooltip):
 *   verified manually against the preview and reported at the bottom of item-F.md.
 */

import { test, expect } from "@playwright/test";
import { signIn, orgUrl, apiUrl } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

// Rate-limit pacing.
test.beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 7_000));
});

// AED company known to exist in the dev DB (confirmed via API call before writing this spec).
// Simpler: we select by button text in the popover, not by ID.
const AED_COMPANY_NAME = "E2E Test Co Stage13";

// ---------------------------------------------------------------------------
// C6 — Inquiry create: AED company selection → currency select shows AED
// ---------------------------------------------------------------------------

test("C6 inquiry create: currency updates to AED when AED company selected", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto(orgUrl("acme-glass", "/inquiries/new"));
  await page.waitForURL(/inquiries\/new/, { timeout: 20_000 });

  const currencySelect = page.locator("select[name='currency']");

  // Open the CompanyDropdown and select the AED company.
  await page.locator("button#externalCompanyId").click();
  await page.locator(`[role="option"]`).getByText(AED_COMPANY_NAME, { exact: true }).click();

  // C6 happy-path: after selecting an AED company, currency select must update to "AED".
  const afterSelectionCurrency = await currencySelect.inputValue();
  expect(afterSelectionCurrency).toBe("AED");
});

// ---------------------------------------------------------------------------
// C6 — Project create: same assertion
// ---------------------------------------------------------------------------

test("C6 project create: currency updates to AED when AED company selected", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto(orgUrl("acme-glass", "/projects/new"));
  await page.waitForURL(/projects\/new/, { timeout: 20_000 });

  const currencySelect = page.locator("select[name='currency']");

  // Open dropdown and select the AED company.
  await page.locator("button#externalCompanyId").click();
  await page.locator(`[role="option"]`).getByText(AED_COMPANY_NAME, { exact: true }).click();

  // Currency select must now show "AED".
  const afterSelectionCurrency = await currencySelect.inputValue();
  expect(afterSelectionCurrency).toBe("AED");
});

// ---------------------------------------------------------------------------
// C6 — Inquiry edit: change currency select → blur budget → display uses NEW currency.
//
// This assertion genuinely fails on revert (old defaultValue={initialCurrency} code).
// Without controlled value={selectedCurrency} + onChange → setSelectedCurrency,
// handleBudgetBlur reads the stale initialCurrency (INR) and formats with Indian lakh
// grouping ("10,00,000") instead of AED/US thousands grouping ("1,000,000").
// ---------------------------------------------------------------------------

test("C6 inquiry edit: changing currency before blur re-formats using new currency grouping", async ({
  page,
}) => {
  await signIn(page, "admin");

  // Find an INR inquiry created by stage15-f.spec.ts.
  const listRes = await page.request.get(
    apiUrl("acme-glass", "/api/v1/orgs/acme-glass/inquiries?page=1&pageSize=20&scope=all"),
  );
  expect(listRes.ok()).toBe(true);
  const listBody = (await listRes.json()) as { inquiries: { id: string; name: string }[] };
  const c5Inquiry = listBody.inquiries.find((i) => i.name.startsWith("C5-inq-create-"));
  expect(c5Inquiry, "C5 inquiry create test must have run before this test").toBeTruthy();

  await page.goto(orgUrl("acme-glass", `/inquiries/${c5Inquiry!.id}/edit`));
  await page.waitForURL(/\/edit$/, { timeout: 20_000 });

  const currencySelect = page.locator("select[name='currency']");
  const budgetInput = page.locator("input[name='projectBudget']");

  // Switch currency from INR → AED before touching the budget field.
  await currencySelect.selectOption("AED");

  // Fill a raw number and blur — the blur handler must use the NEW currency (AED).
  await budgetInput.fill("1000000");
  await budgetInput.press("Tab");

  // AED uses US thousands grouping: "1,000,000".
  // Without selectedCurrency state tracking the select, blur uses stale INR → "10,00,000".
  const displayedBudget = await budgetInput.inputValue();
  expect(displayedBudget).toBe("1,000,000");
});

// ---------------------------------------------------------------------------
// C6 — Project edit: change currency select → blur budget → display uses NEW currency.
// ---------------------------------------------------------------------------

test("C6 project edit: changing currency before blur re-formats using new currency grouping", async ({
  page,
}) => {
  await signIn(page, "admin");

  // Find the USD project created by stage15-f.spec.ts.
  const listRes = await page.request.get(
    apiUrl("acme-glass", "/api/v1/orgs/acme-glass/projects?page=1&pageSize=20&scope=all"),
  );
  expect(listRes.ok()).toBe(true);
  const listBody = (await listRes.json()) as { projects: { id: string; name: string }[] };
  const c5Project = listBody.projects.find((p) => p.name.startsWith("C5-proj-create-"));
  expect(c5Project, "C5 project create test must have run before this test").toBeTruthy();

  await page.goto(orgUrl("acme-glass", `/projects/${c5Project!.id}/edit`));
  await page.waitForURL(/\/edit$/, { timeout: 20_000 });

  const currencySelect = page.locator("select[name='currency']");
  const budgetInput = page.locator("input[name='projectBudget']");

  // Switch currency from USD → INR before touching the budget field.
  await currencySelect.selectOption("INR");

  // Fill a raw number and blur — the blur handler must use the NEW currency (INR).
  await budgetInput.fill("1000000");
  await budgetInput.press("Tab");

  // INR uses Indian lakh grouping: "10,00,000".
  // Without selectedCurrency state tracking the select, blur uses stale USD → "1,000,000".
  const displayedBudget = await budgetInput.inputValue();
  expect(displayedBudget).toBe("10,00,000");
});

// ---------------------------------------------------------------------------
// C9 — Budget field: inputMode and pattern present on all four forms
// ---------------------------------------------------------------------------

test("C9 inquiry create: budget field has inputMode=decimal and a pattern constraint", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto(orgUrl("acme-glass", "/inquiries/new"));
  await page.waitForURL(/inquiries\/new/, { timeout: 20_000 });

  const budgetInput = page.locator("input[name='projectBudget']");
  const attrs = await budgetInput.evaluate((el: HTMLInputElement) => ({
    inputMode: el.inputMode,
    pattern: el.pattern,
  }));

  expect(attrs.inputMode).toBe("decimal");
  expect(attrs.pattern).toBeTruthy();
  // Pattern must reject non-numeric characters — verify via checkValidity():
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
    apiUrl("acme-glass", "/api/v1/orgs/acme-glass/inquiries?page=1&pageSize=20&scope=all"),
  );
  const listBody = (await listRes.json()) as { inquiries: { id: string; name: string }[] };
  const c5Inquiry = listBody.inquiries.find((i) => i.name.startsWith("C5-inq-create-"));
  expect(c5Inquiry).toBeTruthy();

  await page.goto(orgUrl("acme-glass", `/inquiries/${c5Inquiry!.id}/edit`));
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

  await budgetInput.fill("2000000");
  const valid = await budgetInput.evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(valid).toBe(true);
});

test("C9 project create: budget field has inputMode=decimal and pattern constraint", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto(orgUrl("acme-glass", "/projects/new"));
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
    apiUrl("acme-glass", "/api/v1/orgs/acme-glass/projects?page=1&pageSize=20&scope=all"),
  );
  const listBody = (await listRes.json()) as { projects: { id: string; name: string }[] };
  const c5Project = listBody.projects.find((p) => p.name.startsWith("C5-proj-create-"));
  expect(c5Project).toBeTruthy();

  await page.goto(orgUrl("acme-glass", `/projects/${c5Project!.id}/edit`));
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
  await page.goto(orgUrl("acme-glass", "/inquiries/new"));
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
    apiUrl("acme-glass", "/api/v1/orgs/acme-glass/inquiries?page=1&pageSize=20&scope=all"),
  );
  const listBody = (await listRes.json()) as { inquiries: { id: string; name: string }[] };
  const c5Inquiry = listBody.inquiries.find((i) => i.name.startsWith("C5-inq-create-"));
  expect(c5Inquiry).toBeTruthy();

  await page.goto(orgUrl("acme-glass", `/inquiries/${c5Inquiry!.id}/edit`));
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
  await page.goto(orgUrl("acme-glass", "/projects/new"));
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
    apiUrl("acme-glass", "/api/v1/orgs/acme-glass/projects?page=1&pageSize=20&scope=all"),
  );
  const listBody = (await listRes.json()) as { projects: { id: string; name: string }[] };
  const c5Project = listBody.projects.find((p) => p.name.startsWith("C5-proj-create-"));
  expect(c5Project).toBeTruthy();

  await page.goto(orgUrl("acme-glass", `/projects/${c5Project!.id}/edit`));
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
