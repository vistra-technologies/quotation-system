/**
 * J1 — inquiry → edit → convert → project → Configuration → Design → Submit Design → Summary → Recompute →
 * PDF export, in ONE flow as the Test Org admin (browser for every step a user clicks; API only to arrange
 * the GLASS / DOOR selections, whose code dropdowns list the org's configured codes rather than this run's
 * own inventory items).
 *
 * Cross-step state asserted (what the per-route / per-page tests cannot see):
 *   - the End Client / Main Contractor typed in the inquiry EDIT form reach the converted project and, at the
 *     end, the exported PDF's header;
 *   - the converted project is linked to the inquiry, which is CONVERTED; its config snapshot is frozen at
 *     conversion and its formula set pinned;
 *   - the floor, room and wall drawn on the Design canvas, the glass applied to every panel and the door put on
 *     one panel are exactly what the API stores and what the calculation bills;
 *   - the Summary page shows the calculation's material list row for row; Recompute keeps it identical and
 *     advances computedAt; the PDF carries the same codes.
 */
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { test, expect } from "../fixtures/test";
import { createLedgered } from "../api/project-helpers";
import { readConfigSnapshot } from "../../e2e/db-helpers";
import { orgPathOf, orgTarget, expectLands, settledProblems } from "../pages/page-helpers";
import { isHydrated } from "../pages/collect";
import { doorCfg, glassCfg, readCalc, type Calculation } from "../engine/materials";
import { T, addSelection, getJson, getProject, pillState, sharedItems, withPage } from "./journey-helpers";

test.use({ trace: "off" }); // traces would hold session cookies / the bypass header

type Inquiry = { id: string; name: string; status: string; endClientName: string | null; mainContractorName: string | null };
type Partition = { id: string; widthMm: number; heightMm: number; design: { schemaVersion: number; sections: Array<{ widthMm: number; cells: Array<{ heightMm: number; selectionId: string | null }> }> } };

