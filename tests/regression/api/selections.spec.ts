/**
 * Selections (the Configuration page's saved components): list/create, PATCH/DELETE by id.
 *
 * Gates (route source): every verb is "any authenticated org member" — no permission. Create validates
 * the component type against the project's FROZEN configSnapshot (Stage 22 #11; must be present in it,
 * active and fully configured — lib/configurator-gating.ts), but does NOT validate the config VALUES
 * (KNOWN BUG pin). PATCH takes only { label?, config? } (config is replaced whole; componentTypeId and
 * orderIndex are not patchable). DELETE refuses (409) while any partition cell / stop references it.
 * A config PATCH invalidates the calculation (Stage 23 D-19); label PATCH, create and DELETE do not.
 *
 * Selections cascade with their project (`f.project` / `f.wall`, ledgered kind `project`). The org-B
 * selection (foreign-id probes) goes with org B at teardown.
 */
import type { APIResponse } from "@playwright/test";
import { test, expect } from "../fixtures/test";
import { covers } from "../fixtures/covers";
import { registerNegatives, GHOST, type Ctx } from "./api-matrix";
import { orgApi, tag, foreignProjectId, distributorCompanyId, createLedgered } from "./project-helpers";
import { ok, rejected, design, sharedWall, foreignTree, typeId, type Selection } from "./design-helpers";
import { rgrInsertCalculation, readProjectState, rgrSetDesignSubmittedAt, rgrSetProjectStatus } from "../../e2e/db-helpers";

covers("GET /api/v1/orgs/[orgSlug]/selections");
covers("POST /api/v1/orgs/[orgSlug]/selections");
covers("PATCH /api/v1/orgs/[orgSlug]/selections/[id]");
covers("DELETE /api/v1/orgs/[orgSlug]/selections/[id]");

const nm = (c: Pick<Ctx, "run">, what: string) => `${c.run.prefix}${what}-${tag()}`;
const glassId = (c: Ctx) => typeId(c.as.admin, c.run, "GLASS");
const sel = async (c: Ctx, over: Record<string, unknown> = {}) => ({
  projectId: (await sharedWall(c.f)).projectId,
  componentTypeId: await glassId(c),
  label: nm(c, "negS"),
  config: {},
  orderIndex: 0,
  ...over,
});

registerNegatives([
  { key: "GET /api/v1/orgs/[orgSlug]/selections", method: "GET", path: () => `/selections?projectId=${GHOST}` },
  {
    key: "POST /api/v1/orgs/[orgSlug]/selections",
    method: "POST",
    path: () => "/selections",
    body: (c) => ({ projectId: GHOST, componentTypeId: GHOST, label: nm(c, "negS"), config: {} }),
    invalid: [
      { name: "{} (projectId, componentTypeId and label are required)", body: {}, status: 400 },
      { name: "missing componentTypeId", body: async (c: Ctx) => sel(c, { componentTypeId: undefined }), status: 400 },
      { name: "missing projectId", body: async (c: Ctx) => sel(c, { projectId: undefined }), status: 400 },
      { name: "missing label", body: async (c: Ctx) => sel(c, { label: undefined }), status: 400 },
      { name: "blank label", body: async (c: Ctx) => sel(c, { label: "   " }), status: 400 },
      { name: "non-string componentTypeId", body: async (c: Ctx) => sel(c, { componentTypeId: 1 }), status: 400 },
      { name: "unknown projectId", body: async (c: Ctx) => sel(c, { projectId: GHOST }), status: 400 },
      { name: "org-B projectId", body: async (c: Ctx) => sel(c, { projectId: await foreignProjectId(c) }), status: 400 },
      { name: "unknown componentTypeId", body: async (c: Ctx) => sel(c, { componentTypeId: GHOST }), status: 400 },
      { name: "org-B componentTypeId", body: async (c: Ctx) => sel(c, { componentTypeId: (await foreignTree(c)).componentTypeId }), status: 400 },
    ],
  },
  {
    key: "PATCH /api/v1/orgs/[orgSlug]/selections/[id]",
    method: "PATCH",
    path: () => `/selections/${GHOST}`,
    body: (c) => ({ label: nm(c, "negS") }),
    unknownId: () => `/selections/${GHOST}`,
    foreignId: async (c) => `/selections/${(await foreignTree(c)).selectionId}`,
    invalid: [
      { name: "{} (at least one of label or config)", body: {}, status: 400 },
      { name: "orderIndex only (not patchable)", body: { orderIndex: 3 }, status: 400 },
      { name: "componentTypeId only (not patchable)", body: { componentTypeId: GHOST }, status: 400 },
      { name: "config an array", body: { config: [] }, status: 400 },
      { name: "config a string", body: { config: "x" }, status: 400 },
      { name: "label a number", body: { label: 1 }, status: 400 },
    ],
  },
  {
    key: "DELETE /api/v1/orgs/[orgSlug]/selections/[id]",
    method: "DELETE",
    path: () => `/selections/${GHOST}`,
    unknownId: () => `/selections/${GHOST}`,
    foreignId: async (c) => `/selections/${(await foreignTree(c)).selectionId}`,
  },
]);

