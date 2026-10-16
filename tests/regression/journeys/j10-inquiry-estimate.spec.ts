/**
 * J10 — the Quick Estimate on inquiries (Stage 33 Batch 5, S33-19..S33-23, D-22..D-28), as the Test Org admin in
 * the browser, then a distributor. One flow: attach an estimate on the New Inquiry form -> Create -> the same
 * estimate on the detail card -> export -> edit -> remove -> dismiss -> read-only.
 *
 * Mutates only the Test Org: one inquiry created through the UI (found afterwards by its `rgr-` name via the API
 * and ledgered the moment its id is known) and one created through the API for the distributor's company
 * (ledgered). Neither the Catalog nor any shared setting is touched, so the guard-off (disabled) state is NOT
 * exercised here (rule 10); it is unit-tested logic only. Needs the Test Org's Partition (GLASS) to pass the Quick
 * Estimate guard, like J9. No literal item names are asserted (the suite's GLASS/DOOR rename windows).
 *
 * Numbers: 10 m² x INR 1000 = INR 10,000.00 (no discount or tax, both rows still shown at 0); edited to 20 m² ->
 * INR 20,000.00. createInquiry redirects to the LIST, so step 7 finds the row by name and opens its detail.
 */
import { randomBytes } from "node:crypto";
import { test, expect } from "../fixtures/test";
import { orgUrl } from "../../e2e/helpers";
import { createLedgered, distributorCompanyId } from "../api/project-helpers";
import { isHydrated } from "../pages/collect";
import { expectLands, orgPathOf } from "../pages/page-helpers";
import { T, getJson, withPage } from "./journey-helpers";
import type { Locator, Page } from "@playwright/test";

test.use({ trace: "off" });

type StoredEstimate = { currency: string; lines: Array<{ qty: number; unitPrice: number }> } | null;
type InquiryRead = { inquiry: { id: string; name: string; status: string; quickEstimate: StoredEstimate } };

const SLOW = { timeout: 20_000 };

/** Add a line from the popup's "Add item" button and pick the first option of the first group with `unit`. */
async function addLine(page: Page, addBtn: Locator, unit: "m²" | "pcs") {
  await addBtn.click();
  const picker = page.getByRole("dialog", { name: "Choose an item" });
  await expect(picker).toBeVisible();
  await picker.locator(`.qe-pk-gh:has(.qe-pk-gh-u:text-is("${unit}")) + .qe-pk-opt`).first().click();
  await expect(picker).toHaveCount(0);
}

async function choose(page: Page, trigger: Locator, option: string) {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(trigger).toHaveText(option);
}

