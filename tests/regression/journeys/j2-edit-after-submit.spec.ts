/**
 * J2 — editing a submitted design. One real project (Test Org, real Submit Design → real calculation) taken
 * through a chain of edits; after each one the journey checks the state every later step depends on:
 * designSubmittedAt, the stored calculation, Recompute's gate, the wizard pills / Summary URL, and — after
 * re-submitting — that the new Summary reflects exactly the edit.
 *
 *   A. a Summary tab left open while the design is edited elsewhere: its Recompute answers 409 in place
 *      (inline message, no reload) because the edit deleted the calculation; a reload bounces to Details;
 *   B. re-submit → the new summary carries the new height;
 *   C. label-only edits (wall, saved component, room, floor, project) do NOT invalidate — and the stored summary
 *      keeps the OLD labels until a Recompute picks the new ones up;
 *   D. a saved-component config edit invalidates; re-submit → the glass KPI shows the new thickness;
 *   E. adding a wall invalidates and makes the design unsubmittable (CELL_UNASSIGNED on the new wall) until
 *      it is designed; removing it again invalidates again; the summary follows (2 walls → 1 wall).
 * (The Design-canvas save path that re-locks the pills without a reload is pages.spec.ts's wizard test.)
 */
import { test, expect } from "../fixtures/test";
import { expectLands, orgPathOf, orgTarget, settledProblems } from "../pages/page-helpers";
import { isHydrated } from "../pages/collect";
import { doorCfg, glassCfg, readCalc, refused, type Calculation } from "../engine/materials";
import { PLAIN, T, addSelection, buildRoom, designOf, getProject, pillState, sharedItems, wallOf, withPage } from "./journey-helpers";

test.use({ trace: "off" });

type Wall = { partitionId: string; wallLabel: string; glass: Array<{ glassType: string | null; thickness: string | null; widthMm: number; heightMm: number }>; doors: Array<{ heightMm: number }> };
type SummaryFull = { floors: Array<{ floorLabel: string; rooms: Array<{ roomLabel: string; walls: Wall[] }> }>; kpis: { sqmByGlassType: Array<{ glassType: string | null; thickness: string | null }> } };
const walls = (k: Calculation) => (k.summary as unknown as SummaryFull).floors.flatMap((f) => f.rooms.flatMap((r) => r.walls));