async function armSubmitted(projectId: string) {
  await rgrSetDesignSubmittedAt(projectId);
  await rgrInsertCalculation(projectId);
  expect(await readProjectState(projectId)).toMatchObject({ designSubmittedAt: expect.any(String), calcCount: 1 });
}

test.describe("selections: create / list / patch", () => {
  test("create stores label (trimmed), config verbatim and orderIndex; list joins componentType {id, name, code}", async ({ as, f, run, url }) => {
    const p = await f.project();
    const glass = await typeId(as.admin, run, "GLASS");
    const L = nm({ run }, "S");
    const config = { category: "Single", thickness: "12", rgrFlag: true, rgrNum: 7, rgrNull: null };
    const s = (await ok<{ selection: Selection }>(await as.member.post(url("/selections"), { data: { projectId: ` ${p.id} `, componentTypeId: glass, label: ` ${L} `, config, orderIndex: 4 } }), 201)).selection;
    expect(s).toMatchObject({ projectId: p.id, componentTypeId: glass, label: L, config, orderIndex: 4, organizationId: run.testOrg.id });
    const list = (await ok<{ selections: Selection[] }>(await as.member.get(url(`/selections?projectId=${p.id}`)))).selections;
    expect(list).toHaveLength(1);
    // the name is not asserted: projects.spec.ts may be renaming GLASS in parallel (rename window)
    expect(list[0]).toMatchObject({ id: s.id, config, componentType: { id: glass, code: "GLASS", name: expect.any(String) } });
    const g = (await ok<{ project: { selectionCount: number } }>(await as.admin.get(url(`/projects/${p.id}`)))).project;
    expect(g.selectionCount).toBe(1);
  });

  test("orderIndex: list sorted by it; a numeric string is parsed, junk/missing → 0; a non-object config is stored as {}", async ({ as, f, run, url }) => {
    const p = await f.project();
    const glass = await typeId(as.admin, run, "GLASS");
    const post = async (orderIndex: unknown, config: unknown = {}) =>
      (await ok<{ selection: Selection }>(await as.admin.post(url("/selections"), { data: { projectId: p.id, componentTypeId: glass, label: nm({ run }, "S"), config, ...(orderIndex === undefined ? {} : { orderIndex }) } }), 201)).selection;
    const c = await post(7);
    const a = await post("3");
    const b = await post(5, ["not", "an", "object"]);
    expect([c.orderIndex, a.orderIndex, b.orderIndex]).toEqual([7, 3, 5]);
    expect(b.config).toEqual({});
    expect((await post("abc")).orderIndex).toBe(0);
    expect((await post(undefined)).orderIndex).toBe(0);
    const list = (await ok<{ selections: Selection[] }>(await as.admin.get(url(`/selections?projectId=${p.id}`)))).selections;
    expect(list.slice(-3).map((s) => s.id)).toEqual([a.id, b.id, c.id]);
    expect(list.map((s) => s.orderIndex)).toEqual([0, 0, 3, 5, 7]);
  });

  test("PATCH: label trimmed; config replaced whole; orderIndex/componentTypeId in the body are ignored (order stable)", async ({ as, f, run, url }) => {
    const p = await f.project();
    const glass = await typeId(as.admin, run, "GLASS");
    const door = await typeId(as.admin, run, "DOOR");
    const mk = async (orderIndex: number) =>
      (await ok<{ selection: Selection }>(await as.admin.post(url("/selections"), { data: { projectId: p.id, componentTypeId: glass, label: nm({ run }, "S"), config: { category: "Single", glassType: "ID1", thickness: "12" }, orderIndex } }), 201)).selection;
    const [s0, s1] = [await mk(0), await mk(1)];
    const L = nm({ run }, "S-renamed");
    const u = (await ok<{ selection: Selection }>(await as.member.patch(url(`/selections/${s0.id}`), { data: { label: ` ${L} `, config: { category: "Glazed" }, orderIndex: 9, componentTypeId: door } }))).selection;
    expect(u).toMatchObject({ id: s0.id, label: L, config: { category: "Glazed" }, orderIndex: 0, componentTypeId: glass });
    const lbl = (await ok<{ selection: Selection }>(await as.admin.patch(url(`/selections/${s0.id}`), { data: { label: `${L}-2` } }))).selection;
    expect(lbl.config).toEqual({ category: "Glazed" }); // label-only PATCH leaves config alone
    const list = (await ok<{ selections: Selection[] }>(await as.admin.get(url(`/selections?projectId=${p.id}`)))).selections;
    expect(list.map((s) => [s.id, s.orderIndex])).toEqual([[s0.id, 0], [s1.id, 1]]);
    await rejected(await as.admin.patch(url(`/selections/${s1.id}`), { data: { orderIndex: 0 } }), 400, "At least one of label or config must be provided");
  });

  test("PATCH rejects a blank label (400), as create does; the stored label is unchanged", async ({ as, f, url }) => {
    const p = await f.project();
    const s = await f.selection(p.id, "GLASS", {});
    const labelOf = async () => (await ok<{ selections: Selection[] }>(await as.admin.get(url(`/selections?projectId=${p.id}`)))).selections.find((x) => x.id === s.id)!.label;
    const before = await labelOf();
    await rejected(await as.admin.patch(url(`/selections/${s.id}`), { data: { label: "   " } }), 400, "label must not be blank");
    expect(await labelOf()).toBe(before);
  });

  test("invalidation: create, label PATCH and DELETE keep designSubmittedAt + calculation; a config PATCH clears both", async ({ as, f, run, url }) => {
    const p = await f.project();
    await armSubmitted(p.id);
    const glass = await typeId(as.admin, run, "GLASS");
    const s = (await ok<{ selection: Selection }>(await as.admin.post(url("/selections"), { data: { projectId: p.id, componentTypeId: glass, label: nm({ run }, "S"), config: { category: "Single" } } }), 201)).selection;
    const spare = (await ok<{ selection: Selection }>(await as.admin.post(url("/selections"), { data: { projectId: p.id, componentTypeId: glass, label: nm({ run }, "S2"), config: {} } }), 201)).selection;
    await ok(await as.admin.patch(url(`/selections/${s.id}`), { data: { label: nm({ run }, "S-lbl") } }));
    await ok(await as.admin.delete(url(`/selections/${spare.id}`)));
    expect(await readProjectState(p.id)).toMatchObject({ designSubmittedAt: expect.any(String), calcCount: 1 });
    await ok(await as.admin.patch(url(`/selections/${s.id}`), { data: { config: { category: "Glazed" } } }));
    expect(await readProjectState(p.id)).toMatchObject({ designSubmittedAt: null, calcCount: 0 });
  });

  /** Finds, in the project's frozen snapshot, a dependent choice field and a config whose child value is not allowed under its parent's value. */
  async function badCombo(as: Ctx["as"], run: Ctx["run"], url: (p: string) => string, projectId: string) {
    type F = { key: string; type: string; dependsOn?: string };
    type T = { id: string; code: string; fieldsSchema: F[]; fieldOptionsConfig: Record<string, { options?: string[]; valueMap?: Record<string, string[]> }> | null };
    const snap = (await ok<{ project: { configSnapshot: { componentTypes: T[] } } }>(await as.admin.get(url(`/projects/${projectId}`)))).project.configSnapshot;
    // find a dependent choice field whose parent value P has a valueMap branch; pick a child value that
    // another branch allows but P does not (falls back to a value no branch has)
    for (const t of snap.componentTypes) {
      for (const fd of t.fieldsSchema ?? []) {
        const vm = t.fieldOptionsConfig?.[fd.key]?.valueMap;
        if (!fd.dependsOn || !vm) continue;
        const parents = Object.keys(vm).filter((k) => vm[k].length > 0);
        if (!parents.length) continue;
        const P = parents[0];
        const elsewhere = parents.flatMap((k) => vm[k]).find((v) => !vm[P].includes(v));
        return { type: t, childKey: fd.key, config: { [fd.dependsOn]: P, [fd.key]: elsewhere ?? `${run.prefix}not-an-option` } as Record<string, string> };
      }
    }
    throw new Error("the Test Org's configSnapshot has no dependent (dependsOn) choice field with a valueMap — the probe needs one");
  }

  test("create: config VALUES are validated — an option outside the snapshot's options / dependsOn valueMap → 400, nothing created", async ({ as, f, run, url }) => {
    const p = await f.project();
    const pick = await badCombo(as, run, url, p.id);
    const r = await as.admin.post(url("/selections"), { data: { projectId: p.id, componentTypeId: pick.type.id, label: nm({ run }, "S-badopt"), config: pick.config } });
    expect(r.status(), await r.text()).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe(`Invalid configuration: "${pick.childKey}" has a value that is not one of its configured options.`);
    // an unknown key is rejected too
    await rejected(
      await as.admin.post(url("/selections"), { data: { projectId: p.id, componentTypeId: pick.type.id, label: nm({ run }, "S-badkey"), config: { rgrNoSuchField: "x" } } }),
      400,
      'Invalid configuration: Unknown configuration field "rgrNoSuchField".',
    );
    expect((await ok<{ selections: Selection[] }>(await as.admin.get(url(`/selections?projectId=${p.id}`)))).selections).toEqual([]);
  });

  test("update: PATCH config is validated against the project's snapshot — out-of-option value / unknown key → 400, stored config unchanged; label-only is unaffected", async ({ as, f, run, url, orgB }) => {
    const p = await f.project();
    const pick = await badCombo(as, run, url, p.id);
    const s = (await ok<{ selection: Selection }>(await as.admin.post(url("/selections"), { data: { projectId: p.id, componentTypeId: pick.type.id, label: nm({ run }, "S-upd"), config: {} } }), 201)).selection;
    const stored = async () => (await ok<{ selections: Selection[] }>(await as.admin.get(url(`/selections?projectId=${p.id}`)))).selections.find((x) => x.id === s.id)!;
    const r = await as.admin.patch(url(`/selections/${s.id}`), { data: { config: pick.config } });
    expect(r.status(), await r.text()).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe(`Invalid configuration: "${pick.childKey}" has a value that is not one of its configured options.`);
    await rejected(await as.admin.patch(url(`/selections/${s.id}`), { data: { config: { rgrNoSuchField: "x" } } }), 400, 'Invalid configuration: Unknown configuration field "rgrNoSuchField".');
    expect((await stored()).config).toEqual({});
    // a label-only PATCH does not touch config validation
    await ok(await as.admin.patch(url(`/selections/${s.id}`), { data: { label: nm({ run }, "S-renamed") } }));
    // a foreign/unknown id is a 404 even with an invalid config (ownership runs first)
    await rejected(await as.admin.patch(url(`/selections/${(await foreignTree({ run, orgB })).selectionId}`), { data: { config: { rgrNoSuchField: "x" } } }), 404, "Selection not found or access denied");
  });
});

