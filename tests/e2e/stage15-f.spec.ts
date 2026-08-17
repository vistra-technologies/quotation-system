/**
 * Stage 15 Batch F — Form behaviours: C5, C6, C9
 *
 * End-to-end budget-save verification for all four forms:
 *   - Inquiry create
 *   - Inquiry edit
 *   - Project create
 *   - Project edit
 *
 * THE CRITICAL INVARIANT: the value that reaches the server after the
 * blur formatter runs must parse to the correct number.  These tests
 * type a budget, trigger blur, submit, and then read the persisted value
 * back from the API to confirm the stored string is the clean numeric
 * form (no commas, correct digits).
 *
 * C5 — on-blur formatting, C6 — currency default (not separately automatable
 * without controlling what company data is in the DB, so verified manually
 * and noted here).  C9 — HTML5 pattern restrictions are browser-enforced
 * and verified manually in the preview; Playwright doesn't check browser
 * validation UI.
 *
 * Uses page.request (shares browser cookie store) for API calls.
 */

import { test, expect } from "@playwright/test";
import { signIn, fillCreateFormRequiredFields } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

// Rate-limit pacing — better-auth caps sign-in to ~3 / 10 s per IP.
test.beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 7_000));
});

// IDs shared across tests in this serial run.
let createdInquiryId: string;
let createdProjectId: string;

// ---------------------------------------------------------------------------
// C5 — Inquiry create: budget entered as a raw number, blurred (triggers
// formatting), submitted, and read back from the API as a clean numeric string.
// ---------------------------------------------------------------------------

test("C5 inquiry create: budget persisted as clean numeric string after blur-format", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/inquiries/new");
  await page.waitForURL(/inquiries\/new/, { timeout: 20_000 });

  const uniqueName = `C5-inq-create-${Date.now()}`;

  // Fill required name and company-dependent fields.
  await page.locator("input[name='name']").fill(uniqueName);
  await fillCreateFormRequiredFields(page, "INR", "Mumbai, India");

  // C5: type a raw budget value and trigger blur to fire the formatter.
  const budgetInput = page.locator("input[name='projectBudget']");
  await budgetInput.fill("1000000");
  // Press Tab to move focus away — this fires the onBlur handler.
  await budgetInput.press("Tab");

  // The input value should now be formatted (INR lakh grouping = "10,00,000").
  const displayedValue = await budgetInput.inputValue();
  expect(displayedValue).toBe("10,00,000");

  // Submit the form — the server action must strip commas before saving.
  await page.locator("button[type='submit']").first().click();

  // createInquiry redirects to /acme-glass/inquiries on success.
  await page.waitForURL(/\/acme-glass\/inquiries(?!\/new)/, { timeout: 30_000 });
  expect(page.url()).not.toMatch(/\/new$/);

  // Fetch the inquiry list to find the one we just created.
  const listRes = await page.request.get(
    "/api/v1/orgs/acme-glass/inquiries?page=1&pageSize=50&scope=all",
  );
  expect(listRes.ok()).toBe(true);
  const listBody = (await listRes.json()) as {
    inquiries: { id: string; name: string }[];
  };
  const found = listBody.inquiries.find((i) => i.name === uniqueName);
  expect(found, `Inquiry "${uniqueName}" not found in list`).toBeTruthy();
  createdInquiryId = found!.id;

  // Fetch the full inquiry detail to verify the stored budget.
  const detailRes = await page.request.get(
    `/api/v1/orgs/acme-glass/inquiries/${createdInquiryId}`,
  );
  expect(detailRes.ok()).toBe(true);
  const detail = (await detailRes.json()) as {
    inquiry: { projectBudget: string | null };
  };

  // The critical check: stored value must be the clean numeric string "1000000",
  // NOT the formatted "10,00,000" that was visible in the input.
  expect(detail.inquiry.projectBudget).toBe("1000000");
});

// ---------------------------------------------------------------------------
// C5 — Inquiry edit: pre-formatted budget shown on open, updated value
// persisted correctly after another blur-format cycle.
// ---------------------------------------------------------------------------

