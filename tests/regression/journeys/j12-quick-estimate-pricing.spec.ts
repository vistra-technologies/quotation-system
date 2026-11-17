/**
 * J12 — Quick Estimate with Product Pricing (Stage 36 Batch 4, S36-9..S36-14, UI AC2, AC3, AC5; Fix batch F1: M-1
 * same-session refresh after a drawer save, UI AC4 for a user without MANAGE_PRICING, S36-19).
 *
 * The Test Org has no product-spec flags and no prices, and rule 10 forbids editing its shared catalog, so the priced
 * walk runs in this run's throwaway org B: the starter GLASS type there is flagged `productSpec` (SuperAdmin PATCH),
 * three combinations get prices through the org admin's PUT, and the popup is driven as org B's admin. Everything
 * created goes with org B at teardown (pricing rows, the one inquiry, and the distributor user + company of UI AC4
 * cascade). The Test Org is never touched. UI AC4 (S36-19): a distributor in org B has no MANAGE_PRICING yet reads the
 * rate card through the session-only `.../product-pricing/lookup`, so the rate auto-fills (no toast, no console
 * error). (A 500 or network failure of that read is a server-side fetch, so a browser route cannot fail it: covered
 * by the layout's catch, not by this spec.)
 *
 * Prices: combination 0 = INR/m2 2800 + USD/m2 40 + a description; combination 1 = INR/sqft 260 only (the other area
 * unit, which must NOT match and is never converted); combination 2 = nothing.
 */
import { randomBytes } from "node:crypto";
import { test, expect, SA } from "../api/sa-helpers";
import { ok } from "../api/design-helpers";
import { orgApi } from "../api/project-helpers";
import { combinationKey } from "@/lib/product-pricing/combination";
import { buildCombinations, usableEstimateTypes, type ComponentTypeInput } from "@/lib/quick-estimate/palette";
import { apiSignIn, orgUrl } from "../../e2e/helpers";
import { RUN_PASSWORD_ENV } from "../env";
import { isHydrated } from "../pages/collect";
import { withPage } from "./journey-helpers";
import type { Locator, Page } from "@playwright/test";

test.use({ trace: "off", actionTimeout: 15_000 });

const SPEC_KEYS = ["category", "glassType", "thickness"];
const DESC = "Acoustic standard, 12 mm laminated.";

async function openCalculator(page: Page, slug: string) {
  await page.goto(orgUrl(slug, "/dashboard"));
  const icon = page.getByRole("button", { name: "Quick Estimate" });
  await expect.poll(() => isHydrated(icon)).toBe(true);
  return icon;
}

/** Add a line and pick the combination whose text is exactly `text`. */
async function addLineWith(page: Page, dialog: Locator, text: string) {
  await dialog.getByRole("button", { name: "Add item" }).click();
  const picker = page.getByRole("dialog", { name: "Choose an item" });
  await expect(picker).toBeVisible();
  await picker.getByRole("combobox", { name: "Search" }).fill(text);
  await picker.getByRole("option", { name: text, exact: true }).click();
  await expect(picker).toHaveCount(0);
}

