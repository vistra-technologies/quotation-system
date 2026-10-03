/**
 * J3 — floor delete, project reset and project delete, driven from the UI on one converted, submitted project
 * with two floors. After each destructive step the journey proves both halves of the cascade: what had to go
 * is gone (by id, via the API) and what had to stay is intact — and that the wizard pills follow without a
 * reload (each UI path ends in router.refresh()).
 *
 *   1. Design page "Delete floor" (floor 1): its room + wall are gone; floor 2, its wall and the saved
 *      components stay; the submission + calculation are dropped; re-submitting bills floor 2's wall only.
 *   2. Project Details "Reset project": every floor / room / wall / saved component / calculation is wiped, but
 *      the project row keeps its id, number, name and inquiry link; the config snapshot is re-frozen (newer
 *      takenAt) and the formula set re-pinned; Design/Summary/Quotation lock.
 *   3. Project Details "Delete project": the row and every child are gone, the browser lands on the Projects
 *      list, and the inquiry it was converted from re-opens (NEW).
 */
import { test, expect } from "../fixtures/test";
import { createLedgered } from "../api/project-helpers";
import { readConfigSnapshot } from "../../e2e/db-helpers";
import { expectLands, orgPathOf, orgTarget, settledProblems } from "../pages/page-helpers";
import { isHydrated } from "../pages/collect";
import { glassCfg, readCalc } from "../engine/materials";
import {
  PLAIN, T, addSelection, buildRoom, designOf, getJson, getProject, pillState, sharedItems, wallOf, withPage,
} from "./journey-helpers";

test.use({ trace: "off" });