test("J2: edits after Submit Design — invalidation, Recompute gate, pills, and what the re-submitted Summary shows", async ({ browser, as, f, run }) => {
  test.setTimeout(300_000);
  const c = { as, f, run };
  const slug = run.testOrg.slug;
  const glass = await sharedItems(c, "GLASS");
  const door = await sharedItems(c, "DOOR");
  const { id: projectId, name: projectName } = await f.project();
  const { floorId, roomId, partitionIds: [p1] } = await buildRoom(as.admin, slug, run.prefix, projectId, [wallOf(2000, 2400), PLAIN, PLAIN, PLAIN]);
  const gSel = await addSelection(as.admin, slug, projectId, "GLASS", `${run.prefix}J2 Glass`, glassCfg(glass));
  const dSel = await addSelection(as.admin, slug, projectId, "DOOR", `${run.prefix}J2 Door`, doorCfg(door));
  const design = (h: number) => designOf([[1000, [[h, gSel]]], [1000, [[h, dSel]]]]);
  const patchPartition = async (id: string, data: Record<string, unknown>) => {
    const r = await as.admin.patch(T(c, `/partitions/${id}`), { data });
    expect(r.status(), await r.text()).toBe(200);
  };
  const submit = async () => {
    const r = await as.admin.post(T(c, `/projects/${projectId}/submit-design`));
    expect(r.status(), await r.text()).toBe(200);
    return readCalc(as.admin, slug, projectId);
  };
  /** The invalidated state: not submitted, no calculation, Recompute refused as "never computed". */
  const expectInvalidated = async (what: string) => {
    expect((await getProject(as.admin, c, projectId)).designSubmittedAt, what).toBeNull();
    expect((await as.admin.get(T(c, `/projects/${projectId}/calculation`))).status(), what).toBe(404);
    const r = await as.admin.post(T(c, `/projects/${projectId}/recompute`));
    expect(r.status(), what).toBe(409);
    expect(await r.json()).toEqual({ error: "This project has never been submitted or computed — recompute is not the first computation." });
  };

  await patchPartition(p1, { heightMm: 2400, design: design(2400) });
  const k0 = await submit();
  expect(walls(k0).map((w) => [w.glass.map((g) => g.heightMm), w.doors.map((d) => d.heightMm)])).toEqual([[[2400], [2400]]]);

  await withPage(browser, run, "admin", async (o) => {
    const { page } = o;

    await test.step("A: a stale Summary tab — Recompute after an edit elsewhere → 409 shown in place; reload bounces", async () => {
      await page.goto(orgTarget(run, `/projects/${projectId}/summary`));
      await expectLands(() => orgPathOf(run, page.url()), `/projects/${projectId}/summary`);
      expect(await pillState(o)).toMatchObject({ Summary: "open", Quotation: "open" });
      const btn = page.getByRole("button", { name: "Recompute" });
      await expect.poll(() => isHydrated(btn)).toBe(true);

      await patchPartition(p1, { heightMm: 2600, design: design(2600) }); // the edit, from "another tab"
      await expectInvalidated("height edit");

      const [resp] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/projects/${projectId}/recompute`)),
        btn.click(),
      ]);
      expect(resp.status()).toBe(409);
      await expect(page.getByRole("alert").filter({ hasText: "has never been submitted or computed" })).toBeVisible();
      await page.goto(orgTarget(run, `/projects/${projectId}/summary`));
      await expectLands(() => orgPathOf(run, page.url()), `/projects/${projectId}`, "Summary bounces once the submission is cleared");
      expect(await pillState(o)).toMatchObject({ Design: "open", Summary: "locked", Quotation: "locked" });
    });

    let k1!: Calculation;
    await test.step("B: re-submit → the summary carries the edited height; pills open again", async () => {
      k1 = await submit();
      expect(walls(k1).map((w) => [w.glass.map((g) => g.heightMm), w.doors.map((d) => d.heightMm)])).toEqual([[[2600], [2600]]]);
      expect(k1.materialList).not.toEqual(k0.materialList); // taller wall → longer profiles
      await page.goto(orgTarget(run, `/projects/${projectId}`));
      expect(await pillState(o)).toMatchObject({ Summary: "open", Quotation: "open" });
    });

    await test.step("C: label-only edits keep the submission; the stored summary keeps the old labels until Recompute", async () => {
      const L = `${run.prefix}J2x`;
      const edits: Array<[string, string, Record<string, unknown>]> = [
        ["wall label", `/partitions/${p1}`, { label: `${L} Wall` }],
        ["saved-component label", `/selections/${gSel}`, { label: `${L} Glass` }],
        ["room rename", `/rooms/${roomId}`, { label: `${L} Room` }],
        ["floor rename", `/floors/${floorId}`, { label: `${L} Floor` }],
        ["project rename", `/projects/${projectId}`, { name: `${projectName}-x` }],
      ];
      for (const [what, path, data] of edits) {
        const r = await as.admin.patch(T(c, path), { data });
        expect(r.status(), `${what}: ${await r.text()}`).toBe(200);
        expect((await getProject(as.admin, c, projectId)).designSubmittedAt, what).not.toBeNull();
        expect((await readCalc(as.admin, slug, projectId)).computedAt, `${what} leaves the calculation untouched`).toBe(k1.computedAt);
      }
      const stale = (await readCalc(as.admin, slug, projectId)).summary as unknown as SummaryFull;
      expect(stale.floors[0].rooms[0].walls[0].wallLabel).not.toBe(`${L} Wall`);
      const r = await as.admin.post(T(c, `/projects/${projectId}/recompute`));
      expect(r.status(), await r.text()).toBe(200);
      const k2 = await readCalc(as.admin, slug, projectId);
      const s = k2.summary as unknown as SummaryFull;
      expect([s.floors[0].floorLabel, s.floors[0].rooms[0].roomLabel, s.floors[0].rooms[0].walls[0].wallLabel]).toEqual([`${L} Floor`, `${L} Room`, `${L} Wall`]);
      expect(k2.materialList, "labels never change the material list").toEqual(k1.materialList);
    });

    await test.step("D: a saved-component config edit invalidates; re-submit → the glass KPI shows the new thickness", async () => {
      const r = await as.admin.patch(T(c, `/selections/${gSel}`), { data: { config: { ...glassCfg(glass), thickness: "10" } } });
      expect(r.status(), await r.text()).toBe(200);
      await expectInvalidated("selection config edit");
      const k3 = await submit();
      expect(walls(k3)[0].glass.map((g) => [g.glassType, g.thickness])).toEqual([["ID1", "10"]]);
      expect((k3.summary as unknown as SummaryFull).kpis.sqmByGlassType.map((g) => [g.glassType, g.thickness])).toEqual([["ID1", "10"]]);
    });

    await test.step("E: adding a wall invalidates and blocks Submit (CELL_UNASSIGNED) until it is designed; removing it invalidates again", async () => {
      const sides = async (list: unknown[]) => {
        const r = await as.admin.patch(T(c, `/rooms/${roomId}/sides`), { data: { sides: list } });
        expect(r.status(), await r.text()).toBe(200);
        return ((await r.json()) as { room: { sides: { kind: string; partitionId: string | null }[] } }).room.sides;
      };
      const keep = { kind: "PARTITION", partitionId: p1, turnDegrees: 90 };
      const after = await sides([keep, { kind: "PARTITION", turnDegrees: 90, label: `${run.prefix}J2 W2`, widthMm: 1500, heightMm: 2600 }, { kind: "PLAIN", turnDegrees: 90 }, { kind: "PLAIN", turnDegrees: 90 }]);
      const p2 = after[1].partitionId!;
      expect(p2).toBeTruthy();
      await expectInvalidated("wall added");

      const blocked = await refused(await as.admin.post(T(c, `/projects/${projectId}/submit-design`)));
      expect(new Set(blocked.problems.map((p) => [p.kind, p.scope, p.locus?.partitionId].join("|")))).toEqual(new Set([`CELL_UNASSIGNED|DESIGN|${p2}`]));
      expect((await as.admin.get(T(c, `/projects/${projectId}/calculation`))).status(), "a refused submit writes nothing").toBe(404);

      await patchPartition(p2, { heightMm: 2600, design: designOf([[1500, [[2600, gSel]]]]) });
      const k4 = await submit();
      expect(walls(k4).map((w) => w.partitionId).sort()).toEqual([p1, p2].sort());

      await sides([keep, { kind: "PLAIN", turnDegrees: 90 }, { kind: "PLAIN", turnDegrees: 90 }, { kind: "PLAIN", turnDegrees: 90 }]);
      await expectInvalidated("wall removed");
      expect((await as.admin.get(T(c, `/partitions/${p2}`))).status(), "the removed wall's partition is gone").toBe(404);
      const k5 = await submit();
      expect(walls(k5).map((w) => w.partitionId)).toEqual([p1]);
    });

    // Step A's Recompute 409 is a handled state (the inline alert above), but Chromium logs every 4xx fetch as a
    // console error: exactly ONE such line is expected; anything else fails.
    const problems = await settledProblems(o);
    const is409 = (p: string) => p.startsWith("console.error: Failed to load resource: the server responded with a status of 409");
    expect(problems.filter(is409)).toHaveLength(1);
    expect(problems.filter((p) => !is409(p))).toEqual([]);
  });
});