test.describe("selections: delete / tenancy / roles / status", () => {
  test("DELETE: in use by cells and stops → 409 with the reference count (across rooms); unassigned → 200 {id}; then 404", async ({ as, f, run, url }) => {
    const w = await f.wall();
    const glass = await typeId(as.admin, run, "GLASS");
    const s = (await ok<{ selection: Selection }>(await as.admin.post(url("/selections"), { data: { projectId: w.projectId, componentTypeId: glass, label: nm({ run }, "S"), config: {} } }), 201)).selection;
    // a second wall in a second room of the same project
    const rm2 = (await ok<{ room: { id: string } }>(await as.admin.post(url("/rooms"), { data: { floorId: w.floorId, label: nm({ run }, "R2") } }), 201)).room;
    const sides = await ok<{ room: { sides: { partitionId: string | null }[] } }>(
      await as.admin.patch(url(`/rooms/${rm2.id}/sides`), {
        data: { sides: [{ kind: "PARTITION", turnDegrees: 90, label: nm({ run }, "W2"), heightMm: 2400, widthMm: 1000 }, { kind: "PLAIN" }, { kind: "PLAIN" }] },
      }),
    );
    const p2 = sides.room.sides[0].partitionId!;
    await ok(await as.admin.patch(url(`/partitions/${w.partitionId}`), { data: { design: { ...design([{ w: 1000, cells: [[2400, s.id]] }, { w: 1000, cells: [[1200, s.id], [1200, null]] }]), stops: { top: s.id } } } }));
    await ok(await as.admin.patch(url(`/partitions/${p2}`), { data: { design: design([{ w: 1000, cells: [[2400, s.id]] }]) } }));

    const inUse = (n: number) => `This component is used on ${n} wall/panel(s) in Design — remove those assignments first.`;
    await rejected(await as.member.delete(url(`/selections/${s.id}`)), 409, inUse(4));
    await ok(await as.admin.patch(url(`/partitions/${p2}`), { data: { design: design([{ w: 1000, cells: [[2400, null]] }]) } }));
    await ok(await as.admin.patch(url(`/partitions/${w.partitionId}`), { data: { design: { ...design([{ w: 2000, cells: [[2400, null]] }]), stops: { top: s.id } } } }));
    await rejected(await as.member.delete(url(`/selections/${s.id}`)), 409, inUse(1));
    await ok(await as.admin.patch(url(`/partitions/${w.partitionId}`), { data: { design: { stops: { top: null } } } }));

    expect(await ok(await as.member.delete(url(`/selections/${s.id}`)))).toEqual({ id: s.id });
    expect((await ok<{ selections: Selection[] }>(await as.admin.get(url(`/selections?projectId=${w.projectId}`)))).selections).toEqual([]);
    await rejected(await as.admin.delete(url(`/selections/${s.id}`)), 404, "Selection not found or access denied");
    await rejected(await as.admin.patch(url(`/selections/${s.id}`), { data: { label: "rgr-gone" } }), 404, "Selection not found or access denied");
  });

  test("cross-tenant: org B's selection under the Test-Org slug → 404; its project lists []; org-B type/project on create → 400; org B row untouched", async ({ as, f, run, orgB, url }) => {
    const t = await foreignTree({ run, orgB });
    const B = (p: string) => orgApi(run.orgB.slug, p);
    const before = (await ok<{ selections: Selection[] }>(await orgB.get(B(`/selections?projectId=${t.projectId}`)))).selections.find((s) => s.id === t.selectionId)!;
    const calls: Array<[string, () => Promise<APIResponse>]> = [
      ["PATCH", () => as.admin.patch(url(`/selections/${t.selectionId}`), { data: { label: `${run.prefix}hijack`, config: { x: "y" } } })],
      ["DELETE", () => as.admin.delete(url(`/selections/${t.selectionId}`))],
    ];
    for (const [what, call] of calls) {
      const r = await call();
      expect(r.status(), what).toBe(404);
      expect(await r.json(), what).toEqual({ error: "Selection not found or access denied" });
    }
    expect((await ok<{ selections: unknown[] }>(await as.admin.get(url(`/selections?projectId=${t.projectId}`)))).selections).toEqual([]);
    const p = await f.project();
    await rejected(await as.admin.post(url("/selections"), { data: { projectId: p.id, componentTypeId: t.componentTypeId, label: `${run.prefix}x` } }), 400, "Component type not found or access denied.");
    await rejected(await as.admin.post(url("/selections"), { data: { projectId: t.projectId, componentTypeId: await typeId(as.admin, run, "GLASS"), label: `${run.prefix}x` } }), 400, "Project not found or access denied.");
    expect((await ok<{ selections: unknown[] }>(await as.admin.get(url(`/selections?projectId=${p.id}`)))).selections).toEqual([]);

    const after = (await ok<{ selections: Selection[] }>(await orgB.get(B(`/selections?projectId=${t.projectId}`)))).selections.find((s) => s.id === t.selectionId)!;
    expect(after).toEqual(before);
    // and the reverse: org B cannot see or touch a Test-Org selection through its own slug
    const mine = await f.selection(p.id, "GLASS", {});
    expect((await ok<{ selections: unknown[] }>(await orgB.get(B(`/selections?projectId=${p.id}`)))).selections).toEqual([]);
    await rejected(await orgB.patch(B(`/selections/${mine.id}`), { data: { label: `${run.prefix}hijack` } }), 404, "Selection not found or access denied");
    await rejected(await orgB.delete(B(`/selections/${mine.id}`)), 404, "Selection not found or access denied");
    expect((await ok<{ selections: Selection[] }>(await as.admin.get(url(`/selections?projectId=${p.id}`)))).selections.map((s) => s.id)).toEqual([mine.id]);
  });

  test("missing projectId → 400; an unknown project lists []", async ({ as, url }) => {
    await rejected(await as.admin.get(url("/selections")), 400, "projectId query parameter is required");
    expect((await ok<{ selections: unknown[] }>(await as.admin.get(url(`/selections?projectId=${GHOST}`)))).selections).toEqual([]);
  });

  test("any org member configures: distributor and architect create/patch/delete on their own company's project", async ({ as, run, ledger, url }) => {
    const co = await distributorCompanyId({ run, as });
    const glass = await typeId(as.admin, run, "GLASS");
    for (const who of ["distributor", "architect"] as const) {
      const g = as[who];
      const { id: projectId, body } = await createLedgered(g, { run, ledger }, "project", { name: nm({ run }, `p-${who}`), currency: "AED" });
      expect(projectId, JSON.stringify(body)).not.toBeNull();
      expect((body.project as { externalCompanyId: string }).externalCompanyId).toBe(co);
      const s = (await ok<{ selection: Selection }>(await g.post(url("/selections"), { data: { projectId, componentTypeId: glass, label: nm({ run }, "S"), config: {} } }), 201)).selection;
      await ok(await g.patch(url(`/selections/${s.id}`), { data: { config: { category: "Single" } } }));
      expect((await ok<{ selections: Selection[] }>(await g.get(url(`/selections?projectId=${projectId}`)))).selections.map((x) => x.id)).toEqual([s.id]);
      expect(await ok(await g.delete(url(`/selections/${s.id}`)))).toEqual({ id: s.id });
    }
  });

  test("an external user cannot list, create, edit or delete selections on another company's project (foreign parent looks like a missing one)", async ({ as, f, run, ledger, url }) => {
    // Fixed by Hotfix 2026-10-05 (HF-3/HF-4, backlog 2026-10-04 "Cross-company access by id"): selections are
    // scoped through the owning project's company. Every foreign request answers like a random UUID would.
    const otherCo = await f.externalCompany();
    const { id: projectId, body } = await createLedgered(as.admin, { run, ledger }, "project", { name: nm({ run }, "p-idor"), currency: "AED", externalCompanyId: otherCo.id });
    expect(projectId, JSON.stringify(body)).not.toBeNull();
    const own = await f.selection(projectId!, "GLASS", {});
    const glass = await typeId(as.admin, run, "GLASS");
    const before = (await ok<{ selections: Selection[] }>(await as.admin.get(url(`/selections?projectId=${projectId}`)))).selections;
    expect(before.map((s) => s.id)).toEqual([own.id]);
    for (const who of ["distributor", "architect"] as const) {
      const g = as[who];
      const same = async (foreign: APIResponse, ghost: APIResponse, what: string) => {
        expect([foreign.status(), await foreign.text()], `${who} ${what}`).toEqual([ghost.status(), await ghost.text()]);
      };
      await same(await g.get(url(`/selections?projectId=${projectId}`)), await g.get(url(`/selections?projectId=${GHOST}`)), "GET list");
      const mk = (pid: string) => ({ data: { projectId: pid, componentTypeId: glass, label: nm({ run }, `S-by-${who}`), config: {} } });
      const created = await g.post(url("/selections"), mk(projectId!));
      await same(created, await g.post(url("/selections"), mk(GHOST)), "POST");
      expect(created.status(), `${who} POST`).toBe(400);
      await same(await g.patch(url(`/selections/${own.id}`), { data: { label: nm({ run }, `S-ren-${who}`) } }), await g.patch(url(`/selections/${GHOST}`), { data: { label: nm({ run }, `S-ren-${who}`) } }), "PATCH");
      await same(await g.delete(url(`/selections/${own.id}`)), await g.delete(url(`/selections/${GHOST}`)), "DELETE");
    }
    // ... and nothing was written: the owner-side list is unchanged.
    expect((await ok<{ selections: Selection[] }>(await as.admin.get(url(`/selections?projectId=${projectId}`)))).selections).toEqual(before);
  });

  test("DECISION NEEDED: selection writes are not DRAFT-gated — a SUBMITTED project still accepts create / PATCH / DELETE", async ({ as, f, run, url }) => {
    const p = await f.project();
    const glass = await typeId(as.admin, run, "GLASS");
    try {
      await rgrSetProjectStatus(p.id, "SUBMITTED");
      // DECISION NEEDED (not a confirmed bug) — createSelection/updateSelection/deleteSelection never check
      // Project.status (project PATCH/DELETE/reset/config-update are DRAFT-only, 409; the design tree has no
      // gate either, by Stage 19's choice). Pins today's behaviour; if gated, change each of these to 409.
      const s = (await ok<{ selection: Selection }>(await as.admin.post(url("/selections"), { data: { projectId: p.id, componentTypeId: glass, label: nm({ run }, "S"), config: {} } }), 201)).selection;
      await ok(await as.admin.patch(url(`/selections/${s.id}`), { data: { config: { category: "Single" } } }));
      expect(await ok(await as.admin.delete(url(`/selections/${s.id}`)))).toEqual({ id: s.id });
    } finally {
      await rgrSetProjectStatus(p.id, "DRAFT"); // teardown deletes through the DRAFT-only route
    }
  });

  test("a fractional orderIndex is truncated by the Int column (1.5 → 1)", async ({ as, f, run, url }) => {
    const p = await f.project();
    const glass = await typeId(as.admin, run, "GLASS");
    const s = (await ok<{ selection: Selection }>(await as.admin.post(url("/selections"), { data: { projectId: p.id, componentTypeId: glass, label: nm({ run }, "S-frac"), config: {}, orderIndex: 1.5 } }), 201)).selection;
    expect(s.orderIndex).toBe(1);
  });
});