test("C5 inquiry edit: budget pre-formatted on open, updated value persisted as clean numeric string", async ({
  page,
}) => {
  // Requires createdInquiryId from the create test above.
  expect(createdInquiryId, "C5 inquiry create must run first").toBeTruthy();

  await signIn(page, "admin");
  await page.goto(`/acme-glass/inquiries/${createdInquiryId}/edit`);
  await page.waitForURL(/\/edit$/, { timeout: 20_000 });

  // C5 edit form: initialProjectBudget ("1000000") should be pre-formatted to
  // "10,00,000" because the form initialises budgetValue via formatBudget().
  const budgetInput = page.locator("input[name='projectBudget']");
  const initialDisplayed = await budgetInput.inputValue();
  expect(initialDisplayed).toBe("10,00,000");

  // Change the budget value and trigger blur.
  await budgetInput.fill("2500000");
  await budgetInput.press("Tab");

  // After blur with INR, should format to "25,00,000".
  const afterBlurValue = await budgetInput.inputValue();
  expect(afterBlurValue).toBe("25,00,000");

  // Submit the edit.
  await page.locator("button[type='submit']").first().click();

  // updateInquiry redirects to /acme-glass/inquiries/{id}.
  await page.waitForURL(new RegExp(`/acme-glass/inquiries/${createdInquiryId}$`), {
    timeout: 30_000,
  });

  // Read back the persisted value via API.
  const detailRes = await page.request.get(
    `/api/v1/orgs/acme-glass/inquiries/${createdInquiryId}`,
  );
  expect(detailRes.ok()).toBe(true);
  const detail = (await detailRes.json()) as {
    inquiry: { projectBudget: string | null };
  };

  // Stored value must be "2500000", not "25,00,000".
  expect(detail.inquiry.projectBudget).toBe("2500000");
});

// ---------------------------------------------------------------------------
// C5 — Project create: same pattern as inquiry create but for projects.
// ---------------------------------------------------------------------------

test("C5 project create: budget persisted as clean numeric string after blur-format", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto("/acme-glass/projects/new");
  await page.waitForURL(/projects\/new/, { timeout: 20_000 });

  const uniqueName = `C5-proj-create-${Date.now()}`;

  await page.locator("input[name='name']").fill(uniqueName);
  await fillCreateFormRequiredFields(page, "USD", "New York, USA");

  const budgetInput = page.locator("input[name='projectBudget']");
  await budgetInput.fill("1500000");
  await budgetInput.press("Tab");

  // USD uses Western thousands grouping: "1,500,000".
  const displayedValue = await budgetInput.inputValue();
  expect(displayedValue).toBe("1,500,000");

  await page.locator("button[type='submit']").first().click();

  // createProject redirects to /acme-glass/projects/{id}.
  await page.waitForURL(/\/acme-glass\/projects\/[a-f0-9-]{36}$/, { timeout: 30_000 });

  // Extract the project ID from the URL.
  const projectUrl = page.url();
  const projectIdMatch = projectUrl.match(/\/projects\/([a-f0-9-]{36})$/);
  expect(projectIdMatch, "Expected redirect to project detail page").toBeTruthy();
  createdProjectId = projectIdMatch![1];

  // Read back via API.
  const detailRes = await page.request.get(
    `/api/v1/orgs/acme-glass/projects/${createdProjectId}`,
  );
  expect(detailRes.ok()).toBe(true);
  const detail = (await detailRes.json()) as {
    project: { projectBudget: string | null };
  };

  // Stored value must be "1500000", not "1,500,000".
  expect(detail.project.projectBudget).toBe("1500000");
});

// ---------------------------------------------------------------------------
// C5 — Project edit: same pattern as inquiry edit but for projects.
// ---------------------------------------------------------------------------

test("C5 project edit: budget pre-formatted on open, updated value persisted as clean numeric string", async ({
  page,
}) => {
  expect(createdProjectId, "C5 project create must run first").toBeTruthy();

  await signIn(page, "admin");
  await page.goto(`/acme-glass/projects/${createdProjectId}/edit`);
  await page.waitForURL(/\/edit$/, { timeout: 20_000 });

  // Project was created with USD and budget "1500000".
  // Edit form should pre-format to "1,500,000" (USD Western grouping).
  const budgetInput = page.locator("input[name='projectBudget']");
  const initialDisplayed = await budgetInput.inputValue();
  expect(initialDisplayed).toBe("1,500,000");

  // Change the budget and blur.
  await budgetInput.fill("3000000");
  await budgetInput.press("Tab");

  // USD: "3,000,000".
  const afterBlurValue = await budgetInput.inputValue();
  expect(afterBlurValue).toBe("3,000,000");

  // Submit.
  await page.locator("button[type='submit']").first().click();

  // updateProject redirects back to the project detail page.
  await page.waitForURL(new RegExp(`/acme-glass/projects/${createdProjectId}$`), {
    timeout: 30_000,
  });

  // Read back via API.
  const detailRes = await page.request.get(
    `/api/v1/orgs/acme-glass/projects/${createdProjectId}`,
  );
  expect(detailRes.ok()).toBe(true);
  const detail = (await detailRes.json()) as {
    project: { projectBudget: string | null };
  };

  // Stored value must be "3000000", not "3,000,000".
  expect(detail.project.projectBudget).toBe("3000000");
});
