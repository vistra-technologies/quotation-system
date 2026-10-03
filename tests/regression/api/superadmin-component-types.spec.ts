/**
 * SuperAdmin component types + categories (Task 11, Step 2) — CRUD against this run's org B ONLY.
 *
 * The Test Org's real types are never written (so no TEST_ORG_CONFIG_LOCK is needed here): the Test Org
 * appears only in READS and as the `orgId` of cross-org probes that address an org-B type THIS test
 * created — if that tenancy check ever broke, the write would land on the suite's own type.
 * Types created here are `RGR-<RUNID>-…` codes in org B: not ledgered (the Cleaner has no type deleter and
 * none is needed) — the tests delete what they can and org B's teardown hard-delete cascades the rest.
 *
 * The formula-set guard probes on org B's GLASS (code change, deactivate, delete) are refused today; each
 * runs in try/finally that restores GLASS from its recorded row should one ever be accepted — the same
 * trade-off as catalog.spec's org-side guard probes (org B is throwaway; the test fails loudly).
 *
 * "code edit blocked for the seeded codes" (plan) no longer exists: hotfix H-13 lifted the seeded-code
 * rename lock. What remains is the formula-set guard (a code the org's active set references cannot change)
 * — asserted on GLASS — while a type outside the set changes code freely (asserted on the suite's own type).
 */
import { covers } from "../fixtures/covers";
import { Guarded, createAllowance, type SaClient } from "../fixtures/clients";
import type { RunState } from "../fixtures/run-state";
import { orgApi } from "./project-helpers";
import { test, expect, SA, GHOST, tag, expectStatus, json, auditLog } from "./sa-helpers";

covers("GET /api/v1/superadmin/component-categories");
covers("GET /api/v1/superadmin/component-types");
covers("POST /api/v1/superadmin/component-types");
covers("GET /api/v1/superadmin/component-types/[typeId]");
covers("PATCH /api/v1/superadmin/component-types/[typeId]");
covers("DELETE /api/v1/superadmin/component-types/[typeId]");
covers("POST /api/v1/superadmin/component-types/[typeId]/reorder");

type Field = { key: string; label: string; type: string; required: boolean; basic: boolean; options?: string[]; dependsOn?: string; hint?: string };
type CType = {
  id: string; organizationId: string; code: string; name: string; active: boolean; categoryId: string;
  category: { id: string; name: string }; fieldsSchema: Field[]; sortOrder: number; createdAt: string; updatedAt: string;
};
type Category = { id: string; name: string; organizationId: string };

const SCHEMA = [
  { key: "rgrFrame", label: "Frame", type: "dropdown", required: true },
  { key: "rgrFinish", label: "Finish", type: "radio", dependsOn: "rgrFrame" },
  { key: "rgrNote", label: "Note", type: "field", hint: "free text" },
];
/** What the DAL stores/echoes for SCHEMA (parseFieldsSchema: required/basic defaults, options [] on choice fields). */
const SCHEMA_ECHO: Field[] = [
  { key: "rgrFrame", label: "Frame", type: "dropdown", required: true, basic: true, options: [] },
  { key: "rgrFinish", label: "Finish", type: "radio", required: false, basic: true, options: [], dependsOn: "rgrFrame" },
  { key: "rgrNote", label: "Note", type: "field", required: false, basic: true, hint: "free text" },
];

async function types(sa: Guarded, orgId: string): Promise<CType[]> {
  return (await json<{ componentTypes: CType[] }>(await sa.get(`${SA}/component-types?orgId=${orgId}`))).componentTypes;
}
async function getType(sa: Guarded, id: string, orgId: string): Promise<CType> {
  return (await json<{ componentType: CType }>(await sa.get(`${SA}/component-types/${id}?orgId=${orgId}`))).componentType;
}
async function categories(sa: Guarded, orgId: string): Promise<Category[]> {
  return (await json<{ categories: Category[] }>(await sa.get(`${SA}/component-categories?orgId=${orgId}`))).categories;
}
const codeFor = (run: RunState) => `${run.prefix}ct-${tag()}`.toUpperCase();
/** SA-create an org-B type (code RGR-<RUNID>-CT-…). */
async function newType(sa: Guarded, run: RunState, extra: Record<string, unknown> = {}): Promise<CType> {
  const categoryId = (await categories(sa, run.orgB.id))[0].id;
  const code = codeFor(run);
  return (await json<{ componentType: CType }>(await sa.post(`${SA}/component-types`, { data: { orgId: run.orgB.id, code, name: `${code} name`, categoryId, ...extra } }), 201, "create type")).componentType;
}
/** Allowed to send the Test Org's id as `orgId` — ONLY ever with an org-B type id this test created. */
const crossOrg = (sa: SaClient, run: RunState) => new Guarded(sa.ctx, createAllowance([], [run.testOrg.id]), { Cookie: `qs-sa-token=${sa.token}` });
const ghostClient = (sa: SaClient) => new Guarded(sa.ctx, createAllowance([], [GHOST]), { Cookie: `qs-sa-token=${sa.token}` });
/** Raw-context options with the SA cookie — only for bodies WITHOUT an orgId (the guard cannot attribute them; the server rejects them). */
const rawSa = (sa: SaClient, data: unknown) => ({ data, headers: { Cookie: `qs-sa-token=${sa.token}` } });
const byOrder = (a: CType, b: CType) => a.sortOrder - b.sortOrder || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

