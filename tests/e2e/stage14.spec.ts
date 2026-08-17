/**
 * Stage 14 — Extended Inquiry/Project Fields + UI Fixes regression spec.
 * Behavior-level only — no DOM/layout/copy/styling assertions.
 *
 * 1. next-intl clientMessages hydration (real browser console check)
 * 2. destinationCountry derived from company country, not from POST body
 * 3. GST conditional required-ness toggles with company country
 * 4. convertInquiryToProject propagates all 15 new fields
 * 5. Cross-org tenancy isolation via API
 * 6. Batch D: ConfirmDialog not window.confirm; breadcrumb step 1; pagination guard
 */

import { test, expect } from "@playwright/test";
import { signIn, orgUrl, orgUrlPattern, apiUrl } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

// Rate-limit pacing — better-auth caps sign-in to ~3 / 10 s per IP.
test.beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 7_000));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createExternalCompany(
  page: import("@playwright/test").Page,
  name: string,
  country: "INDIA" | "UAE",
): Promise<void> {
  await page.goto(orgUrl("acme-glass", "/admin/external-companies/new"));
  await page.waitForURL(/external-companies\/new/, { timeout: 20_000 });
  await page.locator("input[name='name']").fill(name);
  await page.locator("select[name='type']").selectOption("DISTRIBUTOR");
  await page.locator("select[name='country']").selectOption(country);
  await page.locator("select[name='defaultCurrency']").selectOption(
    country === "INDIA" ? "INR" : "AED",
  );
  await page.getByRole("button", { name: /create/i }).click();
  await page.waitForURL(orgUrlPattern("acme-glass", "/admin/external-companies$"), { timeout: 20_000 });
}

async function selectCompany(
  page: import("@playwright/test").Page,
  companyName: string,
): Promise<void> {
  const trigger = page.locator('button[aria-haspopup="listbox"]');
  await expect(trigger).toBeVisible({ timeout: 10_000 });
  await trigger.click();
  const option = page.locator('[role="option"]').filter({ hasText: companyName }).first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
}

async function fillInquiryRequiredFields(
  page: import("@playwright/test").Page,
  inquiryName: string,
  gstNumber?: string,
) {
  await page.locator("input[name='name']").fill(inquiryName);
  await page.locator("select[name='currency']").selectOption("INR");
  await page.locator("input[name='projectLocation']").fill("Test Location City");
  await page.locator("input[name='endClientName']").fill("End Client Test");
  await page.locator("input[name='endClientPhone']").fill("+91 99999 00000");
  await page.locator("input[name='endClientEmail']").fill("tc@example.com");
  await page.locator("input[name='endClientAddressLine1']").fill("123 Main Street");
  await page.locator("input[name='endClientAddressLine2']").fill("Floor 2");
  await page.locator("input[name='endClientCity']").fill("TestCity");
  await page.locator("input[name='endClientState']").fill("TestState");
  if (gstNumber) {
    await page.locator("input[name='endClientGstNumber']").fill(gstNumber);
  }
}

// ===========================================================================
// 1 — clientMessages hydration
// ===========================================================================

test("hydration: inquiry create form mounts without i18n errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

  await signIn(page, "admin");
  await page.goto(orgUrl("acme-glass", "/inquiries/new"));
  await page.waitForURL(/inquiries\/new/, { timeout: 20_000 });

  await expect(page.locator("input[name='name']")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("select[name='currency']")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("input[name='endClientGstNumber']")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('button[aria-haspopup="listbox"]')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(2_000);

  const intlErrors = errors.filter((e) => /intl|MISSING|translation|hydrat/i.test(e));
  expect(intlErrors, "i18n/hydration errors: " + intlErrors.join("; ")).toHaveLength(0);
});

test("hydration: project create form mounts without i18n errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

  await signIn(page, "admin");
  await page.goto(orgUrl("acme-glass", "/projects/new"));
  await page.waitForURL(/projects\/new/, { timeout: 20_000 });

  await expect(page.locator("input[name='name']")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("select[name='currency']")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("input[name='endClientGstNumber']")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('button[aria-haspopup="listbox"]')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(2_000);

  const intlErrors = errors.filter((e) => /intl|MISSING|translation|hydrat/i.test(e));
  expect(intlErrors, "i18n/hydration errors: " + intlErrors.join("; ")).toHaveLength(0);
});

test("hydration: admin/users page mounts delete-user-button without i18n errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

  await signIn(page, "admin");
  await page.goto(orgUrl("acme-glass", "/admin/users"));
  await page.waitForURL(/admin\/users$/, { timeout: 20_000 });

  const deleteBtn = page.locator('button[aria-label^="Delete user"]').first();
  await expect(deleteBtn).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(2_000);

  const intlErrors = errors.filter((e) => /intl|MISSING|translation|hydrat/i.test(e));
  expect(intlErrors, "i18n/hydration errors: " + intlErrors.join("; ")).toHaveLength(0);
});

