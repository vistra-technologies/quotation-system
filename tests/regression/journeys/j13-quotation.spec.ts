/**
 * J13 (Stage 38 Batch 4): submitted design -> Quotation page -> Create -> edit the money inputs -> Refresh -> PDF,
 * in ONE flow as the Test Org admin. The project is arranged through the API with THIS run's own GLASS item set
 * (rgr- items, priced here), so the journey writes no Test Org shared item price (the ONE-WORKER RULE of
 * api/quotations.spec.ts is about the shared Test Org codes).
 *
 * Cross-step state asserted: the lines the page shows are the calculation's material list (code and quantity); the
 * totals the page shows after Save are the API's; a Refresh after a recompute clears the "design changed" banner;
 * the PDF carries the quotation number, every code and the grand total the page shows.
 */
import fs from "node:fs";
import { test, expect } from "../fixtures/test";
import { createLedgered, expectSubmitted, oneCellDesign, tag } from "../api/project-helpers";
import { orgTarget, settledProblems } from "../pages/page-helpers";
import { isHydrated } from "../pages/collect";
import { glassCfg, readCalc } from "../engine/materials";
import { T, addSelection, buildRoom, getJson, pillState, sharedItems, withPage, wallOf, PLAIN } from "./journey-helpers";

test.use({ trace: "off" }); // traces would hold session cookies / the bypass header

type Q = { number: string; lines: { code: string; quantity: number; unitPrice: string; amount: string }[]; totals: { grandTotal: string; subtotal: string }; transport: string; designChanged: boolean };
const fmt = (v: string) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

test("J13: submitted design -> Create quotation -> edit inputs -> Refresh -> PDF", async ({ browser, as, f, run, ledger }) => {
  test.setTimeout(360_000);
  const c = { as, f, run };
  const glass = await sharedItems(c, "GLASS");
  // price every item of the set in AED (the project currency): 100, 110, ... (min 80, 90, ...)
  for (const [i, id] of Object.values(glass.ids).entries()) {
    const r = await as.admin.put(`${T(c, `/inventory/${id}/prices`)}`, { data: [{ currency: "AED", price: `${100 + i * 10}.00`, minPrice: `${80 + i * 10}.00`, allowAbove: false }] });
    expect(r.status(), await r.text()).toBe(200);
  }

  const { res, id: projectId } = await createLedgered(as.admin, { run, ledger }, "project", { name: `${run.prefix}j13-${tag()}`, currency: "AED", projectLocation: "Dubai, UAE" });
  expect(res.status(), await res.text()).toBe(201);
  const selId = await addSelection(as.admin, run.testOrg.slug, projectId!, "GLASS", `${run.prefix}J13 Glass`, glassCfg(glass));
  const room = await buildRoom(as.admin, run.testOrg.slug, run.prefix, projectId!, [wallOf(2000, 2400), PLAIN, PLAIN, PLAIN]);
  const part = await as.admin.patch(T(c, `/partitions/${room.partitionIds[0]}`), { data: { heightMm: 2400, design: oneCellDesign(selId) } });
  expect(part.status(), await part.text()).toBe(200);
  await expectSubmitted(await as.admin.post(T(c, `/projects/${projectId}/submit-design`)));
  const calc = await readCalc(as.admin, run.testOrg.slug, projectId!);
  expect(calc.status).toBe("OK");

  await withPage(browser, run, "admin", async (o) => {
    const { page } = o;
    await page.goto(orgTarget(run, `/projects/${projectId}/quotation`));
    expect((await pillState(o)).Quotation).toBe("open");

    // Create (UI)
    const create = page.getByRole("button", { name: "Create quotation" });
    await expect(create).toBeEnabled();
    await expect.poll(() => isHydrated(create)).toBe(true);
    const [created] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && /\/quotation$/.test(r.url())),
      create.click(),
    ]);
    expect(created.status(), await created.text()).toBe(201);
    const q = (JSON.parse(await created.text()) as { quotation: Q }).quotation;
    await expect(page.getByTestId("quotation-number")).toHaveText(q.number);
    // the page shows the calculation's material list, code for code
    expect(q.lines.map((l) => l.code).sort()).toEqual(calc.materialList.map((l) => l.code).sort());
    await expect(page.getByTestId("quotation-line")).toHaveCount(calc.materialList.length);
    await expect(page.getByTestId("totals-grand")).toHaveText(fmt(q.totals.grandTotal));

    // Edit the inputs (UI), Save: the page shows exactly what the API stored
    const totals = page.getByTestId("quotation-totals");
    await totals.getByRole("button", { name: "Edit", exact: true }).click();
    await totals.getByLabel("Transport").fill("500");
    await totals.getByLabel("Tax percent").fill("18");
    const [patched] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "PATCH" && /\/quotation$/.test(r.url())),
      totals.getByRole("button", { name: "Save", exact: true }).click(),
    ]);
    expect(patched.status(), await patched.text()).toBe(200);
    const q2 = (JSON.parse(await patched.text()) as { quotation: Q }).quotation;
    expect(q2.transport).toBe("500.00");
    await expect(page.getByTestId("totals-grand")).toHaveText(fmt(q2.totals.grandTotal));
    await expect(page.getByTestId("quotation-grand-total-tile")).toContainText(fmt(q2.totals.grandTotal));

    // A recompute (API) makes the design-changed banner show; Refresh (UI) clears it and keeps the inputs
    const rc = await as.admin.post(T(c, `/projects/${projectId}/recompute`));
    expect(rc.status(), await rc.text()).toBe(200);
    await page.goto(orgTarget(run, `/projects/${projectId}/quotation`));
    await expect(page.getByTestId("quotation-banner-design")).toBeVisible();
    const banner = page.getByTestId("quotation-banner-design").getByRole("button", { name: "Refresh" });
    await expect.poll(() => isHydrated(banner)).toBe(true);
    await banner.click();
    const dialog = page.getByRole("dialog");
    const [refreshed] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/quotation/refresh")),
      dialog.getByRole("button", { name: "Refresh", exact: true }).click(),
    ]);
    expect(refreshed.status(), await refreshed.text()).toBe(200);
    await expect(page.getByTestId("quotation-banner-design")).toHaveCount(0);
    const q3 = (await getJson<{ quotation: Q }>(as.admin, T(c, `/projects/${projectId}/quotation`))).quotation;
    expect(q3.designChanged).toBe(false);
    expect(q3.transport).toBe("500.00");

    // PDF (UI)
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export PDF" }).click()]);
    expect(download.suggestedFilename()).toBe(`quotation-${q.number}.pdf`);
    const text = fs.readFileSync((await download.path())!).toString("latin1");
    expect(text.includes("FlateDecode"), "uncompressed PDF").toBe(false);
    const missing = [q.number, `AED ${fmt(q3.totals.grandTotal)}`, ...q3.lines.map((l) => l.code)].filter((t) => !text.includes(t));
    expect(missing, "tokens missing from the PDF").toEqual([]);
    expect(await settledProblems(o)).toEqual([]);
  });
});