const INVALID_SCHEMAS: Array<[string, unknown[], RegExp]> = [
  ["options are SuperAdmin-forbidden", [{ key: "a", label: "A", type: "dropdown", options: ["x"] }], /"options" is no longer accepted here/],
  ["unknown type", [{ key: "a", label: "A", type: "slider" }], /unknown type "slider"/],
  ["non-object entry", [null], /each entry must be an object/],
  ["duplicate keys", [{ key: "a", label: "A", type: "field" }, { key: "a", label: "B", type: "field" }], /is used by more than one field/],
  ["dependsOn on a plain field", [{ key: "a", label: "A", type: "dropdown" }, { key: "b", label: "B", type: "field", dependsOn: "a" }], /only valid on dropdown\/radio fields/],
  ["dependsOn unknown key", [{ key: "b", label: "B", type: "dropdown", dependsOn: "zz" }], /references unknown field key "zz"/],
  ["dependsOn a later field", [{ key: "b", label: "B", type: "dropdown", dependsOn: "a" }, { key: "a", label: "A", type: "dropdown" }], /must reference a field earlier/],
  ["dependsOn a non-choice parent", [{ key: "a", label: "A", type: "checkbox" }, { key: "b", label: "B", type: "radio", dependsOn: "a" }], /must be a dropdown\/radio field/],
];

test.describe("GET /api/v1/superadmin/component-categories", () => {
  test("400 without orgId, 404 unknown org; org B's categories A→Z, all org B's, disjoint from the Test Org's", async ({ sa, run }) => {
    expect((await json<{ error: string }>(await sa.get(`${SA}/component-categories`), 400)).error).toBe("orgId query parameter is required");
    expect((await json<{ error: string }>(await sa.get(`${SA}/component-categories?orgId=${GHOST}`), 404)).error).toBe("Organization not found");
    const b = await categories(sa, run.orgB.id);
    expect(b.length).toBeGreaterThan(0);
    const names = b.map((c) => c.name);
    expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y)));
    for (const c of b) expect(c.organizationId).toBe(run.orgB.id);
    const t = new Set((await categories(sa, run.testOrg.id)).map((c) => c.id));
    expect(b.filter((c) => t.has(c.id))).toEqual([]);
  });
});