// ===========================================================================
// 2 — destinationCountry derivation
// ===========================================================================
//
// NOTE (Stage 15 V3): The inquiry detail page no longer displays destinationCountry
// in the UI — it was removed because it is derived from the company (not user-entered)
// and showing it was misleading. Two tests that asserted "India"/"UAE" was visible on
// the inquiry detail page were removed here; the invariant is now captured by the API
// test below (client-supplied value is ignored) and by the project-detail assertion
// in the convertInquiryToProject test (project detail still shows destinationCountry).

test("destinationCountry: client-supplied value in POST body is ignored", async ({ page }) => {
  await signIn(page, "admin");

  const resp = await page.request.post(apiUrl("acme-glass", "/api/v1/orgs/acme-glass/inquiries"), {
    headers: { "Content-Type": "application/json" },
    data: {
      name: "S14-DestInject-" + Date.now(),
      currency: "INR",
      destinationCountry: "INJECTED_VALUE",
    },
  });

  expect(resp.status()).toBe(201);
  const body = await resp.json() as { inquiry: { destinationCountry: string } };
  expect(body.inquiry.destinationCountry).not.toBe("INJECTED_VALUE");
  expect(body.inquiry.destinationCountry).toBe("");
});

// ===========================================================================
// 3 — Conditional GST required-ness
// ===========================================================================

test("GST: India company makes endClientGstNumber required", async ({ page }) => {
  await signIn(page, "admin");
  const coName = "S14-India-GST-" + Date.now();
  await createExternalCompany(page, coName, "INDIA");

  await page.goto(orgUrl("acme-glass", "/inquiries/new"));
  await page.waitForURL(/inquiries\/new/, { timeout: 20_000 });

  const gstInput = page.locator("input[name='endClientGstNumber']");
  await expect(gstInput).toBeVisible({ timeout: 10_000 });
  await expect(gstInput).not.toHaveAttribute("required");

  await selectCompany(page, coName);

  await expect(gstInput).toHaveAttribute("required");
});

test("GST: UAE company keeps endClientGstNumber optional", async ({ page }) => {
  await signIn(page, "admin");
  const coName = "S14-UAE-GST-" + Date.now();
  await createExternalCompany(page, coName, "UAE");

  await page.goto(orgUrl("acme-glass", "/inquiries/new"));
  await page.waitForURL(/inquiries\/new/, { timeout: 20_000 });
  await selectCompany(page, coName);

  const gstInput = page.locator("input[name='endClientGstNumber']");
  await expect(gstInput).toBeVisible({ timeout: 5_000 });
  await expect(gstInput).not.toHaveAttribute("required");
});

test("GST: no company keeps endClientGstNumber optional", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto(orgUrl("acme-glass", "/inquiries/new"));
  await page.waitForURL(/inquiries\/new/, { timeout: 20_000 });

  const gstInput = page.locator("input[name='endClientGstNumber']");
  await expect(gstInput).toBeVisible({ timeout: 10_000 });
  await expect(gstInput).not.toHaveAttribute("required");
});

// ===========================================================================
// 4 — convertInquiryToProject: all 15 new fields propagated
// ===========================================================================
//
// NOTE (Stage 15 C9): Sentinel values updated to pass the new HTML5 pattern
// restrictions on name/city/state fields (pattern="[A-Za-z0-9 \-]*" — no
// underscores) and the budget field (pattern="[\d,\.]*" — numeric only).
// All sentinel values remain unique and verifiable on the project detail page.