test("J1: inquiry → edit → convert → Configuration → Design canvas → Submit → Summary → Recompute → PDF", async ({ browser, as, f, run, ledger }) => {
  test.setTimeout(360_000);
  const c = { as, f, run };
  const tag = randomBytes(2).toString("hex");
  const glass = await sharedItems(c, "GLASS");
  const door = await sharedItems(c, "DOOR");

  // ── 1. inquiry (API) ────────────────────────────────────────────────────────
  const name = `${run.prefix}j1-${tag}`;
  const { id: inquiryId, res } = await createLedgered(as.admin, { run, ledger }, "inquiry", {
    name, currency: "AED", projectLocation: "Dubai UAE", submissionDate: "2026-10-01", mainContractorName: "RGR Main",
  });
  expect(res.status(), await res.text()).toBe(201);
  const endClient = `RGR Client ${tag}`;
  const contractor = `RGR Contractor ${tag}`;
  let projectId = "";

  await withPage(browser, run, "admin", async (o) => {
    const { page } = o;

    // ── 2. edit the inquiry in the UI ─────────────────────────────────────────
    await test.step("edit inquiry (UI)", async () => {
      await page.goto(orgTarget(run, `/inquiries/${inquiryId}/edit`));
      await expect(page.getByLabel("End Client Name")).toBeVisible();
      await page.getByLabel("End Client Name").fill(endClient);
      await page.getByLabel(/Main Contractor/).fill(contractor);
      const save = page.getByRole("button", { name: "Save Changes" });
      await expect.poll(() => isHydrated(save)).toBe(true);
      await save.click();
      await expectLands(() => orgPathOf(run, page.url()), `/inquiries/${inquiryId}`, "after Save Changes");
      const inq = (await getJson<{ inquiry: Inquiry }>(as.admin, T(c, `/inquiries/${inquiryId}`))).inquiry;
      expect(inq).toMatchObject({ name, status: "NEW", endClientName: endClient, mainContractorName: contractor });
    });

    // ── 3. convert in the UI (Start Project) ──────────────────────────────────
    await test.step("convert (UI Start Project)", async () => {
      const start = page.getByRole("button", { name: "Start Project" });
      /** The converted project, found by its unique rgr- name — ledgered the moment it exists. */
      const findProject = async (): Promise<string | null> => {
        const l = await getJson<{ projects: { id: string; name: string }[] }>(as.admin, T(c, `/projects?search=${encodeURIComponent(name)}`));
        const id = l.projects.find((x) => x.name === name)?.id ?? null;
        if (id && !projectId) ledger.add({ kind: "project", id, orgSlug: run.testOrg.slug, label: name });
        return id;
      };
      for (let attempt = 1; ; attempt++) {
        await expect(start).toBeEnabled();
        await expect.poll(() => isHydrated(start)).toBe(true);
        await start.click();
        // The server action creates the project, then redirects to it. A concurrent create may race the
        // per-org project number (inline "conflict" message, nothing written) — click again, like a user.
        let outcome = "";
        await expect
          .poll(async () => {
            const id = await findProject();
            if (id) projectId = id;
            outcome = id ? "created" : (await page.getByText(/project number conflict/i).count()) ? "conflict" : "";
            return outcome;
          }, { timeout: 45_000, message: "Start Project neither created the project nor reported a conflict" })
          .not.toBe("");
        if (outcome === "created") break;
        if (attempt >= 3) throw new Error("Start Project hit 3 project-number conflicts in a row");
      }
      await expectLands(() => orgPathOf(run, page.url()), `/projects/${projectId}`, "Start Project redirects to the new project");
      const p = await getProject(as.admin, c, projectId);
      expect(p).toMatchObject({ name, status: "DRAFT", inquiryId, endClientName: endClient, mainContractorName: contractor, currency: "AED", designSubmittedAt: null });
      expect(p.formulaSetId).toEqual(expect.any(String));
      const inq = (await getJson<{ inquiry: Inquiry }>(as.admin, T(c, `/inquiries/${inquiryId}`))).inquiry;
      expect(inq.status).toBe("CONVERTED");
      const snap = await readConfigSnapshot(projectId);
      expect(snap?.takenAt, "config snapshot frozen at conversion").toEqual(expect.any(String));
      expect(snap!.componentTypes.map((t) => t.code)).toEqual(expect.arrayContaining(["GLASS", "DOOR"]));
      // a fresh project: only Details / Configuration open
      await expect.poll(() => pillState(o, false), { timeout: 20_000 }).toEqual({ "Project Details": "open", Configuration: "open", Design: "locked", Summary: "locked", Quotation: "locked" });
    });

    // ── 4. Configuration: two saved components ────────────────────────────────
    const glassLabel = `${run.prefix}J1 Glass`;
    const doorLabel = `${run.prefix}J1 Door`;
    let glassSel = "";
    let doorSel = "";
    await test.step("configuration", async () => {
      glassSel = await addSelection(as.admin, run.testOrg.slug, projectId, "GLASS", glassLabel, glassCfg(glass));
      doorSel = await addSelection(as.admin, run.testOrg.slug, projectId, "DOOR", doorLabel, doorCfg(door));
      await page.goto(orgTarget(run, `/projects/${projectId}/configuration`));
      await expect(page.getByText(glassLabel).first()).toBeVisible();
      await expect(page.getByText(doorLabel).first()).toBeVisible();
      await expect.poll(() => pillState(o, false), { timeout: 20_000 }).toMatchObject({ Design: "open", Summary: "locked", Quotation: "locked" });
    });

    // ── 5. Design canvas: floor → room → wall → glass on every panel + a door ─
    let partitionId = "";
    await test.step("design canvas", async () => {
      await page.goto(orgTarget(run, `/projects/${projectId}/design`));
      await expect(page.getByText("No floors added yet.")).toBeVisible();
      // floor
      const addFloor = page.getByTitle("Add floor", { exact: true });
      await expect.poll(() => isHydrated(addFloor)).toBe(true);
      await addFloor.click();
      await page.getByPlaceholder("Floor name").fill(`${run.prefix}J1 Floor`);
      await page.getByRole("button", { name: "Add", exact: true }).click();
      // room (the left rail's "Add Room"; the empty-state card has a second one)
      const addRoom = page.getByRole("button", { name: "Add Room" }).first();
      await expect(addRoom).toBeVisible();
      await addRoom.click();
      await page.getByPlaceholder("e.g. Lobby").fill(`${run.prefix}J1 Room`);
      await page.getByTitle("Create Room", { exact: true }).click();
      // wall: click the first side of the plan, convert it to a 2000 × 2400 partition (mm)
      const sides = page.locator("svg polygon.cursor-pointer");
      await expect(sides).toHaveCount(4);
      await sides.first().click();
      await expect(page.getByRole("button", { name: "Convert to Partition" })).toBeVisible();
      await expect(page.getByLabel("Width (mm)"), "lengths are entered in mm (no unit toggle since Stage 20 B5)").toBeVisible();
      await page.getByLabel("Width (mm)").fill("2000");
      await page.getByLabel("Height (mm)").fill("2400");
      const [conv] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === "PATCH" && /\/rooms\/[^/]+\/sides$/.test(r.url())),
        page.getByRole("button", { name: "Convert to Partition" }).click(),
      ]);
      expect(conv.status(), await conv.text()).toBe(200);
      partitionId = ((await conv.json()) as { room: { sides: { kind: string; partitionId: string | null }[] } }).room.sides.find((s) => s.kind === "PARTITION")!.partitionId!;
      // configure the wall
      await page.getByRole("button", { name: /Configure Partition/ }).click();
      await expect(page.getByRole("button", { name: "Add Panel" })).toBeVisible();
      // glass → every panel; then a door on panel 1 alone
      // the Saved Components cards are real <button>s (the panel chips are div[role=button] and also show the label)
      const card = (label: string) => page.locator("button").filter({ hasText: label });
      await card(glassLabel).click();
      const chips = page.locator("[role='button'][aria-selected]");
      if ((await chips.first().getAttribute("aria-selected")) !== "true") await chips.first().click();
      await expect(page.locator("[role='button'][aria-selected='true']")).toHaveCount(1);
      await card(doorLabel).click();
      const save = page.getByRole("button", { name: "Save changes" });
      await expect(save).toBeEnabled();
      const [patch] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes(`/partitions/${partitionId}`)),
        save.click(),
      ]);
      expect(patch.status(), await patch.text()).toBe(200);
      await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();

      // what the canvas stored: a 2000 × 2400 v2 design, glass everywhere except one full-height door cell
      const part = (await getJson<{ partition: Partition }>(as.admin, T(c, `/partitions/${partitionId}`))).partition;
      expect(part).toMatchObject({ widthMm: 2000, heightMm: 2400 });
      expect(part.design.schemaVersion).toBe(2);
      expect(part.design.sections.reduce((s, x) => s + x.widthMm, 0)).toBe(2000);
      const cells = part.design.sections.flatMap((s) => s.cells);
      expect(cells.filter((x) => x.selectionId === doorSel)).toEqual([expect.objectContaining({ heightMm: 2400 })]);
      expect(cells.filter((x) => x.selectionId !== doorSel).every((x) => x.selectionId === glassSel)).toBe(true);
      expect(cells.length).toBeGreaterThan(1);
    });

    // ── 6. Submit Design (UI) ─────────────────────────────────────────────────
    let calc!: Calculation;
    await test.step("submit design (UI)", async () => {
      await page.getByRole("button", { name: "Back to Room Layout" }).click();
      const submit = page.getByRole("button", { name: /^Submit Design$/ });
      await expect(submit).toBeEnabled();
      const [resp] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/projects/${projectId}/submit-design`)),
        submit.click(),
      ]);
      expect(resp.status(), await resp.text()).toBe(200);
      await expect.poll(async () => (await pillState(o, false)).Summary, { timeout: 20_000 }).toBe("open");
      expect((await getProject(as.admin, c, projectId)).designSubmittedAt).not.toBeNull();
      calc = await readCalc(as.admin, run.testOrg.slug, projectId);
      expect(calc.status).toBe("OK");
      // the canvas door + glass are what got billed: all 12 DOOR and all 10 GLASS formulas fired
      const billed = new Set(calc.materialList.map((l) => l.code));
      for (const code of [...Object.values(glass.codes), ...Object.values(door.codes)]) expect(billed.has(code), code).toBe(true);
      expect(calc.materialList).toHaveLength(22);
      expect(calc.summary.kpis.doorsByType).toEqual([{ doorType: "Simple Glass", quantity: 1 }]);
    });

    // ── 7. Summary page = the calculation ─────────────────────────────────────
    const expectSummaryMatches = async (k: Calculation) => {
      await expect(page.getByText("Export PDF")).toBeVisible();
      for (const line of k.materialList) {
        const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: line.code, exact: true }) });
        await expect(row, line.code).toHaveCount(1);
        await expect(row.getByRole("cell").last(), `${line.code} Item Qty`).toHaveText(String(line.quantity));
      }
      await expect(page.getByRole("row").filter({ hasText: "Simple Glass" }).first()).toBeVisible(); // door KPI row
    };
    await test.step("summary page", async () => {
      await page.goto(orgTarget(run, `/projects/${projectId}/summary`));
      await expectLands(() => orgPathOf(run, page.url()), `/projects/${projectId}/summary`);
      await expectSummaryMatches(calc);
    });

    // ── 8. Recompute (UI) ─────────────────────────────────────────────────────
    await test.step("recompute (UI)", async () => {
      const btn = page.getByRole("button", { name: "Recompute" });
      await expect.poll(() => isHydrated(btn)).toBe(true);
      const [resp] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/projects/${projectId}/recompute`)),
        btn.click(),
      ]);
      expect(resp.status(), await resp.text()).toBe(200);
      const again = await readCalc(as.admin, run.testOrg.slug, projectId);
      expect(again.materialList, "recompute of an unchanged design is deterministic").toEqual(calc.materialList);
      expect(again.summary).toEqual(calc.summary);
      expect(Date.parse(again.computedAt)).toBeGreaterThan(Date.parse(calc.computedAt));
      expect((await getProject(as.admin, c, projectId)).designSubmittedAt, "recompute never touches designSubmittedAt").not.toBeNull();
      await expect(page.getByRole("button", { name: "Recompute" })).toBeEnabled(); // idle again after router.refresh()
      await expectSummaryMatches(again);
      calc = again;
    });

    // ── 9. PDF export ─────────────────────────────────────────────────────────
    await test.step("PDF export", async () => {
      const p = await getProject(as.admin, c, projectId);
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export PDF" }).click()]);
      expect(download.suggestedFilename()).toMatch(new RegExp(`^summary-${p.projectNumber}-\\d{4}-\\d{2}-\\d{2}\\.pdf$`));
      const bytes = fs.readFileSync((await download.path())!);
      expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(bytes.length).toBeGreaterThan(2000);
      // jsPDF writes uncompressed content streams (no FlateDecode): each text run is a searchable "(…) Tj"
      // operand. A cell wraps long text across runs, so only tokens that fit one table line are searched
      // (the run's item codes are kept short for that reason; the "Item Qty" header wraps to "Item" / "Qty").
      const text = bytes.toString("latin1");
      expect(text.includes("FlateDecode"), "uncompressed PDF").toBe(false);
      const missing = [
        ...["PROJECT SUMMARY", name, endClient, "(Code)", "(Requirement)"].filter((t) => !text.includes(t)),
        ...calc.materialList.map((l) => l.code).filter((code) => !text.includes(`(${code})`)), // one whole cell each
      ];
      expect(missing, "tokens missing from the PDF").toEqual([]);
    });

    // The two server actions that end in redirect() (Save Changes on /edit, Start Project on the inquiry page)
    // are POSTed by Next's client, which aborts the action fetch once it has read the redirect: Chromium
    // reports them as ERR_ABORTED. Their effects were asserted through the API above, so exactly these two
    // entries are expected; anything else (another URL, another error, any console error / 5xx) fails.
    const actionAborts = new RegExp(`^request failed \\[fetch/POST\\] \\S+/inquiries/${inquiryId}(/edit)? net::ERR_ABORTED$`);
    expect((await settledProblems(o)).filter((p) => !actionAborts.test(p))).toEqual([]);
  });
});