test.describe("SuperAdmin component types (org B)", () => {
  test("GET list: 400 / 404 rules; org B's types in sortOrder→code order with category and parsed schema; disjoint from the Test Org's", async ({ sa, run }) => {
    expect((await json<{ error: string }>(await sa.get(`${SA}/component-types`), 400)).error).toBe("orgId query parameter is required");
    expect((await json<{ error: string }>(await sa.get(`${SA}/component-types?orgId=${GHOST}`), 404)).error).toBe("Organization not found");
    const b = await types(sa, run.orgB.id);
    expect(b.map((t) => t.id)).toEqual([...b].sort(byOrder).map((t) => t.id));
    expect(b.some((t) => t.code === "GLASS")).toBe(true);
    for (const t of b) {
      expect(t.organizationId).toBe(run.orgB.id);
      expect(t.category.id).toBe(t.categoryId);
      expect(Array.isArray(t.fieldsSchema)).toBe(true);
    }
    const tIds = new Set((await types(sa, run.testOrg.id)).map((t) => t.id));
    expect(b.filter((t) => tIds.has(t.id))).toEqual([]);
  });

  test("POST creates (201): code trimmed + upper-cased, name trimmed, active defaults true, appended last; GET equals; org B's palette lists it; audit", async ({ sa, run, orgB }) => {
    const before = await types(sa, run.orgB.id);
    const categoryId = (await categories(sa, run.orgB.id))[0].id;
    const code = codeFor(run);
    const t = (await json<{ componentType: CType }>(
      await sa.post(`${SA}/component-types`, { data: { orgId: run.orgB.id, code: `  ${code.toLowerCase()} `, name: "  Rgr Type  ", categoryId, fieldsSchema: SCHEMA } }),
      201,
    )).componentType;
    expect(t).toMatchObject({ organizationId: run.orgB.id, code, name: "Rgr Type", active: true, categoryId, fieldsSchema: SCHEMA_ECHO });
    expect(t.sortOrder).toBeGreaterThan(Math.max(-1, ...before.map((x) => x.sortOrder)));
    expect(await getType(sa, t.id, run.orgB.id)).toEqual(t);
    expect((await types(sa, run.orgB.id)).find((x) => x.id === t.id)).toEqual(t);
    const palette = (await json<{ componentTypes: { id: string; code: string }[] }>(await orgB.get(orgApi(run.orgB.slug, "/component-types")))).componentTypes;
    expect(palette.find((x) => x.id === t.id)?.code).toBe(code);
    // the Test Org cannot see it (read probe)
    await expectStatus(await sa.get(`${SA}/component-types/${t.id}?orgId=${run.testOrg.id}`), 404, "Test Org view");

    // active:false is stored; a non-array fieldsSchema is stored as []
    const off = await newType(sa, run, { active: false, fieldsSchema: "nope" });
    expect(off).toMatchObject({ active: false, fieldsSchema: [] });

    const log = await auditLog(sa, { scope: "org", orgId: run.orgB.id, item: "Component type", verb: "INSERT", pageSize: 100 });
    expect(log.entries.find((e) => e.targetId === t.id)).toMatchObject({ action: "componentType.create", entity: code, org: { id: run.orgB.id } });
  });

  test("POST rules: required fields, blank code/name, every fieldsSchema rule, another org's category → 400; unknown org → 404; nothing created", async ({ sa, run }) => {
    const categoryId = (await categories(sa, run.orgB.id))[0].id;
    const testCat = (await categories(sa, run.testOrg.id))[0].id;
    const p = `${run.prefix}ctx-`.toUpperCase();
    const ok = { orgId: run.orgB.id, name: "rgr bad", categoryId };
    const cases: Array<[string, Record<string, unknown>, number, string | RegExp]> = [
      ["missing code", { ...ok }, 400, "orgId, code, name, and categoryId are required"],
      ["missing categoryId", { ...ok, categoryId: undefined, code: `${p}1` }, 400, "orgId, code, name, and categoryId are required"],
      ["blank code", { ...ok, code: "  " }, 400, "code is required"],
      ["blank name", { ...ok, code: `${p}2`, name: " " }, 400, "name is required"],
      ["blank categoryId", { ...ok, code: `${p}3`, categoryId: " " }, 400, "categoryId is required"],
      ["Test-Org category", { ...ok, code: `${p}4`, categoryId: testCat }, 400, "Category not found or does not belong to this organization"],
      ...INVALID_SCHEMAS.map(([what, fieldsSchema, msg], i): [string, Record<string, unknown>, number, RegExp] => [what, { ...ok, code: `${p}s${i}`, fieldsSchema }, 400, msg]),
    ];
    for (const [what, data, status, msg] of cases) {
      const e = (await json<{ error: string }>(await sa.post(`${SA}/component-types`, { data }), status, what)).error;
      if (typeof msg === "string") expect(e, what).toBe(msg);
      else expect(e, what).toMatch(msg);
    }
    expect((await json<{ error: string }>(await ghostClient(sa).post(`${SA}/component-types`, { data: { ...ok, orgId: GHOST, code: `${p}5` } }), 404)).error).toBe("Organization not found");
    expect((await json<{ error: string }>(await sa.ctx.post(`${SA}/component-types`, rawSa(sa, { code: `${p}6`, name: "x", categoryId })), 400)).error).toBe("orgId, code, name, and categoryId are required");
    expect((await types(sa, run.orgB.id)).filter((t) => t.code.startsWith(p))).toEqual([]);
  });

  // KNOWN BUG — the SA POST route does not map the (organizationId, code) unique violation (P2002) — PATCH
  // does (409 "code already in use in this org"). Nothing is written. When fixed, expect 409 here.
  test("KNOWN BUG: POST with a code already used in the org answers 500 (unmapped P2002), not 409", async ({ sa, run }) => {
    const mine = await newType(sa, run);
    const r = await sa.post(`${SA}/component-types`, { data: { orgId: run.orgB.id, code: mine.code.toLowerCase(), name: "rgr dup", categoryId: mine.categoryId } });
    await expectStatus(r, 500);
    expect((await types(sa, run.orgB.id)).filter((t) => t.code === mine.code)).toHaveLength(1);
  });

  test("GET by id: orgId required; unknown id / another org's view → 404", async ({ sa, run }) => {
    const mine = await newType(sa, run);
    expect((await json<{ error: string }>(await sa.get(`${SA}/component-types/${mine.id}`), 400)).error).toBe("orgId query parameter is required");
    expect((await json<{ error: string }>(await sa.get(`${SA}/component-types/${GHOST}?orgId=${run.orgB.id}`), 404)).error).toBe("ComponentType not found");
    expect((await json<{ error: string }>(await sa.get(`${SA}/component-types/${mine.id}?orgId=${GHOST}`), 404)).error).toBe("Organization not found");
  });

  test("PATCH: partial updates (name trimmed, code normalised, active, schema, category) → 200; audit componentType.update", async ({ sa, run }) => {
    const mine = await newType(sa, run);
    const url = `${SA}/component-types/${mine.id}`;
    const r1 = (await json<{ componentType: CType }>(await sa.patch(url, { data: { orgId: run.orgB.id, name: "  Renamed  " } }))).componentType;
    expect(r1).toMatchObject({ name: "Renamed", code: mine.code, active: true, sortOrder: mine.sortOrder, categoryId: mine.categoryId });
    const newCode = codeFor(run);
    const r2 = (await json<{ componentType: CType }>(await sa.patch(url, { data: { orgId: run.orgB.id, code: `  ${newCode.toLowerCase()} `, active: false, fieldsSchema: SCHEMA } }))).componentType;
    expect(r2).toMatchObject({ code: newCode, active: false, name: "Renamed", fieldsSchema: SCHEMA_ECHO });
    const cats = await categories(sa, run.orgB.id);
    const other = cats.find((c) => c.id !== mine.categoryId);
    if (other) {
      expect((await json<{ componentType: CType }>(await sa.patch(url, { data: { orgId: run.orgB.id, categoryId: other.id } }))).componentType.category).toEqual({ id: other.id, name: other.name });
    }
    expect(await getType(sa, mine.id, run.orgB.id)).toMatchObject({ code: newCode, name: "Renamed", active: false });
    const log = await auditLog(sa, { scope: "org", orgId: run.orgB.id, item: "Component type", verb: "UPDATE", pageSize: 100 });
    expect(log.entries.filter((e) => e.targetId === mine.id && e.action === "componentType.update").length).toBe(other ? 3 : 2);
  });

  test("PATCH rules: taken code → 409; bad schema / foreign category → 400; unknown type / org → 404; another org's view → 404 (unchanged)", async ({ sa, run }) => {
    const mine = await newType(sa, run);
    const url = `${SA}/component-types/${mine.id}`;
    expect((await json<{ error: string }>(await sa.patch(url, { data: { orgId: run.orgB.id, code: "glass" } }), 409)).error).toBe("code already in use in this org");
    for (const [what, fieldsSchema, msg] of INVALID_SCHEMAS) {
      expect((await json<{ error: string }>(await sa.patch(url, { data: { orgId: run.orgB.id, fieldsSchema } }), 400, what)).error, what).toMatch(msg);
    }
    const testCat = (await categories(sa, run.testOrg.id))[0].id;
    expect((await json<{ error: string }>(await sa.patch(url, { data: { orgId: run.orgB.id, categoryId: testCat } }), 400)).error).toBe("Category not found or does not belong to this organization");
    expect((await json<{ error: string }>(await sa.patch(`${SA}/component-types/${GHOST}`, { data: { orgId: run.orgB.id, name: "x" } }), 404)).error).toBe("ComponentType not found");
    expect((await json<{ error: string }>(await ghostClient(sa).patch(url, { data: { orgId: GHOST, name: "x" } }), 404)).error).toBe("Organization not found");
    expect((await json<{ error: string }>(await crossOrg(sa, run).patch(url, { data: { orgId: run.testOrg.id, name: "rgr hijacked" } }), 404)).error).toBe("ComponentType not found");
    expect((await json<{ error: string }>(await sa.ctx.patch(url, rawSa(sa, { name: "x" })), 400)).error).toBe("orgId is required");
    expect(await getType(sa, mine.id, run.orgB.id)).toEqual(mine); // every reject left it untouched
  });

  test("formula-set guard: org B's GLASS (a slot of its active set) cannot change code or be deactivated (409); the row is unchanged", async ({ sa, run }) => {
    const glass = (await types(sa, run.orgB.id)).find((t) => t.code === "GLASS")!;
    const url = `${SA}/component-types/${glass.id}`;
    try {
      for (const [what, data] of [["code change", { code: `${run.prefix}glass2` }], ["deactivate", { active: false }]] as const) {
        const e = (await json<{ error: string }>(await sa.patch(url, { data: { orgId: run.orgB.id, ...data } }), 409, what)).error;
        expect(e.length, what).toBeGreaterThan(0);
      }
    } finally {
      const now = await getType(sa, glass.id, run.orgB.id);
      if (now.code !== glass.code || now.active !== glass.active) {
        await sa.patch(url, { data: { orgId: run.orgB.id, code: glass.code, active: glass.active } }); // only if a probe slipped through
      }
    }
    const after = await getType(sa, glass.id, run.orgB.id);
    expect({ code: after.code, active: after.active, fieldsSchema: after.fieldsSchema }).toEqual({ code: glass.code, active: glass.active, fieldsSchema: glass.fieldsSchema });
  });

  test("DELETE: own type → 200 { ok: true }, then 404 everywhere; rules 400/404; another org's view → 404 (kept); audit componentType.delete", async ({ sa, run }) => {
    const mine = await newType(sa, run);
    const keep = await newType(sa, run);
    expect((await json<{ error: string }>(await sa.ctx.delete(`${SA}/component-types/${mine.id}`, { headers: { Cookie: `qs-sa-token=${sa.token}` } }), 400)).error).toBe("orgId query parameter is required");
    expect((await json<{ error: string }>(await crossOrg(sa, run).delete(`${SA}/component-types/${keep.id}?orgId=${run.testOrg.id}`), 404)).error).toBe("ComponentType not found");
    expect(await getType(sa, keep.id, run.orgB.id)).toEqual(keep);
    expect((await json<{ error: string }>(await ghostClient(sa).delete(`${SA}/component-types/${mine.id}?orgId=${GHOST}`), 404)).error).toBe("Organization not found");

    expect(await json(await sa.delete(`${SA}/component-types/${mine.id}?orgId=${run.orgB.id}`))).toEqual({ ok: true });
    await expectStatus(await sa.get(`${SA}/component-types/${mine.id}?orgId=${run.orgB.id}`), 404, "get after delete");
    expect((await json<{ error: string }>(await sa.delete(`${SA}/component-types/${mine.id}?orgId=${run.orgB.id}`), 404)).error).toBe("ComponentType not found");
    expect((await types(sa, run.orgB.id)).some((t) => t.id === mine.id)).toBe(false);
    const log = await auditLog(sa, { scope: "org", orgId: run.orgB.id, item: "Component type", verb: "DELETE", pageSize: 100 });
    expect(log.entries.find((e) => e.targetId === mine.id)).toMatchObject({ action: "componentType.delete", entity: mine.code });
  });

  test("DELETE guards: a type used by a selection → 409 (with the count); GLASS (formula-set slot / in use) → 409; both kept", async ({ sa, run, orgB }) => {
    const used = await newType(sa, run); // empty schema → fully configured, selectable
    // a project created AFTER the type freezes it into configSnapshot; then one selection references it
    const pr = await orgB.post(orgApi(run.orgB.slug, "/projects"), { data: { name: `${run.prefix}ctproj-${tag()}`, currency: "AED", projectLocation: "Dubai, UAE" } });
    const projectId = (await json<{ project: { id: string } }>(pr, 201)).project.id; // org-B row: cascades with org B
    const sel = await orgB.post(orgApi(run.orgB.slug, "/selections"), { data: { projectId, componentTypeId: used.id, label: `${run.prefix}sel`, config: {}, orderIndex: 0 } });
    await expectStatus(sel, 201, "selection");
    expect((await json<{ error: string }>(await sa.delete(`${SA}/component-types/${used.id}?orgId=${run.orgB.id}`), 409)).error).toBe(
      "Cannot delete: this component type is used by 1 selection. Remove those selections first.",
    );
    expect(await getType(sa, used.id, run.orgB.id)).toEqual(used);

    const glass = (await types(sa, run.orgB.id)).find((t) => t.code === "GLASS")!;
    const r = await sa.delete(`${SA}/component-types/${glass.id}?orgId=${run.orgB.id}`);
    await expectStatus(r, 409, "GLASS delete");
    expect((await getType(sa, glass.id, run.orgB.id)).code).toBe("GLASS");
  });

  test("reorder: up / down swap sortOrder with the neighbour (SA list AND org palette follow); edge move is a no-op without audit; rules", async ({ sa, run, orgB }) => {
    await newType(sa, run);
    const b = await newType(sa, run);
    const list0 = await types(sa, run.orgB.id);
    const i = list0.findIndex((t) => t.id === b.id);
    const prev = list0[i - 1];
    const url = `${SA}/component-types/${b.id}/reorder`;

    expect(await json(await sa.post(url, { data: { orgId: run.orgB.id, direction: "up" } }))).toEqual({ ok: true, moved: true });
    const list1 = await types(sa, run.orgB.id);
    const idx = (l: CType[], id: string) => l.findIndex((t) => t.id === id);
    expect(idx(list1, b.id)).toBe(idx(list1, prev.id) - 1);
    expect(list1.find((t) => t.id === b.id)!.sortOrder).toBe(prev.sortOrder);
    expect(list1.find((t) => t.id === prev.id)!.sortOrder).toBe(b.sortOrder);
    // the org-facing palette is ordered by the same sortOrder: the ids both lists hold appear in the same order
    const palette = (await json<{ componentTypes: { id: string }[] }>(await orgB.get(orgApi(run.orgB.slug, "/component-types")))).componentTypes.map((t) => t.id);
    const saOrder = list1.map((t) => t.id).filter((id) => palette.includes(id));
    expect(palette.filter((id) => saOrder.includes(id))).toEqual(saOrder);
    expect(palette.indexOf(b.id)).toBeGreaterThanOrEqual(0);

    expect(await json(await sa.post(url, { data: { orgId: run.orgB.id, direction: "down" } }))).toEqual({ ok: true, moved: true });
    const list2 = await types(sa, run.orgB.id);
    expect(idx(list2, b.id)).toBe(idx(list2, prev.id) + 1);
    expect(list2.find((t) => t.id === b.id)!.sortOrder).toBe(b.sortOrder);

    // the first row cannot move up: 200 moved:false, nothing changes, no audit row
    const first = list2[0];
    expect(await json(await sa.post(`${SA}/component-types/${first.id}/reorder`, { data: { orgId: run.orgB.id, direction: "up" } }))).toEqual({ ok: true, moved: false });
    expect((await types(sa, run.orgB.id))[0].id).toBe(first.id);

    expect((await json<{ error: string }>(await sa.post(url, { data: { orgId: run.orgB.id, direction: "sideways" } }), 400)).error).toBe('direction must be "up" or "down"');
    expect((await json<{ error: string }>(await sa.post(url, { data: { orgId: run.orgB.id } }), 400)).error).toBe('direction must be "up" or "down"');
    expect((await json<{ error: string }>(await sa.ctx.post(url, rawSa(sa, { direction: "up" })), 400)).error).toBe("orgId is required");
    expect((await json<{ error: string }>(await sa.post(`${SA}/component-types/${GHOST}/reorder`, { data: { orgId: run.orgB.id, direction: "up" } }), 404)).error).toBe("ComponentType not found");
    expect((await json<{ error: string }>(await crossOrg(sa, run).post(url, { data: { orgId: run.testOrg.id, direction: "up" } }), 404)).error).toBe("ComponentType not found");
    expect((await json<{ error: string }>(await ghostClient(sa).post(url, { data: { orgId: GHOST, direction: "up" } }), 404)).error).toBe("Organization not found");

    const log = await auditLog(sa, { scope: "org", orgId: run.orgB.id, item: "Component type", verb: "UPDATE", pageSize: 100 });
    expect(log.entries.filter((e) => e.targetId === b.id && e.action === "componentType.reorder").length).toBe(2);
    expect(log.entries.filter((e) => e.targetId === first.id && e.action === "componentType.reorder")).toEqual([]);
  });
});
