/**
 * J9 — Quick Estimate (Stage 33, Batch 1). READ-ONLY: it creates and changes no data, in any org. The calculator
 * is browser-only (S33-14), so everything below is typed into the popup and asserted from the numbers typed; the
 * Test Org's Catalog is only read by the page itself. No literal item names are asserted (the suite's GLASS/DOOR
 * rename windows can change them mid-run); the first offered Partition (m²) and Door (pcs) options are used.
 *
 * Needs the Test Org's Partition (GLASS) to pass the Quick Estimate guard (S33-2). If it doesn't, the icon is
 * disabled and the first step fails with a clear message; this spec never touches the Catalog to make it pass.
 * The disabled state itself is proven by unit tests only (rule 10).
 *
 * Numbers (hand-computed): 42.5 m² x 3200 = 136000.00; 3 pcs x 28500 = 85500.00; subtotal 221500.00;
 * 5% discount = 11075.00; tax 18% of 210425.00 = 37876.50; total 248301.50. With a fixed 1000.00 discount instead:
 * tax 18% of 220500.00 = 39690.00; total 260190.00. Internal users have no company currency, so the default is INR
 * (en-IN grouping, currency code never a symbol).
 */
import { test, expect } from "../fixtures/test";
import { orgUrl } from "../../e2e/helpers";
import { isHydrated } from "../pages/collect";
import { withPage } from "./journey-helpers";
import type { Page } from "@playwright/test";

test.use({ trace: "off" });

const MINUS = "−";

async function openCalculator(page: Page, slug: string) {
  await page.goto(orgUrl(slug, "/dashboard"));
  const icon = page.getByRole("button", { name: "Quick Estimate" });
  await expect.poll(() => isHydrated(icon)).toBe(true);
  return icon;
}

/** Add a line from the "Add item" button and pick the first option of the first group with `unit`. */
async function addLine(page: Page, addBtn: ReturnType<Page["getByRole"]>, unit: "m²" | "pcs") {
  await addBtn.click();
  const picker = page.getByRole("dialog", { name: "Choose an item" });
  await expect(picker).toBeVisible();
  await picker.locator(`.qe-pk-gh:has(.qe-pk-gh-u:text-is("${unit}")) + .qe-pk-opt`).first().click();
  await expect(picker).toHaveCount(0);
}