test("J10: Quick Estimate on inquiries — attach on New Inquiry, Create, detail card, export, edit, remove, dismiss, distributor", async ({ browser, as, run, ledger }) => {
  test.setTimeout(420_000);
  const c = { as, run };
  const slug = run.testOrg.slug;
  const tag = randomBytes(2).toString("hex");
  const name = `${run.prefix}j10-${tag}`;
  const endClient = `RGR Client ${tag}`;
  const draftKey = `qe:v1:${slug}`;
  let inquiryId = "";

  const readDraft = (page: Page) => page.evaluate((k) => sessionStorage.getItem(k), draftKey);
  const draftLines = async (page: Page): Promise<number> => {
    const raw = await readDraft(page);
    return raw ? ((JSON.parse(raw) as { lines: unknown[] }).lines.length) : 0;
  };
  const stored = async () => (await getJson<InquiryRead>(as.admin, T(c, `/inquiries/${inquiryId}`))).inquiry.quickEstimate;

  await withPage(browser, run, "admin", async ({ page }) => {
    const section = page.getByTestId("qe-est-section");
    const dialog = page.getByRole("dialog", { name: "Quick Estimate" });
    const toast = page.getByTestId("qe-toast");

    // ── 1-4. New Inquiry: Add estimate -> popup in inquiry mode -> Attach -> folded cards + Estimate section ──
    await page.goto(orgUrl(slug, "/inquiries/new"));
    const addBtn = page.getByTestId("qe-add-estimate");
    await expect.poll(() => isHydrated(addBtn)).toBe(true);

    await test.step("'Add estimate' sits left of Cancel / Create Inquiry", async () => {
      await expect(addBtn).toHaveText("Add estimate");
      await expect(addBtn).not.toHaveAttribute("aria-disabled", "true"); // Test Org Catalog passes the guard
      const a = await addBtn.boundingBox();
      const cancel = await page.getByRole("link", { name: "Cancel" }).boundingBox();
      const create = await page.getByRole("button", { name: "Create Inquiry" }).boundingBox();
      expect(a && cancel && create && a.x < cancel.x && cancel.x < create.x).toBe(true);
    });

    await test.step("the popup opens in inquiry mode: no currency picker, the locked code, Attach disabled", async () => {
      await addBtn.click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("combobox")).toHaveCount(0);
      await expect(dialog.locator(".qe-cur-label")).toHaveText("INR");
      await expect(dialog.getByRole("button", { name: "Attach to inquiry" })).toBeDisabled();
    });

    await test.step("one priced line enables Attach; attaching closes the popup, folds the cards, shows the section", async () => {
      await addLine(page, dialog.getByRole("button", { name: "Add item" }), "m²");
      await page.locator("[data-qty]").first().fill("10");
      await dialog.getByLabel("Unit rate").first().fill("1000");
      const attach = dialog.getByRole("button", { name: "Attach to inquiry" });
      await expect(attach).toBeEnabled();
      await attach.click();
      await expect(dialog).toHaveCount(0);
      await expect(addBtn).toBeFocused(); // focus returns to the trigger
      await expect(addBtn).toHaveText("Edit estimate");
      await expect(section).toBeVisible();
      await expect(page.locator('[data-folded="true"]')).toHaveCount(3);
      // folded content is inert: Tab can't reach a field inside
      expect(await page.locator("#name").evaluate((el) => !!el.closest("[inert]"))).toBe(true);
      await expect(page.getByTestId("qe-toast")).toHaveText(/Estimate attached to this inquiry/);
    });

    await test.step("the section shows the line, Discount and Tax at 0, the code on the total", async () => {
      await expect(section.getByText("Quick estimate · 1 item · INR")).toBeVisible();
      const table = section.getByTestId("qe-est-table");
      await expect(table).toContainText("10 m²");
      await expect(table).toContainText("1,000.00");
      await expect(table).toContainText("INR 10,000.00");
      const totals = section.getByTestId("qe-est-totals");
      await expect(totals.getByText("Subtotal", { exact: true })).toBeVisible();
      await expect(totals.getByText("Discount 0%", { exact: true })).toBeVisible();
      await expect(totals.getByText("- 0.00", { exact: true })).toBeVisible();
      await expect(totals.getByText("Tax 0%", { exact: true })).toBeVisible();
      await expect(totals.getByText("+ 0.00", { exact: true })).toBeVisible();
      await expect(totals.getByText("INR 10,000.00", { exact: true })).toBeVisible();
    });

    await test.step("5. changing the form Currency shows the amber chip; changing it back clears it", async () => {
      await page.getByRole("button", { name: /Expand section: Project Information/ }).click();
      const currency = page.locator('button[aria-controls="currency-listbox"]');
      await choose(page, currency, "AED");
      await expect(section.getByTestId("qe-est-drift")).toHaveText("Estimate in INR, inquiry in AED");
      await choose(page, currency, "INR");
      await expect(section.getByTestId("qe-est-drift")).toHaveCount(0);
    });

    await test.step("6. Remove clears the section and the draft lines, reopens the cards; Undo restores both", async () => {
      expect(await draftLines(page)).toBe(1); // attach wrote the estimate back to the draft (D-23)
      await section.getByRole("button", { name: "Remove estimate from inquiry" }).click();
      await expect(section).toHaveCount(0);
      await expect(page.locator('[data-folded="true"]')).toHaveCount(0);
      await expect(addBtn).toHaveText("Add estimate");
      await expect.poll(() => draftLines(page)).toBe(0);
      await expect(toast).toContainText("Estimate removed from this inquiry");
      await toast.getByRole("button", { name: "Undo" }).click();
      await expect(section).toBeVisible();
      await expect(section.getByTestId("qe-est-table")).toContainText("INR 10,000.00");
      await expect.poll(() => draftLines(page)).toBe(1);
      await expect(addBtn).toHaveText("Edit estimate");
    });

    await test.step("6b. Create with a drifted currency is refused (D-29): error shown, nothing saved, estimate and draft kept", async () => {
      await page.locator("#name").fill(name);
      await page.locator("#projectLocation").fill("RGR City");
      await page.locator("#mainContractorName").fill("RGR Main");
      const currency = page.locator('button[aria-controls="currency-listbox"]');
      await choose(page, currency, "AED");
      await expect(section.getByTestId("qe-est-drift")).toBeVisible();
      await page.getByRole("button", { name: "Create Inquiry" }).click();
      await expect(page.getByText(/must match the inquiry currency (AED)/)).toBeVisible(SLOW);
      expect(orgPathOf(run, page.url())).toBe("/inquiries/new");
      await expect(section).toBeVisible();
      expect(await draftLines(page)).toBe(1);
      const l = await getJson<{ inquiries: { id: string; name: string }[] }>(as.admin, T(c, `/inquiries?search=${encodeURIComponent(name)}`));
      expect(l.inquiries.find((x) => x.name === name), "nothing was created").toBeUndefined();
      // the Edit estimate -> Update -> Create route re-prices in AED (unit-tested); here return to INR and carry on
      await choose(page, currency, "INR");
      await expect(section.getByTestId("qe-est-drift")).toHaveCount(0);
    });

    // ── 7. Create Inquiry -> the LIST; find the row by name, ledger it, open its detail ───────────────────
    await test.step("7. Create Inquiry lands on the list; the draft lines are cleared only after the success", async () => {
      await page.locator("#name").fill(name);
      await page.locator("#projectLocation").fill("RGR City");
      await page.locator("#mainContractorName").fill("RGR Main");
      await page.locator("#endClientName").fill(endClient);
      const create = page.getByRole("button", { name: "Create Inquiry" });
      await expect.poll(() => isHydrated(create)).toBe(true);
      await create.click();
      await expectLands(() => orgPathOf(run, page.url()), "/inquiries", "after Create Inquiry");

      const l = await getJson<{ inquiries: { id: string; name: string }[] }>(as.admin, T(c, `/inquiries?search=${encodeURIComponent(name)}`));
      const row = l.inquiries.find((x) => x.name === name);
      expect(row, "the created inquiry is listed").toBeTruthy();
      inquiryId = row!.id;
      ledger.add({ kind: "inquiry", id: inquiryId, orgSlug: slug, label: name });

      const est = await stored();
      expect(est).toMatchObject({ currency: "INR" });
      expect(est?.lines).toHaveLength(1);
      expect(est?.lines[0]).toMatchObject({ qty: 10, unitPrice: 1000 });
      await expect.poll(() => draftLines(page)).toBe(0); // cleared after the success
    });

    // ── 8-12. Detail page ────────────────────────────────────────────────────────────────────────────────
    await page.goto(orgUrl(slug, `/inquiries/${inquiryId}`));
    await expect(section).toBeVisible();

    await test.step("8. the detail card shows the same line, an Updated line, Edit / Export / Remove (NEW)", async () => {
      await expect(section.getByTestId("qe-est-table")).toContainText("INR 10,000.00");
      await expect(section).toContainText(/Updated \d{2} \w{3} \d{4} by /);
      await expect(section.getByTestId("qe-est-edit")).toBeVisible();
      await expect(section.getByRole("button", { name: "Remove estimate from inquiry" })).toBeVisible();
    });

    await test.step("9. Export PDF: End client prefilled, project name on the sheet, blank rule when cleared, project-estimate-*.pdf", async () => {
      await section.getByRole("button", { name: "Export PDF" }).click();
      const preview = page.getByRole("dialog", { name: "Export PDF" });
      await expect(preview).toBeVisible();
      await expect(preview.getByLabel("Prepared for")).toHaveValue(endClient);
      await expect(preview.getByTestId("qe-s-for")).toHaveText(`Prepared for: ${endClient}`);
      await expect(preview.locator(".qe-sheet")).toContainText(name);
      await expect(preview.locator(".qe-sheet")).not.toContainText(run.users.admin.username);
      await preview.getByLabel("Prepared for").fill("");
      await expect(preview.getByTestId("qe-s-for")).toHaveText("Prepared for:");
      await preview.getByLabel("Prepared for").fill(endClient);
      const [download] = await Promise.all([page.waitForEvent("download"), preview.getByRole("button", { name: "Download" }).click()]);
      expect(download.suggestedFilename()).toMatch(/^project-estimate-\d{4}-\d{2}-\d{2}\.pdf$/);
      await preview.getByRole("button", { name: "Back to estimate" }).click();
      await expect(preview).toHaveCount(0);
    });

    await test.step("10. Edit: discard confirm on unsaved changes, then Update saves; the shared draft is untouched", async () => {
      const draftBefore = await readDraft(page);
      await section.getByTestId("qe-est-edit").click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("combobox")).toHaveCount(0);
      const qty = dialog.locator("[data-qty]").first();
      await expect(qty).toHaveValue("10");
      await expect(dialog.getByLabel("Unit rate").first()).toHaveValue("1000");
      await expect(dialog.getByRole("button", { name: "Update estimate" })).toBeEnabled();

      await qty.fill("11");
      await dialog.getByRole("button", { name: "Close" }).click();
      await expect(dialog.getByText("Discard changes?")).toBeVisible();
      await dialog.getByRole("button", { name: "Keep editing" }).click();
      await expect(qty).toHaveValue("11");
      await dialog.getByRole("button", { name: "Close" }).click();
      await dialog.getByRole("button", { name: "Discard" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(section.getByTestId("qe-est-table")).toContainText("INR 10,000.00"); // nothing was saved

      await section.getByTestId("qe-est-edit").click();
      await dialog.locator("[data-qty]").first().fill("20");
      await dialog.getByRole("button", { name: "Update estimate" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(section.getByTestId("qe-est-table")).toContainText("INR 20,000.00", SLOW);
      await expect.poll(async () => (await stored())?.lines[0]?.qty, SLOW).toBe(20);
      expect(await readDraft(page)).toBe(draftBefore);
    });

    await test.step("11. Remove clears the estimate through the server action; Undo re-saves it", async () => {
      await section.getByRole("button", { name: "Remove estimate from inquiry" }).click();
      await expect(section).toHaveCount(0, SLOW);
      await expect(page.getByTestId("qe-add-estimate")).toHaveText("Add estimate");
      await expect.poll(stored, SLOW).toBeNull();
      await expect(toast).toContainText("Estimate removed from this inquiry");
      await toast.getByRole("button", { name: "Undo" }).click();
      await expect(section.getByTestId("qe-est-table")).toContainText("INR 20,000.00", SLOW);
      await expect.poll(async () => (await stored())?.lines[0]?.qty, SLOW).toBe(20);
    });

    await test.step("12. Dismissed: the estimate is read-only, Export PDF only", async () => {
      const dismiss = page.getByRole("button", { name: "Dismiss" });
      await expect.poll(() => isHydrated(dismiss)).toBe(true);
      await dismiss.click();
      await expect(page.getByText("Dismissed", { exact: true })).toBeVisible(SLOW);
      await expect(section).toBeVisible();
      await expect(section.getByTestId("qe-est-table")).toContainText("INR 20,000.00");
      await expect(section.getByRole("button", { name: "Export PDF" })).toBeVisible();
      await expect(section.getByTestId("qe-est-edit")).toHaveCount(0);
      await expect(section.getByRole("button", { name: "Remove estimate from inquiry" })).toHaveCount(0);
      await expect(page.getByTestId("qe-add-estimate")).toHaveCount(0);
    });
  });

  // ── 13. distributor: a NEW inquiry of its own company shows the Add estimate button ─────────────────────
  await test.step("13. a distributor sees the Add estimate button on its own company's NEW inquiry", async () => {
    const companyId = await distributorCompanyId({ run, as });
    const dname = `${run.prefix}j10d-${tag}`;
    const { id, res } = await createLedgered(as.admin, { run, ledger }, "inquiry", {
      name: dname,
      currency: "INR",
      projectLocation: "RGR City",
      mainContractorName: "RGR Main",
      externalCompanyId: companyId,
    });
    expect(res.status(), await res.text()).toBe(201);
    await withPage(browser, run, "distributor", async ({ page }) => {
      await page.goto(orgUrl(slug, `/inquiries/${id}`));
      const add = page.getByTestId("qe-add-estimate");
      await expect(add).toHaveText("Add estimate");
      await expect(page.getByTestId("qe-est-section")).toHaveCount(0);
    });
  });
});