test("J12: Quick Estimate product pricing: auto-populate, Reset, description, currency re-lookup, inquiry card; same-session refresh after a drawer save; a user without MANAGE_PRICING gets the rates", async ({ browser, run, sa, orgB }) => {
  test.setTimeout(420_000);
  const B = (p: string) => orgApi(run.orgB.slug, p);
  const tag = randomBytes(2).toString("hex");

  // ── Fixture: flag org B's starter GLASS, price three combinations ──
  type CT = ComponentTypeInput & { fieldsSchema: ComponentTypeInput["fieldsSchema"] };
  const list = await ok<{ componentTypes: CT[] }>(await orgB.get(B("/component-types")));
  const glass = list.componentTypes.find((t) => t.code === "GLASS");
  expect(glass, "org B has a starter GLASS type").toBeTruthy();
  const flagged = glass!.fieldsSchema.map((f) => (SPEC_KEYS.includes(f.key) ? { ...f, productSpec: true } : f));
  await ok(await sa.patch(`${SA}/component-types/${glass!.id}`, { data: { orgId: run.orgB.id, fieldsSchema: flagged } }));
  const specType = usableEstimateTypes([{ ...glass!, fieldsSchema: flagged }]).types.find((t) => t.code === "GLASS");
  expect(specType?.mode, "GLASS is usable in spec mode in org B").toBe("spec");
  const combos = buildCombinations(specType!);
  // The picker offers every usable type (org B also has a fallback-mode DOOR): the expected total is GLASS's spec combinations plus the rest.
  const allUsable = usableEstimateTypes(list.componentTypes.map((t) => (t.id === glass!.id ? { ...t, fieldsSchema: flagged } : t))).types;
  const pickerTotal = allUsable.reduce((n, t) => n + buildCombinations(t).length, 0);
  expect(combos.length).toBeGreaterThanOrEqual(3);
  const [c0, c1, c2] = combos;
  const put = async (c: (typeof combos)[number], prices: unknown[], description?: string) =>
    ok(await orgB.put(B("/product-pricing"), { data: { componentTypeId: glass!.id, combinationKey: combinationKey(c.values), combinationLabel: c.text, prices, description } }));
  await put(c0, [{ currency: "INR", unit: "m2", amount: 2800 }, { currency: "USD", unit: "m2", amount: 40 }], DESC);
  await put(c1, [{ currency: "INR", unit: "sqft", amount: 260 }]);

  const draftKey = `qe:v1:${run.orgB.slug}`;

  await withPage(browser, run, "orgB-admin", async (o) => {
    const page = o.page;
    const icon = await openCalculator(page, run.orgB.slug);
    await icon.click();
    const dialog = page.getByRole("dialog", { name: "Quick Estimate" });
    await expect(dialog).toBeVisible();
    const lines = dialog.locator(".qe-lw");
    const rate = (i: number) => lines.nth(i).getByLabel("Unit rate");
    const reset = (i: number) => lines.nth(i).locator("[data-reset]");
    const attach = (i: number) => lines.nth(i).getByRole("checkbox", { name: "Attach description" });
    const desc = (i: number) => lines.nth(i).getByRole("textbox", { name: "Description" });

    await test.step("the picker lists the spec combinations; a priced variant fills the rate, no Reset, no badge", async () => {
      await dialog.getByRole("button", { name: "Add item" }).click();
      const picker = page.getByRole("dialog", { name: "Choose an item" });
      await expect(picker.getByRole("option")).toHaveCount(pickerTotal);
      await picker.getByRole("combobox", { name: "Search" }).fill(c0.text);
      await picker.getByRole("option", { name: c0.text, exact: true }).click();
      await expect(rate(0)).toHaveValue("2800");
      await expect(reset(0)).toHaveCount(0);
      await expect(dialog).not.toContainText(/suggested|overridden/i);
    });

    await test.step("Attach description defaults checked with the admin text; an edit sets the edited flag; unchecking hides it", async () => {
      await expect(attach(0)).toBeChecked();
      await expect(desc(0)).toHaveValue(DESC);
      await desc(0).fill(`${DESC} Rev B.`);
      const stored = JSON.parse((await page.evaluate((k) => sessionStorage.getItem(k), draftKey))!) as { lines: Array<Record<string, unknown>> };
      expect(stored.lines[0]).toMatchObject({ descriptionEdited: true, attachDescription: true, description: `${DESC} Rev B.`, suggestedUnitPrice: 2800, suggestedUnit: "m2", combinationKey: combinationKey(c0.values) });
      await attach(0).uncheck();
      await expect(desc(0)).toHaveCount(0);
      await attach(0).check();
      await expect(desc(0)).toHaveValue(`${DESC} Rev B.`);
    });

    await test.step("editing the rate shows the inline Reset; Reset restores the suggestion", async () => {
      await rate(0).fill("3100");
      await expect(reset(0)).toBeVisible();
      await expect(reset(0)).toHaveAttribute("aria-label", "Reset to suggested rate");
      await reset(0).click();
      await expect(rate(0)).toHaveValue("2800");
      await expect(reset(0)).toHaveCount(0);
    });

    await test.step("a variant priced only in the other area unit, and an unpriced one: rate empty, no Reset, description unchecked", async () => {
      await addLineWith(page, dialog, c1.text);
      await expect(rate(1)).toHaveValue("");
      await expect(reset(1)).toHaveCount(0);
      await expect(attach(1)).not.toBeChecked();
      await expect(desc(1)).toHaveCount(0);
      await addLineWith(page, dialog, c2.text);
      await expect(rate(2)).toHaveValue("");
      await expect(reset(2)).toHaveCount(0);
      // a manually typed rate on an unpriced variant never shows Reset
      await rate(2).fill("123");
      await expect(reset(2)).toHaveCount(0);
      await rate(2).fill("");
    });

    await test.step("currency switch re-looks up by key: USD finds 40, AED finds nothing and flags; Undo restores", async () => {
      await dialog.getByRole("combobox").click();
      await page.getByRole("option", { name: "USD" }).click();
      await expect(rate(0)).toHaveValue("40");
      await expect(rate(1)).toHaveValue("");
      await expect(dialog.getByRole("status")).toHaveCount(0); // line 0 found a price, nothing was left needing a re-check
      await dialog.getByRole("combobox").click();
      await page.getByRole("option", { name: "AED" }).click();
      await expect(rate(0)).toHaveValue("");
      await expect(dialog.getByRole("status")).toContainText("Currency changed to AED");
      await dialog.getByRole("button", { name: "Undo" }).click();
      await expect(dialog.getByRole("combobox")).toHaveText("USD");
      await expect(rate(0)).toHaveValue("40");
      await dialog.getByRole("combobox").click();
      await page.getByRole("option", { name: "INR" }).click();
      await expect(rate(0)).toHaveValue("2800");
    });

    await test.step("the PDF preview prints the description only while it is attached", async () => {
      await page.locator("[data-qty]").first().fill("2");
      await dialog.getByRole("button", { name: "Export PDF" }).click();
      const preview = page.getByRole("dialog", { name: "Export PDF" });
      await expect(preview).toBeVisible();
      await expect(preview.locator(".qe-sheet")).toContainText(`${DESC} Rev B.`);
      await page.keyboard.press("Escape");
      await expect(preview).toHaveCount(0);
      await attach(0).uncheck();
      await dialog.getByRole("button", { name: "Export PDF" }).click();
      await expect(page.getByRole("dialog", { name: "Export PDF" }).locator(".qe-sheet")).not.toContainText("Rev B.");
      await page.keyboard.press("Escape");
    });

    await test.step("a reload keeps the new line keys (the draft reads back with them)", async () => {
      await attach(0).check();
      await page.keyboard.press("Escape");
      await page.reload();
      const icon2 = page.getByRole("button", { name: "Quick Estimate" });
      await expect.poll(() => isHydrated(icon2)).toBe(true);
      await icon2.click();
      await expect(rate(0)).toHaveValue("2800");
      await expect(attach(0)).toBeChecked();
      await expect(desc(0)).toHaveValue(`${DESC} Rev B.`);
    });

    // ── Batch 5: the m² / sq ft toggle (S36-13, S36-18, UI AC2, AC2b, UI AC4) ──
    const qty = (i: number) => lines.nth(i).locator("[data-qty]");
    const unitSuffix = (i: number) => lines.nth(i).locator(".qe-unit");
    const toggle = (u: "m²" | "sq ft") => dialog.locator(`[data-area-unit="${u}"]`);
    const toast = page.getByTestId("qe-toast");
    // Review screenshots only (QE_SHOTS_DIR set by hand); a normal regression run never writes a file.
    const shoot = async (name: string) => {
      const dir = process.env.QE_SHOTS_DIR;
      if (!dir) return;
      for (const [w, h] of [[1280, 800], [1536, 864], [1920, 1080]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(250);
        await page.screenshot({ path: `${dir}/${w}x${h}-${name}.png` });
      }
    };

    await test.step("setup: a DOOR line (pcs), quantities, and a typed rate on the unpriced m2 variant", async () => {
      await dialog.getByRole("button", { name: "Add item" }).click();
      const picker = page.getByRole("dialog", { name: "Choose an item" });
      await picker.locator('.qe-pk-gh:has(.qe-pk-gh-u:text-is("pcs")) + .qe-pk-opt').first().click();
      await expect(picker).toHaveCount(0);
      await qty(3).fill("3");
      await rate(3).fill("1500");
      await qty(1).fill("10");
      await rate(1).fill("99"); // c1 has no INR/m2 price: a typed rate with no suggestion
      await expect(qty(0)).toHaveValue("2");
      await expect(toggle("m²")).toHaveAttribute("aria-pressed", "true");
      await expect(toggle("sq ft")).toHaveAttribute("aria-pressed", "false");
      await shoot("1-m2");
    });

    await test.step("UI AC2 + AC2b: sq ft converts qty, resets rates (no conversion), pcs untouched, one toast, no note", async () => {
      await toggle("sq ft").click();
      await expect(toggle("sq ft")).toHaveAttribute("aria-pressed", "true");
      await expect(qty(0)).toHaveValue("21.53"); // 2 x 10.7639
      await expect(qty(1)).toHaveValue("107.64"); // 10 x 10.7639
      await expect(unitSuffix(0).last()).toHaveText("/sq ft");
      await expect(rate(0)).toHaveValue(""); // c0 has INR/m2 only: empty, never 2800 / 10.7639
      await expect(rate(1)).toHaveValue("260"); // c1 has an exact INR/sq ft price; the typed 99 was replaced
      await expect(rate(2)).toHaveValue("");
      await expect(dialog.locator("[data-reset]")).toHaveCount(0);
      // DOOR line: still pcs, quantity and rate untouched
      await expect(qty(3)).toHaveValue("3");
      await expect(rate(3)).toHaveValue("1500");
      await expect(unitSuffix(3).last()).toHaveText("/pcs");
      // the typed 99 was replaced, so the toast shows once; it is transient and no permanent note remains
      await expect(toast).toHaveText("Price reset to default");
      await shoot("3-sqft-toast");
      await expect(toast).toHaveCount(0, { timeout: 8_000 });
      await shoot("2-sqft");
      await expect(dialog).not.toContainText(/converted|price reset/i);
      const stored = JSON.parse((await page.evaluate((k) => sessionStorage.getItem(k), draftKey))!) as { areaUnit: string; lines: Array<Record<string, unknown>> };
      expect(stored.areaUnit).toBe("sq ft");
      expect(stored.lines[1]).toMatchObject({ suggestedUnitPrice: 260, suggestedUnit: "sqft" });
      expect(stored.lines[0]).toMatchObject({ suggestedUnitPrice: null, suggestedUnit: null });
    });

    await test.step("UI AC4: the PDF preview prints sq ft for the sq ft lines", async () => {
      await dialog.getByRole("button", { name: "Export PDF" }).click();
      const sheet = page.getByRole("dialog", { name: "Export PDF" }).locator(".qe-sheet");
      await expect(sheet).toContainText("sq ft");
      await expect(sheet).toContainText("107.64");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Export PDF" })).toHaveCount(0);
    });

    await test.step("switching back: m2 price returns for the priced variant, qty returns within rounding, no toast when nothing was typed", async () => {
      await toggle("m²").click();
      await expect(qty(0)).toHaveValue("2");
      await expect(qty(1)).toHaveValue("10");
      await expect(rate(0)).toHaveValue("2800");
      await expect(rate(1)).toHaveValue(""); // c1 has no INR/m2 entry
      await expect(unitSuffix(0).last()).toHaveText("/m²");
      await expect(dialog.locator("[data-reset]")).toHaveCount(0);
      // line 1 sat at its sq ft default and line 0 was empty: nothing typed was replaced
      await expect(toast).toHaveCount(0);
    });

    await test.step("an overridden rate triggers the toast again; five toggles do not drift the quantity", async () => {
      await rate(0).fill("3100");
      await expect(reset(0)).toBeVisible();
      await toggle("sq ft").click();
      await expect(toast).toHaveText("Price reset to default");
      await expect(rate(0)).toHaveValue("");
      await expect(toast).toHaveCount(0, { timeout: 8_000 });
      for (const u of ["m²", "sq ft", "m²", "sq ft"] as const) await toggle(u).click();
      await expect(toast).toHaveCount(0); // every rate was at its default or empty on those switches
      await expect(qty(0)).toHaveValue("21.53");
      await toggle("m²").click();
      await expect(qty(0)).toHaveValue("2");
      await expect(qty(1)).toHaveValue("10");
    });
  });

  // ── The inquiry estimate card, old and new lines (UI AC5) ──
  await test.step("an inquiry estimate renders a Stage 36 line with its description, an unattached one without, and a Stage 33 line", async () => {
    const line = (over: Record<string, unknown>) => ({ itemName: "Partition", variantText: "x", unit: "m²", qty: 1, unitPrice: 100, ...over });
    const created = await ok<{ inquiry: { id: string } }>(
      await orgB.post(B("/inquiries"), {
        data: {
          name: `${run.prefix}j12-${tag}`,
          currency: "INR",
          quickEstimate: {
            lines: [
              line({ variantText: "attached", description: "Printed note", attachDescription: true, descriptionEdited: false, suggestedUnitPrice: 100, suggestedUnit: "m2", combinationKey: "{\"a\":\"b\"}" }),
              line({ variantText: "unattached", description: "Hidden note", attachDescription: false }),
              line({ variantText: "legacy" }),
            ],
          },
        },
      }),
      201,
    );
    await withPage(browser, run, "orgB-admin", async (o) => {
      await o.page.goto(orgUrl(run.orgB.slug, `/inquiries/${created.inquiry.id}`));
      const table = o.page.getByTestId("qe-est-table");
      await expect(table).toBeVisible();
      await expect(table).toContainText("attached");
      await expect(table).toContainText("legacy");
      await expect(table).toContainText("Printed note");
      await expect(table).not.toContainText("Hidden note");
      await o.page.getByRole("button", { name: "Export PDF" }).first().click();
      const preview = o.page.getByRole("dialog", { name: "Export PDF" });
      await expect(preview.locator(".qe-sheet")).toContainText("Printed note");
      await expect(preview.locator(".qe-sheet")).not.toContainText("Hidden note");
    });
  });

  // ── M-1: a price saved through the drawer reaches Quick Estimate in the SAME page session (no reload) ──
  await withPage(browser, run, "orgB-admin", async (o) => {
    const page = o.page;
    await page.goto(orgUrl(run.orgB.slug, "/admin/product-pricing"));
    const tab = page.getByTestId("type-tab-GLASS");
    await expect.poll(() => isHydrated(tab)).toBe(true);
    await tab.click();
    // c2 is unpriced (see the header): price it through the drawer UI, INR/m2 default pair
    await page.getByTestId("pricing-row").filter({ hasText: c2.text }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("button", { name: "Add price" }).click();
    await dlg.getByRole("textbox", { name: "Amount" }).fill("777");
    await dlg.getByRole("button", { name: "Add", exact: true }).click();
    await dlg.getByRole("tab", { name: "Description" }).click();
    await dlg.getByLabel("Description").fill("Saved in the drawer");
    // router.refresh() issues an RSC GET for the current page: wait for it so the layout's new lookup has landed
    const refreshed = page.waitForResponse((r) => r.request().method() === "GET" && r.url().includes("_rsc="));
    await dlg.getByRole("button", { name: "Save changes" }).click();
    await expect(dlg).toHaveCount(0);
    await refreshed;
    // no goto / reload from here on: the layout's lookup must have been refreshed by the save
    await page.getByRole("button", { name: "Quick Estimate" }).click();
    const qe = page.getByRole("dialog", { name: "Quick Estimate" });
    await expect(qe).toBeVisible();
    await addLineWith(page, qe, c2.text);
    const line = qe.locator(".qe-lw").first();
    await expect(line.getByLabel("Unit rate")).toHaveValue("777", { timeout: 20_000 });
    await expect(line.getByRole("checkbox", { name: "Attach description" })).toBeChecked();
    await expect(line.getByRole("textbox", { name: "Description" })).toHaveValue("Saved in the drawer");
  });

  // ── UI AC4 (S36-19): a user WITHOUT MANAGE_PRICING sees the rate auto-filled; no toast, no console error ──
  {
    const password = process.env[RUN_PASSWORD_ENV];
    if (!password) throw new Error(`${RUN_PASSWORD_ENV} is not set`);
    const roles = (await ok<{ roles: { id: string; name: string }[] }>(await orgB.get(B("/roles")))).roles;
    const roleId = roles.find((r) => r.name === "Distributor")?.id;
    expect(roleId, "org B has the default Distributor role").toBeTruthy();
    const co = await orgB.post(B("/external-companies"), { data: { name: `${run.prefix}co-${tag}`, type: "DISTRIBUTOR", country: "India", defaultCurrency: "INR" } });
    expect(co.status(), await co.text()).toBe(201);
    const companies = (await ok<{ companies: { id: string; name: string }[] }>(await orgB.get(B("/external-companies")))).companies;
    const companyId = companies.find((c) => c.name === `${run.prefix}co-${tag}`)?.id;
    expect(companyId, "the company is listed").toBeTruthy();
    const username = `${run.prefix}dist-${tag}`;
    await ok(await orgB.post(B("/users"), { data: { username, firstName: "RGR", lastName: "Dist", password, roleId, externalCompanyId: companyId } }), 201);

    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    const ctx = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL, extraHTTPHeaders: bypass ? { "x-vercel-protection-bypass": bypass } : {} });
    try {
      const page = await ctx.newPage();
      await apiSignIn(page, run.orgB.slug, username, password);
      const errors: string[] = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(String(e)));
      const icon = await openCalculator(page, run.orgB.slug);
      await icon.click();
      const dialog = page.getByRole("dialog", { name: "Quick Estimate" });
      await expect(dialog).toBeVisible();
      await addLineWith(page, dialog, c0.text);
      const rate = dialog.locator(".qe-lw").first().getByLabel("Unit rate");
      await expect(rate).toHaveValue("2800");
      await expect(dialog.locator("[data-reset]")).toHaveCount(0);
      await rate.fill("3100");
      await expect(dialog.locator("[data-reset]")).toBeVisible();
      // No toast (components/toast.tsx is role=status) and no alert, apart from Next's always-present route announcer.
      await expect(page.getByRole("status")).toHaveCount(0);
      await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);
      expect(errors, "no console error").toEqual([]);
    } finally {
      await ctx.close();
    }
  }
});