test("J9: Quick Estimate — maths, % and fixed discount, draft kept on close, Clear all confirm, PDF download, external role", async ({ browser, run }) => {
  test.setTimeout(240_000);
  const slug = run.testOrg.slug;

  await withPage(browser, run, "admin", async ({ page }) => {
    const icon = await openCalculator(page, slug);
    const dialog = page.getByRole("dialog", { name: "Quick Estimate" });

    await test.step("the icon is enabled (Test Org Catalog passes the guard) and opens the popup with the empty state", async () => {
      await expect(icon, "Test Org Catalog does not pass the Quick Estimate guard").not.toHaveAttribute("aria-disabled", "true");
      await icon.click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("No items yet")).toBeVisible();
      await expect(dialog.getByRole("combobox")).toHaveText("INR");
    });

    await test.step("add a Partition (m²) and a Door (pcs) line, type quantities and prices", async () => {
      await addLine(page, dialog.getByRole("button", { name: "Add item" }), "m²");
      await expect(page.locator("[data-qty]").first()).toBeFocused(); // choosing an item moves focus to its quantity
      await page.locator("[data-qty]").first().fill("42.5");
      await dialog.getByLabel("Unit rate").first().fill("3200");

      await addLine(page, dialog.getByRole("button", { name: "Add item" }), "pcs");
      await page.locator("[data-qty]").nth(1).fill("3");
      await dialog.getByLabel("Unit rate").nth(1).fill("28500");

      await expect(dialog.locator(".qe-amt").nth(0)).toHaveText("1,36,000.00");
      await expect(dialog.locator(".qe-amt").nth(1)).toHaveText("85,500.00");
    });

    await test.step("5% discount and 18% tax -> subtotal, discount, tax and total", async () => {
      await dialog.getByLabel("Discount", { exact: true }).fill("5");
      await dialog.getByLabel("Tax", { exact: true }).fill("18");
      await expect(dialog.getByText("INR 2,21,500.00", { exact: true })).toBeVisible();
      await expect(dialog.getByText(`${MINUS} INR 11,075.00`, { exact: true })).toBeVisible();
      await expect(dialog.getByText("+ INR 37,876.50", { exact: true })).toBeVisible();
      await expect(dialog.getByText("INR 2,48,301.50", { exact: true })).toBeVisible();
    });

    await test.step("fixed-amount discount: the toggle resets the value, then 1000 -> tax is taken after it", async () => {
      await dialog.getByRole("button", { name: "Fixed amount" }).click();
      await expect(dialog.getByLabel("Discount", { exact: true })).toHaveValue("");
      await expect(dialog.getByText(`${MINUS} INR 0.00`, { exact: true })).toBeVisible(); // shown even at 0
      await dialog.getByLabel("Discount", { exact: true }).fill("1000");
      await expect(dialog.getByText(`${MINUS} INR 1,000.00`, { exact: true })).toBeVisible();
      await expect(dialog.getByText("+ INR 39,690.00", { exact: true })).toBeVisible();
      await expect(dialog.getByText("INR 2,60,190.00", { exact: true })).toBeVisible();
      await dialog.getByLabel("Discount", { exact: true }).fill("999999"); // above the subtotal: capped at it
      await expect(dialog.getByText(`${MINUS} INR 2,21,500.00`, { exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "Percentage" }).click();
      await dialog.getByLabel("Discount", { exact: true }).fill("5");
      await expect(dialog.getByText("INR 2,48,301.50", { exact: true })).toBeVisible();
    });

    await test.step("Esc closes the popup, focus returns to the icon, a draft dot shows; reopening keeps the lines", async () => {
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(icon).toBeFocused();
      await expect(page.getByTestId("qe-draft-dot")).toBeVisible();
      await icon.click();
      await expect(dialog.locator("[data-qty]").first()).toHaveValue("42.5");
      await expect(dialog.getByText("INR 2,48,301.50", { exact: true })).toBeVisible();
    });

    await test.step("Tab stays inside the popup", async () => {
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press("Tab");
        expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), `Tab #${i + 1} left the dialog`).toBe(true);
      }
    });

    await test.step("Clear all asks first (Keep editing aborts), then empties the lines and keeps the discount and tax", async () => {
      await dialog.getByRole("button", { name: "Clear all" }).click();
      await expect(dialog.getByText("Clear all items?")).toBeVisible();
      await dialog.getByRole("button", { name: "Keep editing" }).click();
      await expect(dialog.locator("[data-qty]")).toHaveCount(2);

      await dialog.getByRole("button", { name: "Clear all" }).click();
      await dialog.getByRole("alertdialog").getByRole("button", { name: "Clear all" }).click();
      await expect(dialog.getByText("No items yet")).toBeVisible();
      await expect(dialog.locator("[data-qty]")).toHaveCount(0);
    });

    await test.step("Add item from the empty state; the discount and tax were kept", async () => {
      await addLine(page, dialog.getByRole("button", { name: "Add item" }), "m²");
      await expect(dialog.getByLabel("Discount", { exact: true })).toHaveValue("5");
      await expect(dialog.getByLabel("Tax", { exact: true })).toHaveValue("18");
      await expect(dialog.getByRole("button", { name: "Export PDF" })).toBeDisabled(); // nothing priced yet
    });

    await test.step("a currency change flags the rate and shows the banner; Undo restores", async () => {
      await page.locator("[data-qty]").first().fill("10");
      await dialog.getByLabel("Unit rate").first().fill("100");
      await dialog.getByRole("combobox").click();
      await page.getByRole("option", { name: "USD" }).click();
      await expect(dialog.getByRole("status")).toContainText("Currency changed to USD. Rates are not converted.");
      await dialog.getByRole("button", { name: "Undo" }).click();
      await expect(dialog.getByRole("status")).toHaveCount(0);
      await expect(dialog.getByRole("combobox")).toHaveText("INR");
    });

    await test.step("Export PDF -> preview -> Download yields project-estimate-YYYY-MM-DD.pdf", async () => {
      await dialog.getByRole("button", { name: "Export PDF" }).click();
      const preview = page.getByRole("dialog", { name: "Export PDF" });
      await expect(preview).toBeVisible();
      await expect(preview.getByText("Indicative estimate only. Not a quotation. Final pricing is subject to a formal quotation.")).toBeVisible();
      await expect(preview.getByText("PROJECT ESTIMATE")).toBeVisible();
      await expect(preview.getByText("Discount 5%")).toBeVisible();
      await expect(preview.getByText("Tax 18%")).toBeVisible();
      await expect(preview.locator(".qe-sheet")).not.toContainText(run.users.admin.username); // no user identity on the sheet (D-15)
      await expect(preview.getByTestId("qe-s-for")).toHaveText("Prepared for:");
      await preview.getByLabel("Prepared for").fill("Regression Test");
      await expect(preview.getByTestId("qe-s-for")).toHaveText("Prepared for: Regression Test");
      const [download] = await Promise.all([page.waitForEvent("download"), preview.getByRole("button", { name: "Download" }).click()]);
      expect(download.suggestedFilename()).toMatch(/^project-estimate-\d{4}-\d{2}-\d{2}\.pdf$/);
    });
  });

  await withPage(browser, run, "distributor", async ({ page }) => {
    const icon = await openCalculator(page, slug);
    await test.step("an external role (distributor) can open it, defaulting to its company currency", async () => {
      await expect(icon).not.toHaveAttribute("aria-disabled", "true");
      await icon.click();
      const dialog = page.getByRole("dialog", { name: "Quick Estimate" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("combobox")).toHaveText(/^(INR|AED|USD)$/);
    });
  });
});