test("J3: Delete floor → Reset project → Delete project (UI), with the cascade proven both ways", async ({ browser, as, f, run, ledger }) => {
  test.setTimeout(300_000);
  const c = { as, f, run };
  const slug = run.testOrg.slug;
  const glass = await sharedItems(c, "GLASS");

  // a converted project (so deleting it can re-open the inquiry) with two designed floors, submitted
  const name = `${run.prefix}j3-${Date.now().toString(36)}`;
  const inq = await createLedgered(as.admin, { run, ledger }, "inquiry", { name, currency: "AED", projectLocation: "Dubai UAE" });
  expect(inq.res.status()).toBe(201);
  const conv = await as.admin.post(T(c, `/inquiries/${inq.id}/convert`));
  expect(conv.status(), await conv.text()).toBe(201);
  const project = ((await conv.json()) as { project: { id: string; name: string; projectNumber: number; formulaSetId: string } }).project;
  ledger.add({ kind: "project", id: project.id, orgSlug: slug, label: project.name });
  const projectId = project.id;

  const gSel = await addSelection(as.admin, slug, projectId, "GLASS", `${run.prefix}J3 Glass`, glassCfg(glass));
  const one = designOf([[2000, [[2400, gSel]]]]);
  const F1 = await buildRoom(as.admin, slug, `${run.prefix}1`, projectId, [wallOf(2000, 2400), PLAIN, PLAIN, PLAIN]);
  const F2 = await buildRoom(as.admin, slug, `${run.prefix}2`, projectId, [wallOf(2000, 2400), PLAIN, PLAIN, PLAIN]);
  for (const p of [F1.partitionIds[0], F2.partitionIds[0]]) {
    const r = await as.admin.patch(T(c, `/partitions/${p}`), { data: { heightMm: 2400, design: one } });
    expect(r.status(), await r.text()).toBe(200);
  }
  const submit = async () => {
    const r = await as.admin.post(T(c, `/projects/${projectId}/submit-design`));
    expect(r.status(), await r.text()).toBe(200);
    return readCalc(as.admin, slug, projectId);
  };
  const k0 = await submit();
  const wallIds = (k: typeof k0) => k.summary.floors.flatMap((fl) => fl.rooms.flatMap((r) => r.walls.map((w) => w.partitionId))).sort();
  expect(wallIds(k0)).toEqual([F1.partitionIds[0], F2.partitionIds[0]].sort());

  const floors = async () => (await getJson<{ floors: { id: string }[] }>(as.admin, T(c, `/floors?projectId=${projectId}`))).floors.map((x) => x.id);
  const rooms = async (floorId: string) => (await getJson<{ rooms: { id: string }[] }>(as.admin, T(c, `/rooms?floorId=${floorId}`))).rooms.map((x) => x.id);
  const selections = async () => (await getJson<{ selections: { id: string }[] }>(as.admin, T(c, `/selections?projectId=${projectId}`))).selections.map((x) => x.id);
  const partitionStatus = async (id: string) => (await as.admin.get(T(c, `/partitions/${id}`))).status();

  await withPage(browser, run, "admin", async (o) => {
    const { page } = o;

    await test.step("1. Delete floor (Design page): only floor 1's subtree goes; the submission is dropped; floor 2 re-submits alone", async () => {
      await page.goto(orgTarget(run, `/projects/${projectId}/design`));
      expect(await pillState(o)).toMatchObject({ Summary: "open", Quotation: "open" });
      const floorSelect = page.getByRole("combobox").first();
      await expect(floorSelect).toHaveText(`${run.prefix}1F`);
      const del = page.getByTitle("Delete floor", { exact: true });
      await expect.poll(() => isHydrated(del)).toBe(true);
      await del.click();
      await expect(page.getByText(`Delete "${run.prefix}1F" and all its rooms and partitions? This cannot be undone.`)).toBeVisible();
      const [resp] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().includes(`/floors/${F1.floorId}`)),
        page.getByRole("button", { name: "Delete", exact: true }).click(),
      ]);
      expect(resp.status(), await resp.text()).toBe(200);
      await expect(floorSelect).toHaveText(`${run.prefix}2F`); // the surviving floor is selected
      await expect.poll(async () => (await pillState(o, false)).Summary, { timeout: 20_000, message: "pills re-lock via router.refresh()" }).toBe("locked");

      expect(await floors()).toEqual([F2.floorId]);
      expect(await rooms(F2.floorId)).toEqual([F2.roomId]);
      expect(await partitionStatus(F1.partitionIds[0]), "floor 1's wall is gone").toBe(404);
      expect(await partitionStatus(F2.partitionIds[0]), "floor 2's wall stays").toBe(200);
      expect(await selections(), "saved components belong to the project, not the floor").toEqual([gSel]);
      expect((await getProject(as.admin, c, projectId)).designSubmittedAt).toBeNull();
      expect((await as.admin.get(T(c, `/projects/${projectId}/calculation`))).status()).toBe(404);

      const k1 = await submit();
      expect(wallIds(k1)).toEqual([F2.partitionIds[0]]);
      expect(k1.summary.floors.map((fl) => fl.rooms.length)).toEqual([1]);
    });

    await test.step("2. Reset project (Details): children wiped, the row and its identity kept, snapshot re-frozen, pills locked", async () => {
      const snapBefore = await readConfigSnapshot(projectId);
      const before = await getProject(as.admin, c, projectId);
      await page.goto(orgTarget(run, `/projects/${projectId}`));
      expect(await pillState(o)).toMatchObject({ Design: "open", Summary: "open" });
      const reset = page.getByRole("button", { name: "Reset project" });
      await expect.poll(() => isHydrated(reset)).toBe(true);
      await reset.click();
      const dialog = page.getByRole("dialog").filter({ hasText: "Reset project?" });
      await expect(dialog).toBeVisible();
      const [resp] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/projects/${projectId}/reset`)),
        dialog.getByRole("button", { name: "Reset project" }).click(),
      ]);
      expect(resp.status(), await resp.text()).toBe(200);
      await expect
        .poll(async () => (await pillState(o, false)).Design, { timeout: 20_000, message: "pills re-lock via router.refresh()" })
        .toBe("locked");
      expect(await pillState(o)).toMatchObject({ "Project Details": "open", Configuration: "open", Design: "locked", Summary: "locked", Quotation: "locked" });

      expect(await floors()).toEqual([]);
      expect(await selections()).toEqual([]);
      expect(await partitionStatus(F2.partitionIds[0])).toBe(404);
      expect((await as.admin.get(T(c, `/projects/${projectId}/calculation`))).status()).toBe(404);
      const after = await getProject(as.admin, c, projectId);
      expect(after).toMatchObject({ id: projectId, projectNumber: before.projectNumber, name: before.name, inquiryId: inq.id, status: "DRAFT", designSubmittedAt: null });
      expect(after.formulaSetId, "re-pinned to the org's active set (unchanged)").toBe(before.formulaSetId);
      const snapAfter = await readConfigSnapshot(projectId);
      expect(Date.parse(snapAfter!.takenAt), "config snapshot re-frozen by the reset").toBeGreaterThan(Date.parse(snapBefore!.takenAt));
      expect((await getJson<{ inquiry: { status: string } }>(as.admin, T(c, `/inquiries/${inq.id}`))).inquiry.status, "a reset keeps the conversion").toBe("CONVERTED");
    });

    await test.step("3. Delete project (Details): row + children gone, lands on Projects, the inquiry re-opens", async () => {
      // give it children again, so the delete has something to cascade
      const sel = await addSelection(as.admin, slug, projectId, "GLASS", `${run.prefix}J3 Glass 2`, glassCfg(glass));
      const F3 = await buildRoom(as.admin, slug, `${run.prefix}3`, projectId, [wallOf(2000, 2400), PLAIN, PLAIN, PLAIN]);
      await page.goto(orgTarget(run, `/projects/${projectId}`));
      const del = page.getByRole("button", { name: "Delete project" });
      await expect.poll(() => isHydrated(del)).toBe(true);
      await del.click();
      const dialog = page.getByRole("dialog").filter({ hasText: "Delete project?" });
      await expect(dialog).toBeVisible();
      const [resp] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().endsWith(`/projects/${projectId}`)),
        dialog.getByRole("button", { name: "Delete project" }).click(),
      ]);
      expect(resp.status(), await resp.text()).toBe(200);
      ledger.remove(projectId);
      await expectLands(() => orgPathOf(run, page.url()), "/projects", "Delete lands on the Projects list");

      expect((await as.admin.get(T(c, `/projects/${projectId}`))).status()).toBe(404);
      expect(await partitionStatus(F3.partitionIds[0])).toBe(404);
      expect(await rooms(F3.floorId)).toEqual([]);
      expect(await selections(), `selection ${sel} went with its project`).toEqual([]);
      expect((await getJson<{ inquiry: { status: string } }>(as.admin, T(c, `/inquiries/${inq.id}`))).inquiry.status, "the inquiry re-opens").toBe("NEW");
    });

    expect(await settledProblems(o)).toEqual([]);
  });
});