test("convertInquiryToProject: all 15 sentinel fields appear on resulting project", async ({ page }) => {
  await signIn(page, "admin");
  const coName = "S14-Conv-Co-" + Date.now();
  await createExternalCompany(page, coName, "INDIA");

  await page.goto(orgUrl("acme-glass", "/inquiries/new"));
  await page.waitForURL(/inquiries\/new/, { timeout: 20_000 });
  await selectCompany(page, coName);

  const inqName = "S14-ConvInq-" + Date.now();
  await page.locator("input[name='name']").fill(inqName);
  await page.locator("select[name='currency']").selectOption("INR");
  // projectLocation has no pattern restriction — underscores OK
  await page.locator("input[name='projectLocation']").fill("CONV_LOCATION_SENTINEL");
  // Budget must be numeric (C9 pattern="[\d,\.]*")
  await page.locator("input[name='projectBudget']").fill("9988776655");
  await page.locator("input[name='submissionDate']").fill("2026-03-15");
  await page.locator("input[name='projectDeadline']").fill("2026-12-31");
  // Name fields use pattern="[A-Za-z0-9 \-]*" — no underscores; use hyphens
  await page.locator("input[name='mainContractorName']").fill("MAIN-CONTRACTOR-SENT");
  await page.locator("input[name='interiorContractorName']").fill("INT-CONTRACTOR-SENT");
  await page.locator("input[name='mainConsultantName']").fill("MAIN-CONSULTANT-SENT");
  await page.locator("input[name='interiorConsultantName']").fill("INT-CONSULTANT-SENT");
  await page.locator("input[name='endClientName']").fill("ENDCLIENT-NAME-SENT");
  await page.locator("input[name='endClientPhone']").fill("+91 11111 22222");
  await page.locator("input[name='endClientEmail']").fill("sentinel@conv.example.com");
  // GST, address fields have no pattern restriction — any text OK
  await page.locator("input[name='endClientGstNumber']").fill("GST_SENTINEL_CONV");
  await page.locator("input[name='endClientAddressLine1']").fill("ADDR1_SENTINEL");
  await page.locator("input[name='endClientAddressLine2']").fill("ADDR2_SENTINEL");
  // City and state use pattern="[A-Za-z0-9 \-]*" — no underscores
  await page.locator("input[name='endClientCity']").fill("Conv City");
  await page.locator("input[name='endClientState']").fill("Conv State");

  await page.getByRole("button", { name: "Create Inquiry" }).click();
  await page.waitForURL(orgUrlPattern("acme-glass", "/inquiries$"), { timeout: 30_000 });

  const link = page.locator("tr").filter({ hasText: inqName }).locator("a").first();
  await expect(link).toBeVisible({ timeout: 10_000 });
  await link.click();
  await page.waitForURL(orgUrlPattern("acme-glass", "/inquiries/.+"), { timeout: 20_000 });

  await page.getByRole("button", { name: "Start Project" }).click();
  await page.waitForURL(orgUrlPattern("acme-glass", "/projects/.+"), { timeout: 30_000 });

  await expect(page.getByText("CONV_LOCATION_SENTINEL")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("9988776655")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("MAIN-CONTRACTOR-SENT")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("INT-CONTRACTOR-SENT")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("MAIN-CONSULTANT-SENT")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("INT-CONSULTANT-SENT")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("ENDCLIENT-NAME-SENT")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("+91 11111 22222")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("sentinel@conv.example.com")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("GST_SENTINEL_CONV")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("ADDR1_SENTINEL")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("ADDR2_SENTINEL")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("Conv City")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("Conv State")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("India", { exact: true }).first()).toBeVisible({ timeout: 5_000 });
});

// ===========================================================================
// 5 — Cross-org tenancy isolation
// ===========================================================================

test("tenancy: vistra session cannot list acme-glass inquiries", async ({ page }) => {
  await signIn(page, "admin", "Seed1234!", "vistra");
  const resp = await page.request.get(apiUrl("acme-glass", "/api/v1/orgs/acme-glass/inquiries"));
  expect([401, 403]).toContain(resp.status());
});

test("tenancy: vistra session cannot list acme-glass projects", async ({ page }) => {
  await signIn(page, "admin", "Seed1234!", "vistra");
  const resp = await page.request.get(apiUrl("acme-glass", "/api/v1/orgs/acme-glass/projects"));
  expect([401, 403]).toContain(resp.status());
});

// ===========================================================================
// 6 — Batch D UI fixes
// ===========================================================================

test("Batch D: delete-user click shows ConfirmDialog not window.confirm", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto(orgUrl("acme-glass", "/admin/users"));
  await page.waitForURL(/admin\/users$/, { timeout: 20_000 });

  let nativeDialogFired = false;
  page.on("dialog", async (dlg) => { nativeDialogFired = true; await dlg.dismiss(); });

  const deleteBtn = page.locator('button[aria-label^="Delete user"]').first();
  await expect(deleteBtn).toBeVisible({ timeout: 10_000 });
  await deleteBtn.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  expect(nativeDialogFired).toBe(false);

  await dialog.getByRole("button", { name: /cancel/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
});

test("Batch D: wizard breadcrumb step 1 active on /edit route", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto(orgUrl("acme-glass", "/projects"));
  await page.waitForURL(orgUrlPattern("acme-glass", "/projects$"), { timeout: 20_000 });

  const rows = page.locator("tbody tr");
  const count = await rows.count();
  if (count === 0) {
    test.info().annotations.push({ type: "note", description: "No projects available." });
    return;
  }

  await rows.first().locator("a").first().click();
  await page.waitForURL(orgUrlPattern("acme-glass", "/projects/.+"), { timeout: 20_000 });

  const projectUrl = page.url();
  await page.goto(projectUrl.replace(/\/$/, "") + "/edit");
  await page.waitForURL(/\/edit$/, { timeout: 20_000 });

  const activeSteps = page.locator("[aria-current='step']");
  await expect(activeSteps).toHaveCount(1, { timeout: 10_000 });

  const href = await activeSteps.getAttribute("href");
  expect(href ?? "").not.toMatch(/\/(configuration|design|summary|quotation)/);
});

test("Batch D: pagination absent when list fits on one page", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto(orgUrl("acme-glass", "/inquiries"));
  await page.waitForURL(orgUrlPattern("acme-glass", "/inquiries$"), { timeout: 20_000 });

  const resp = await page.request.get(apiUrl("acme-glass", "/api/v1/orgs/acme-glass/inquiries?pageSize=1"));
  if (!resp.ok()) return;

  const data = await resp.json() as { total: number };
  const total = data.total ?? 0;
  await page.waitForTimeout(2_000);

  if (total <= 20) {
    await expect(page.getByRole("button", { name: /previous page/i })).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: /next page/i })).not.toBeVisible({ timeout: 5_000 });
  }
});
