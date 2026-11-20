/**
 * Stage 37 Batch 2 (API AC4): `materialMatch` on the live engine.
 *
 * Runs entirely in the run's throwaway org B, with a formula set and a component type THIS test creates (rgr-
 * names, the set ledgered; the type and the items go with org B at teardown). The set carries the provisional
 * `glassPane` rule (a test fixture only, Q-D4: never seeded or published as product data). It is assigned to org B
 * through withRecordedGlobalState (org B's activeFormulaSetId is reverted and re-read), and the projects pinned to
 * it are deleted before the test ends, so the Cleaner can delete the set (a set in use is locked).
 *
 * The type has two free-text fields (`grade`, `size`), so its Matches rows need no org option wiring.
 */
import { globalStateFailuresFile, withRecordedGlobalState } from "../fixtures/global-state";
import { test, expect, SA, tag, json, expectStatus, listOrgs, postFormulaSet } from "../api/sa-helpers";
import { orgApi } from "../api/project-helpers";
import { readCalc, refused } from "./materials";


test.setTimeout(240_000);

test.describe("materialMatch on the live engine (throwaway org B)", () => {
  test("two matching items bill two lines at the same area; zero match -> UNRESOLVED_MATCH; inactive only -> INACTIVE_ITEM", async ({ sa, orgB, run, ledger }) => {
    const B = (p: string) => orgApi(run.orgB.slug, p);
    const code = `RGRMT${tag()}`.toUpperCase();
    const projectIds: string[] = [];

    // the component type (SuperAdmin route, org B only)
    const cats = await json<{ categories: { id: string }[] }>(await sa.get(`${SA}/component-categories?orgId=${run.orgB.id}`));
    const field = (key: string) => ({ key, label: key, type: "field", required: false, basic: true });
    const ct = await json<{ componentType: { id: string } }>(
      await sa.post(`${SA}/component-types`, {
        data: { orgId: run.orgB.id, code, name: `${run.prefix}match-type`, categoryId: cats.categories[0].id, fieldsSchema: [field("grade"), field("size")] },
      }),
      201,
    );
    const typeId = ct.componentType.id;

    // the formula set with the provisional glassPane rule
    const setName = `${run.prefix}fs-match-${tag()}`;
    const body = {
      schemaVersion: 2,
      slots: { [code]: { role: "glass", summaryParams: { glassType: "grade", thickness: "size" } } },
      formulas: [{
        id: "glassPane", slot: code, grain: "CELL", materialMatch: { itemType: code }, unit: "m²",
        quantity: "cell.widthMm * cell.heightMm / 1000000",
      }],
    };
    const created = await postFormulaSet(sa, ledger, { name: setName, body });
    const setId = (await json<{ formulaSet: { id: string } }>(created, 201)).formulaSet.id;

    const spec = {
      key: `org ${run.orgB.slug}.activeFormulaSetId`,
      read: async () => (await listOrgs(sa)).find((o) => o.id === run.orgB.id)?.activeFormulaSetId ?? null,
      write: async (v: unknown) => {
        await expectStatus(await sa.patch(`${SA}/orgs/${run.orgB.id}`, { data: { formulaSetId: v } }), 200, "revert org B assignment");
      },
    };

    const makeItem = async (suffix: string, rows: Record<string, string>, over: Record<string, unknown> = {}) => {
      const r = await orgB.post(B("/inventory"), {
        data: { code: `${run.prefix}mt-${suffix}-${tag()}`, name: `${run.prefix}mt ${suffix}`, measurementUnit: "m²", componentTypeId: typeId, attributes: rows, ...over },
      });
      expect(r.status(), await r.text()).toBe(201);
      return ((await r.json()) as { item: { id: string; code: string } }).item;
    };

    const submitOnNewProject = async (config: Record<string, string>) => {
      const pr = await orgB.post(B("/projects"), { data: { name: `${run.prefix}mt-${tag()}`, currency: "AED" } });
      expect(pr.status(), await pr.text()).toBe(201);
      const projectId = ((await pr.json()) as { project: { id: string } }).project.id;
      projectIds.push(projectId);
      const fl = await orgB.post(B("/floors"), { data: { projectId, label: `${run.prefix}F` } });
      expect(fl.status(), await fl.text()).toBe(201);
      const floorId = ((await fl.json()) as { floor: { id: string } }).floor.id;
      const rm = await orgB.post(B("/rooms"), { data: { floorId, label: `${run.prefix}R` } });
      expect(rm.status(), await rm.text()).toBe(201);
      const roomId = ((await rm.json()) as { room: { id: string } }).room.id;
      const sd = await orgB.patch(B(`/rooms/${roomId}/sides`), {
        data: {
          sides: [
            { kind: "PARTITION", widthMm: 1000, heightMm: 2000, turnDegrees: 90, label: `${run.prefix}W` },
            { kind: "PLAIN", turnDegrees: 90 }, { kind: "PLAIN", turnDegrees: 90 }, { kind: "PLAIN", turnDegrees: 90 },
          ],
        },
      });
      const sdText = await sd.text();
      expect(sd.status(), sdText).toBe(200);
      const partitionId = (JSON.parse(sdText) as { room: { sides: { kind: string; partitionId: string | null }[] } }).room.sides.find((s) => s.kind === "PARTITION")!.partitionId!;
      const sl = await orgB.post(B("/selections"), { data: { projectId, componentTypeId: typeId, label: `${run.prefix}mt-sel`, config, orderIndex: 0 } });
      expect(sl.status(), await sl.text()).toBe(201);
      const selectionId = ((await sl.json()) as { selection: { id: string } }).selection.id;
      const ds = await orgB.patch(B(`/partitions/${partitionId}`), {
        data: { heightMm: 2000, design: { schemaVersion: 2, sections: [{ id: "s0", widthMm: 1000, cells: [{ id: "s0-c0", heightMm: 2000, selectionId }] }] } },
      });
      expect(ds.status(), await ds.text()).toBe(200);
      return { projectId, submit: () => orgB.post(B(`/projects/${projectId}/submit-design`)) };
    };

    try {
      await withRecordedGlobalState(
        spec,
        async () => {
          await expectStatus(await sa.patch(`${SA}/orgs/${run.orgB.id}`, { data: { formulaSetId: setId } }), 200, "assign the match set to org B");
        },
        async () => {
          const a = await makeItem("a", { grade: "ID1", size: "12.76" });
          const b = await makeItem("b", { grade: "ID1", size: "12.76" }); // identical Matches: both bill (Q-D26)

          // 1) two matching items -> two lines, each at the full area (1 m x 2 m = 2 m2)
          const ok = await submitOnNewProject({ grade: "ID1", size: "12.76" });
          const okRes = await ok.submit();
          expect(okRes.status(), await okRes.text()).toBe(200);
          const calc = await readCalc(orgB, run.orgB.slug, ok.projectId);
          const lines = calc.materialList.filter((l) => l.code === a.code || l.code === b.code);
          expect(lines.map((l) => [l.code, l.unit, l.requirement]).sort()).toEqual([[a.code, "m²", 2], [b.code, "m²", 2]].sort());

          // 2) no item matches the Selection -> 422 UNRESOLVED_MATCH naming the choices, nothing written
          const none = await submitOnNewProject({ grade: "ID9", size: "12.76" });
          const noneBody = await refused(await none.submit());
          expect(noneBody.problems.map((p) => p.kind)).toEqual(["UNRESOLVED_MATCH"]);
          expect(noneBody.problems[0].scope).toBe("INVENTORY");
          expect(noneBody.problems[0].message).toBe("No active " + code + " inventory item matches ID9 · 12.76");

          // 3) both matches inactive -> INACTIVE_ITEM per item, no UNRESOLVED_MATCH
          for (const it of [a, b]) {
            await expectStatus(await orgB.patch(B(`/inventory/${it.id}`), { data: { active: false } }), 200, "deactivate");
          }
          const off = await submitOnNewProject({ grade: "ID1", size: "12.76" });
          const offBody = await refused(await off.submit());
          expect(offBody.problems.map((p) => p.kind).sort()).toEqual(["INACTIVE_ITEM", "INACTIVE_ITEM"]);
          expect(offBody.problems.map((p) => p.code).sort()).toEqual([a.code, b.code].sort());

          // 4) S37-4: a materialCode line would not resolve an item that has rows (covered by the unit suite);
          //    here: the item is still listed with its rows on GET
          const got = await json<{ item: { attributes: Record<string, string> } }>(await orgB.get(B(`/inventory/${a.id}`)));
          expect(got.item.attributes).toEqual({ grade: "ID1", size: "12.76" });
        },
        globalStateFailuresFile(run.storageDir),
      );
      expect(await spec.read()).toBe(run.formulaSetId); // back on the seeded set
    } finally {
      // the projects pin the set: delete them so the Cleaner can delete the (otherwise locked) set
      for (const id of projectIds) {
        const d = await orgB.delete(B(`/projects/${id}`));
        expect([200, 404], `delete project ${id}`).toContain(d.status());
      }
    }
  });
});
