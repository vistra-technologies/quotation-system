/**
 * Catalog: component categories, component types (org-facing routes) and their org-level field values
 * (`field-values`, Stage 20's ComponentTypeOrgConfig — the cascading-dropdown value lists).
 *
 * Gates (route source): GET component-categories / GET component-types (the configurator palette) → any
 * authenticated member; POST component-types, GET/PATCH component-types/[typeId], GET/PUT field-values →
 * MANAGE_FEATURES (admin only among the default roles).
 *
 * Shared state. The Test Org's ComponentTypes (GLASS, DOOR) and their field values are what every other
 * spec's projects freeze into `configSnapshot`, and there is no org-facing DELETE for a type. So:
 *   - Every Test-Org WRITE here (a DOOR rename, an identity field-values PUT) runs inside
 *     withRecordedGlobalState (original read first, restored exactly, verified; a failed revert is written
 *     to global-state-failures.json and fails the run) AND under TEST_ORG_CONFIG_LOCK, the cross-worker lock
 *     that projects.spec.ts's GLASS rename and its exact config-update diffs also hold.
 *   - Creating types, real field-value edits, validation 400s that sit AFTER the type lookup, the
 *     formula-set guard 409s and other edits run in throwaway org B (types created there go with org B).
 *   - Matrix `invalid` cases on Test-Org paths are only the ones rejected BEFORE any lookup/write.
 *   - ComponentType NAMES are never asserted for GLASS (projects.spec renames it for a short window).
 */
import { test, expect } from "../fixtures/test";
import { covers } from "../fixtures/covers";
import type { Guarded } from "../fixtures/clients";
import { globalStateFailuresFile, withRecordedGlobalState } from "../fixtures/global-state";
import { withLock, TEST_ORG_CONFIG_LOCK } from "../fixtures/config-lock";
import type { RunState } from "../fixtures/run-state";
import { registerNegatives, GHOST, type Ctx } from "./api-matrix";
import { orgApi, tag } from "./project-helpers";
import { ok, rejected } from "./design-helpers";
import { readConfigSnapshot } from "../../e2e/db-helpers";

covers("GET /api/v1/orgs/[orgSlug]/component-categories");
covers("GET /api/v1/orgs/[orgSlug]/component-types");
covers("POST /api/v1/orgs/[orgSlug]/component-types");
covers("GET /api/v1/orgs/[orgSlug]/component-types/[typeId]");
covers("PATCH /api/v1/orgs/[orgSlug]/component-types/[typeId]");
covers("GET /api/v1/orgs/[orgSlug]/component-types/[typeId]/field-values");
covers("PUT /api/v1/orgs/[orgSlug]/component-types/[typeId]/field-values");

type Field = { key: string; label: string; type: string; required?: boolean; basic?: boolean; options?: string[]; dependsOn?: string; hint?: string };
type Entry = { options: string[] } | { valueMap: Record<string, string[]> };
type Config = Record<string, Entry>;
type Category = { id: string; organizationId: string; name: string };
type CT = {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  categoryId: string;
  fieldsSchema: Field[];
  active: boolean;
  sortOrder: number;
  category?: Category;
  fieldOptionsConfig?: Config | null;
};

/** Per-worker memo; a REJECTED promise is evicted so a transient failure is retried by the next caller. */
const memo = new Map<string, Promise<unknown>>();
function once<T>(key: string, make: () => Promise<T>): Promise<T> {
  let p = memo.get(key) as Promise<T> | undefined;
  if (!p) {
    p = make();
    memo.set(key, p);
    p.catch(() => {
      if (memo.get(key) === p) memo.delete(key);
    });
  }
  return p;
}

async function listTypes(g: Guarded, slug: string): Promise<CT[]> {
  return (await ok<{ componentTypes: CT[] }>(await g.get(orgApi(slug, "/component-types")))).componentTypes;
}
async function typeId(g: Guarded, slug: string, code: string): Promise<string> {
  const id = (await listTypes(g, slug)).find((t) => t.code === code)?.id;
  if (!id) throw new Error(`org ${slug} has no ComponentType ${code}`);
  return id;
}
const testOrgTypeId = (c: Pick<Ctx, "run" | "as">, code: string) => once(`t-${code}`, () => typeId(c.as.admin, c.run.testOrg.slug, code));
const orgBTypeId = (c: Pick<Ctx, "run" | "orgB">, code: string) => once(`b-${code}`, () => typeId(c.orgB, c.run.orgB.slug, code));

async function firstCategoryId(g: Guarded, slug: string): Promise<string> {
  const cats = (await ok<{ categories: Category[] }>(await g.get(orgApi(slug, "/component-categories")))).categories;
  if (!cats[0]) throw new Error(`org ${slug} has no ComponentCategory`);
  return cats[0].id;
}

/** A field set with a 3-level cascade (frame → finish → edge) plus two non-choice fields. */
const CASCADE: Field[] = [
  { key: "frame", label: "Frame", type: "dropdown", required: true, basic: true, options: [] },
  { key: "finish", label: "Finish", type: "dropdown", required: true, basic: true, options: [], dependsOn: "frame" },
  { key: "edge", label: "Edge", type: "radio", required: false, basic: false, options: [], dependsOn: "finish" },
  { key: "note", label: "Note", type: "field", required: false, basic: false },
  { key: "flag", label: "Flag", type: "checkbox", required: false, basic: false },
];

const newCode = () => `RGR${tag().toUpperCase()}`;

/** Create a type in org B through the ORG route (org B's admin has MANAGE_FEATURES). Goes with org B. */
async function mkBType(c: { run: RunState; orgB: Guarded }, fieldsSchema: unknown = CASCADE, over: Record<string, unknown> = {}): Promise<CT> {
  const categoryId = await firstCategoryId(c.orgB, c.run.orgB.slug);
  const r = await c.orgB.post(orgApi(c.run.orgB.slug, "/component-types"), {
    data: { code: newCode(), name: `${c.run.prefix}ct-${tag()}`, categoryId, fieldsSchema, ...over },
  });
  return (await ok<{ componentType: CT }>(r, 201)).componentType;
}

/** The cascading-dropdown contract of a stored config, checked against its fieldsSchema. */
function expectCascadeContract(t: CT, requireComplete: boolean): void {
  const cfg = t.fieldOptionsConfig ?? {};
  const byKey = new Map(t.fieldsSchema.map((f) => [f.key, f]));
  const values = (e: Entry | undefined): string[] => (!e ? [] : "options" in e ? e.options : [...new Set(Object.values(e.valueMap).flat())]);
  for (const key of Object.keys(cfg)) {
    const fld = byKey.get(key);
    expect(fld, `${t.code}: config key "${key}" is in fieldsSchema`).toBeTruthy();
    expect(["dropdown", "radio"], `${t.code}.${key} is a choice field`).toContain(fld!.type);
  }
  for (const fld of t.fieldsSchema) {
    if (fld.type !== "dropdown" && fld.type !== "radio") continue;
    const e = cfg[fld.key];
    if (!e) {
      if (requireComplete) throw new Error(`${t.code}.${fld.key} has no configured values`);
      continue;
    }
    if (fld.dependsOn) {
      expect(e, `${t.code}.${fld.key} depends on ${fld.dependsOn} → valueMap`).toHaveProperty("valueMap");
      const parent = values(cfg[fld.dependsOn]);
      for (const k of Object.keys((e as { valueMap: Record<string, string[]> }).valueMap)) {
        expect(parent, `${t.code}.${fld.key}: valueMap key "${k}" is a value of ${fld.dependsOn}`).toContain(k);
      }
    } else {
      expect(e, `${t.code}.${fld.key} has no dependsOn → options`).toHaveProperty("options");
    }
  }
}

registerNegatives([
  { key: "GET /api/v1/orgs/[orgSlug]/component-categories", method: "GET", path: () => "/component-categories" },
  { key: "GET /api/v1/orgs/[orgSlug]/component-types", method: "GET", path: () => "/component-types" },
  {
    key: "POST /api/v1/orgs/[orgSlug]/component-types",
    method: "POST",
    path: () => "/component-types",
    permission: "MANAGE_FEATURES",
    body: (c) => ({ name: `${c.run.prefix}neg-ct-auth` }), // no code/categoryId → a leaked gate still creates nothing
    // all rejected before the insert (a GHOST category fails the in-org check; the FK would refuse it anyway)
    invalid: [
      { name: "{} (code, name, categoryId required)", body: {}, status: 400 },
      { name: "missing categoryId", body: (c: Ctx) => ({ code: "RGRNEG", name: `${c.run.prefix}neg-ct` }), status: 400 },
      { name: "blank code", body: (c: Ctx) => ({ code: "   ", name: `${c.run.prefix}neg-ct`, categoryId: GHOST }), status: 400 },
      { name: "code 5 (not a string)", body: (c: Ctx) => ({ code: 5, name: `${c.run.prefix}neg-ct`, categoryId: GHOST }), status: 400 },
      { name: "blank name", body: { code: "RGRNEG", name: "  ", categoryId: GHOST }, status: 400 },
      { name: "unknown categoryId", body: (c: Ctx) => ({ code: "RGRNEG", name: `${c.run.prefix}neg-ct`, categoryId: GHOST }), status: 400 },
      { name: "JSON null body", body: null, status: 400 },
    ],
  },
  {
    key: "GET /api/v1/orgs/[orgSlug]/component-types/[typeId]",
    method: "GET",
    path: async (c) => `/component-types/${await testOrgTypeId(c, "GLASS")}`,
    permission: "MANAGE_FEATURES",
    unknownId: () => `/component-types/${GHOST}`,
    foreignId: async (c) => `/component-types/${await orgBTypeId(c, "GLASS")}`,
  },
  {
    key: "PATCH /api/v1/orgs/[orgSlug]/component-types/[typeId]",
    method: "PATCH",
    path: () => `/component-types/${GHOST}`, // never a live row: a leaked gate updates nothing
    permission: "MANAGE_FEATURES",
    body: (c) => ({ name: `${c.run.prefix}neg-ct` }),
    unknownId: () => `/component-types/${GHOST}`,
    foreignId: async (c) => `/component-types/${await orgBTypeId(c, "GLASS")}`,
    invalid: [
      { name: "{} (no updatable fields)", body: {}, status: 400 },
      { name: "only wrongly-typed fields (name 5, active \"yes\", fieldsSchema {})", body: { name: 5, active: "yes", fieldsSchema: {} }, status: 400 },
    ],
  },
  {
    key: "GET /api/v1/orgs/[orgSlug]/component-types/[typeId]/field-values",
    method: "GET",
    path: async (c) => `/component-types/${await testOrgTypeId(c, "GLASS")}/field-values`,
    permission: "MANAGE_FEATURES",
    unknownId: () => `/component-types/${GHOST}/field-values`,
    foreignId: async (c) => `/component-types/${await orgBTypeId(c, "GLASS")}/field-values`,
  },
  {
    key: "PUT /api/v1/orgs/[orgSlug]/component-types/[typeId]/field-values",
    method: "PUT",
    path: () => `/component-types/${GHOST}/field-values`,
    permission: "MANAGE_FEATURES",
    body: () => ({ fieldOptionsConfig: {} }),
    unknownId: () => `/component-types/${GHOST}/field-values`,
    foreignId: async (c) => `/component-types/${await orgBTypeId(c, "GLASS")}/field-values`,
    invalid: [
      { name: "{} (fieldOptionsConfig required)", body: {}, status: 400 },
      { name: "fieldOptionsConfig []", body: { fieldOptionsConfig: [] }, status: 400 },
      { name: "fieldOptionsConfig null", body: { fieldOptionsConfig: null }, status: 400 },
      { name: 'fieldOptionsConfig "x"', body: { fieldOptionsConfig: "x" }, status: 400 },
    ],
  },
]);

test.describe("catalog: reads (Test Org)", () => {
  test("categories: any member lists the org's own categories A→Z; org B sees only its own", async ({ as, url, run, orgB }) => {
    const cats = (await ok<{ categories: Category[] }>(await as.architect.get(url("/component-categories")))).categories;
    expect(cats.length).toBeGreaterThan(0);
    for (const c of cats) expect(c.organizationId).toBe(run.testOrg.id);
    expect(cats.map((c) => c.name)).toEqual([...cats.map((c) => c.name)].sort((a, b) => a.localeCompare(b)));
    const glass = (await listTypes(as.admin, run.testOrg.slug)).find((t) => t.code === "GLASS")!;
    expect(cats.map((c) => c.id)).toContain(glass.categoryId);
    const bCats = (await ok<{ categories: Category[] }>(await orgB.get(orgApi(run.orgB.slug, "/component-categories")))).categories;
    for (const c of bCats) expect(c.organizationId).toBe(run.orgB.id);
    expect(bCats.map((c) => c.id).filter((id) => cats.some((c) => c.id === id))).toEqual([]);
  });

  test("component types: every role gets the same palette (GLASS, DOOR, … with fieldsSchema), in sortOrder order", async ({ as, run, orgB }) => {
    const admin = await listTypes(as.admin, run.testOrg.slug);
    expect(admin.map((t) => t.code)).toEqual(expect.arrayContaining(["GLASS", "DOOR"]));
    for (const t of admin) {
      expect(t.organizationId).toBe(run.testOrg.id);
      expect(t.category).toMatchObject({ id: t.categoryId, organizationId: run.testOrg.id });
      expect(Array.isArray(t.fieldsSchema)).toBe(true);
      for (const fld of t.fieldsSchema) expect(fld).toMatchObject({ key: expect.any(String), label: expect.any(String), type: expect.any(String) });
      expect(t).toHaveProperty("fieldOptionsConfig");
    }
    const glass = admin.find((t) => t.code === "GLASS")!;
    expect(glass.fieldsSchema.length).toBeGreaterThan(0);
    // sortOrder ascending, code as the tie-break
    const order = [...admin].sort((a, b) => a.sortOrder - b.sortOrder || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    expect(admin.map((t) => t.id)).toEqual(order.map((t) => t.id));

    for (const role of ["member", "distributor", "architect"] as const) {
      expect((await listTypes(as[role], run.testOrg.slug)).map((t) => t.id), role).toEqual(admin.map((t) => t.id));
    }
    const b = await listTypes(orgB, run.orgB.slug);
    expect(b.map((t) => t.id).filter((id) => admin.some((t) => t.id === id))).toEqual([]);
  });

  test("GET by id and field-values GET return the same row as the list (DOOR)", async ({ as, url, run }) => {
    const id = await testOrgTypeId({ run, as }, "DOOR");
    const fromList = (await listTypes(as.admin, run.testOrg.slug)).find((t) => t.id === id);
    const one = (await ok<{ componentType: CT }>(await as.admin.get(url(`/component-types/${id}`)))).componentType;
    const fv = (await ok<{ componentType: CT }>(await as.admin.get(url(`/component-types/${id}/field-values`)))).componentType;
    expect(one).toEqual(fromList);
    expect(fv).toEqual(fromList);
  });

  test("cascading-dropdown contract: GLASS and DOOR are fully configured; a dependent field's valueMap is keyed by its parent's values", async ({ as, run }) => {
    const types = await listTypes(as.admin, run.testOrg.slug);
    for (const code of ["GLASS", "DOOR"]) {
      const t = types.find((x) => x.code === code)!;
      expect(t.fieldOptionsConfig, `${code} has an org config`).toBeTruthy();
      expect(t.fieldsSchema.some((f) => f.dependsOn), `${code} has at least one dependent field`).toBe(true);
      expectCascadeContract(t, true);
    }
  });
});

test.describe("catalog: Test-Org writes (shared state, locked + reverted)", () => {
  test("field-values PUT → GET round-trip on DOOR (identity write: the exact current config is PUT back)", async ({ as, url, run }) => {
    await withLock(run.storageDir, TEST_ORG_CONFIG_LOCK, async () => {
      const id = await testOrgTypeId({ run, as }, "DOOR");
      const path = url(`/component-types/${id}/field-values`);
      const read = async () => (await ok<{ componentType: CT }>(await as.admin.get(path))).componentType.fieldOptionsConfig;
      const write = async (v: unknown) => {
        const r = await as.admin.put(path, { data: { fieldOptionsConfig: v } });
        if (r.status() !== 200) throw new Error(`PUT DOOR field-values → HTTP ${r.status()} ${await r.text()}`);
      };
      const original = await read();
      expect(original).toBeTruthy();
      await withRecordedGlobalState(
        { key: `Test Org ComponentType DOOR (${id}).fieldOptionsConfig`, read, write },
        async () => {
          const r = await as.admin.put(path, { data: { fieldOptionsConfig: original } });
          const ct = (await ok<{ componentType: CT }>(r)).componentType;
          expect(ct.fieldOptionsConfig).toEqual(original);
          expect(ct.code).toBe("DOOR");
        },
        async () => {
          expect(await read()).toEqual(original);
          const listed = (await listTypes(as.member, run.testOrg.slug)).find((t) => t.id === id)!;
          expect(listed.fieldOptionsConfig).toEqual(original);
        },
        globalStateFailuresFile(run.storageDir),
      );
    });
  });

  test("PATCH renames DOOR (name trimmed; code/schema untouched); projects created meanwhile freeze the new label; then restored", async ({ as, f, url, run }) => {
    await withLock(run.storageDir, TEST_ORG_CONFIG_LOCK, async () => {
      const id = await testOrgTypeId({ run, as }, "DOOR");
      const path = url(`/component-types/${id}`);
      const readRow = async () => (await ok<{ componentType: CT }>(await as.admin.get(path))).componentType;
      const writeName = async (name: unknown) => {
        const r = await as.admin.patch(path, { data: { name } });
        if (r.status() !== 200) throw new Error(`PATCH DOOR name → HTTP ${r.status()} ${await r.text()}`);
      };
      const before = await readRow();
      const temp = `${run.prefix}DOOR-renamed`;
      const doorIn = async (projectId: string) => (await readConfigSnapshot(projectId))!.componentTypes.find((t) => t.code === "DOOR")!;
      await withRecordedGlobalState(
        { key: `Test Org ComponentType DOOR (${id}).name`, read: async () => (await readRow()).name, write: writeName },
        async () => {
          const r = await as.admin.patch(path, { data: { name: `   ${temp}   ` } });
          const ct = (await ok<{ componentType: CT }>(r)).componentType;
          expect(ct).toMatchObject({ id, name: temp, code: "DOOR", categoryId: before.categoryId, active: before.active, sortOrder: before.sortOrder });
        },
        async () => {
          const now = await readRow();
          expect(now).toEqual({ ...before, name: temp, updatedAt: expect.any(String) });
          expect((await listTypes(as.architect, run.testOrg.slug)).find((t) => t.id === id)!.name).toBe(temp);
          const p = await f.project();
          expect((await doorIn(p.id)).name).toBe(temp);
        },
        globalStateFailuresFile(run.storageDir),
        { forbidOriginal: /^rgr-/ },
      );
      const after = await readRow();
      expect(after).toEqual({ ...before, updatedAt: expect.any(String) });
    });
  });
});

test.describe("catalog: create / edit / field values (throwaway org B)", () => {
  test("POST creates a type: code trimmed + upper-cased, name trimmed, active defaults true, sortOrder appended; invisible to the Test Org", async ({ as, url, run, orgB }) => {
    const B = (p: string) => orgApi(run.orgB.slug, p);
    const maxBefore = Math.max(-1, ...(await listTypes(orgB, run.orgB.slug)).map((t) => t.sortOrder));
    const categoryId = await firstCategoryId(orgB, run.orgB.slug);
    const raw = `  rgr${tag()} `;
    const name = `${run.prefix}ct-${tag()}`;
    const ct = (await ok<{ componentType: CT }>(await orgB.post(B("/component-types"), { data: { code: raw, name: ` ${name} `, categoryId, fieldsSchema: CASCADE } }), 201)).componentType;
    expect(ct).toMatchObject({ code: raw.trim().toUpperCase(), name, categoryId, active: true, organizationId: run.orgB.id, fieldsSchema: CASCADE });
    expect(ct.sortOrder).toBeGreaterThan(maxBefore);

    const listed = (await listTypes(orgB, run.orgB.slug)).find((t) => t.id === ct.id)!;
    expect(listed).toMatchObject({ code: ct.code, fieldOptionsConfig: null, category: { id: categoryId } });
    expect(listed.fieldsSchema.map((x) => x.key)).toEqual(CASCADE.map((x) => x.key));
    const one = (await ok<{ componentType: CT }>(await orgB.get(B(`/component-types/${ct.id}`)))).componentType;
    expect(one).toEqual(listed);

    await rejected(await as.admin.get(url(`/component-types/${ct.id}`)), 404, "Component type not found");
    expect((await listTypes(as.admin, run.testOrg.slug)).map((t) => t.id)).not.toContain(ct.id);

    const inactive = await mkBType({ run, orgB }, "not-an-array", { active: false });
    expect(inactive).toMatchObject({ active: false, fieldsSchema: [] }); // a non-array fieldsSchema is stored as []
  });

  test("POST / PATCH refuse the other org's category (FK-injection guard); PATCH unknown category → 404", async ({ run, orgB, as }) => {
    const B = (p: string) => orgApi(run.orgB.slug, p);
    const testCat = await firstCategoryId(as.admin, run.testOrg.slug);
    await rejected(
      await orgB.post(B("/component-types"), { data: { code: newCode(), name: `${run.prefix}ct-x`, categoryId: testCat, fieldsSchema: [] } }),
      400,
      "Category not found or access denied",
    );
    const ct = await mkBType({ run, orgB });
    // the route maps the DAL's "not found" to 404 on PATCH (400 on POST)
    await rejected(await orgB.patch(B(`/component-types/${ct.id}`), { data: { categoryId: testCat } }), 404, "Category not found or access denied");
    await rejected(await orgB.patch(B(`/component-types/${ct.id}`), { data: { categoryId: GHOST } }), 404, "Category not found or access denied");
    expect((await ok<{ componentType: CT }>(await orgB.get(B(`/component-types/${ct.id}`)))).componentType.categoryId).toBe(ct.categoryId);
  });

  test("PATCH is partial; a taken code → 409; code is upper-cased; active can be toggled on a type outside the formula set", async ({ run, orgB }) => {
    const B = (p: string) => orgApi(run.orgB.slug, p);
    const a = await mkBType({ run, orgB });
    const b = await mkBType({ run, orgB });
    const p1 = (await ok<{ componentType: CT }>(await orgB.patch(B(`/component-types/${a.id}`), { data: { name: `${a.name}-2` } }))).componentType;
    expect(p1).toMatchObject({ name: `${a.name}-2`, code: a.code, categoryId: a.categoryId, fieldsSchema: CASCADE, active: true, sortOrder: a.sortOrder });

    await rejected(await orgB.patch(B(`/component-types/${a.id}`), { data: { code: b.code.toLowerCase() } }), 409, "code already in use in this org");
    expect((await ok<{ componentType: CT }>(await orgB.get(B(`/component-types/${a.id}`)))).componentType.code).toBe(a.code);

    const fresh = newCode();
    const p2 = (await ok<{ componentType: CT }>(await orgB.patch(B(`/component-types/${a.id}`), { data: { code: ` ${fresh.toLowerCase()} `, active: false } }))).componentType;
    expect(p2).toMatchObject({ code: fresh, active: false });
  });

  test("formula-set guard (org B runs the same active set): GLASS cannot be deactivated, re-coded or lose a referenced field (409); nothing changes", async ({ run, orgB }) => {
    const B = (p: string) => orgApi(run.orgB.slug, p);
    const id = await orgBTypeId({ run, orgB }, "GLASS");
    const before = (await ok<{ componentType: CT }>(await orgB.get(B(`/component-types/${id}`)))).componentType;
    const tail = /in formula set .+ v\d+, currently assigned to this organization\.$/;

    const d = await orgB.patch(B(`/component-types/${id}`), { data: { active: false } });
    await rejected(d, 409, /^Cannot deactivate component type GLASS — it is slot "GLASS" in formula set .+ v\d+, currently assigned to this organization\.$/);
    const nc = newCode();
    const c = await orgB.patch(B(`/component-types/${id}`), { data: { code: nc } });
    await rejected(c, 409, new RegExp(`^Cannot change the code of component type GLASS to ${nc} — it is slot "GLASS" ${tail.source}`));
    const k = await orgB.patch(B(`/component-types/${id}`), { data: { fieldsSchema: [] } });
    await rejected(k, 409, new RegExp(`^Cannot remove or rename field "[^"]+" on component type GLASS — it is a (summary|formula) parameter referenced by slot "GLASS" ${tail.source}`));

    expect((await ok<{ componentType: CT }>(await orgB.get(B(`/component-types/${id}`)))).componentType).toEqual(before);
  });

  test("field-values PUT → GET round-trip with a 3-level cascade; values trimmed, blanks dropped; whole-blob replace; {} clears", async ({ run, orgB, as, url }) => {
    const B = (p: string) => orgApi(run.orgB.slug, p);
    const ct = await mkBType({ run, orgB });
    const fv = B(`/component-types/${ct.id}/field-values`);
    expect((await ok<{ componentType: CT }>(await orgB.get(fv))).componentType.fieldOptionsConfig).toBeNull(); // never configured

    const put = await orgB.put(fv, {
      data: {
        fieldOptionsConfig: {
          frame: { options: [" Alu ", "Steel", "", "  "] },
          finish: { valueMap: { Alu: ["Matt", " Gloss "], Steel: ["Raw", ""] } },
          edge: { valueMap: { Matt: ["Round"], Gloss: ["Flat"], Raw: ["Flat", "Round"] } },
        },
      },
    });
    const stored: Config = {
      frame: { options: ["Alu", "Steel"] },
      finish: { valueMap: { Alu: ["Matt", "Gloss"], Steel: ["Raw"] } },
      edge: { valueMap: { Matt: ["Round"], Gloss: ["Flat"], Raw: ["Flat", "Round"] } },
    };
    const echoed = (await ok<{ componentType: CT }>(put)).componentType;
    expect(echoed).toMatchObject({ id: ct.id, code: ct.code, fieldOptionsConfig: stored });
    const got = (await ok<{ componentType: CT }>(await orgB.get(fv))).componentType;
    expect(got.fieldOptionsConfig).toEqual(stored);
    expectCascadeContract(got, true);
    expect((await listTypes(orgB, run.orgB.slug)).find((t) => t.id === ct.id)!.fieldOptionsConfig).toEqual(stored);
    // the Test Org never sees it
    await rejected(await as.admin.get(url(`/component-types/${ct.id}/field-values`)), 404, "Component type not found");

    // whole-blob replace: entries not sent are gone
    const replaced = (await ok<{ componentType: CT }>(await orgB.put(fv, { data: { fieldOptionsConfig: { frame: { options: ["Wood"] } } } }))).componentType;
    expect(replaced.fieldOptionsConfig).toEqual({ frame: { options: ["Wood"] } });

    // {} clears every value (the config row stays, so it reads back as {} rather than null)
    const cleared = (await ok<{ componentType: CT }>(await orgB.put(fv, { data: { fieldOptionsConfig: {} } }))).componentType;
    expect(cleared.fieldOptionsConfig).toEqual({});
  });

  test("field-values PUT validation: each malformed payload → 400 with its exact message; nothing is written", async ({ run, orgB }) => {
    const B = (p: string) => orgApi(run.orgB.slug, p);
    const ct = await mkBType({ run, orgB });
    const fv = B(`/component-types/${ct.id}/field-values`);
    const base: Config = { frame: { options: ["Alu"] }, finish: { valueMap: { Alu: ["Matt"] } } };
    await ok(await orgB.put(fv, { data: { fieldOptionsConfig: base } }));

    const cases: [string, Record<string, unknown>, string][] = [
      ["unknown key", { nope: { options: [] } }, 'Unknown field key "nope" — not present in this ComponentType\'s fieldsSchema.'],
      ["a text field", { note: { options: ["x"] } }, 'Field "note" is type "field" — only dropdown/radio fields accept configured values.'],
      ["a checkbox field", { flag: { options: ["x"] } }, 'Field "flag" is type "checkbox" — only dropdown/radio fields accept configured values.'],
      ["entry not an object", { frame: ["Alu"] }, 'Field "frame": entry must be an object.'],
      ["dependsOn in an entry", { frame: { options: ["Alu"], dependsOn: "finish" } }, 'Field "frame": "dependsOn" cannot be set from this endpoint — the dependency wiring is authored by SuperAdmin only.'],
      ["flat field sent as valueMap", { frame: { valueMap: { x: ["y"] } } }, 'Field "frame": expected an "options" array of strings.'],
      ["flat field with a non-string option", { frame: { options: ["Alu", 3] } }, 'Field "frame": expected an "options" array of strings.'],
      ["dependent field sent as options", { finish: { options: ["Matt"] } }, 'Field "finish" depends on "frame" — expected a "valueMap" object keyed by the parent field\'s values.'],
      ["valueMap value not an array", { frame: { options: ["Alu"] }, finish: { valueMap: { Alu: "Matt" } } }, 'Field "finish": valueMap["Alu"] must be an array of strings.'],
      ["valueMap key not a parent value", { frame: { options: ["Alu"] }, finish: { valueMap: { Wood: ["Matt"] } } }, 'Field "finish": valueMap key "Wood" is not one of "frame"\'s currently configured values.'],
      [
        "grandchild keyed by a value its parent does not offer",
        { frame: { options: ["Alu"] }, finish: { valueMap: { Alu: ["Matt"] } }, edge: { valueMap: { Gloss: ["Flat"] } } },
        'Field "edge": valueMap key "Gloss" is not one of "finish"\'s currently configured values.',
      ],
    ];
    for (const [what, cfg, msg] of cases) {
      const r = await orgB.put(fv, { data: { fieldOptionsConfig: cfg } });
      expect(r.status(), `${what}: ${await r.text()}`).toBe(400);
      expect(await r.json(), what).toEqual({ error: msg });
    }
    expect((await ok<{ componentType: CT }>(await orgB.get(fv))).componentType.fieldOptionsConfig).toEqual(base);

    // documented leniency: the parent-key check only runs when the parent's entry is in the same payload
    const lenient = (await ok<{ componentType: CT }>(await orgB.put(fv, { data: { fieldOptionsConfig: { finish: { valueMap: { Wood: ["Matt"] } } } } }))).componentType;
    expect(lenient.fieldOptionsConfig).toEqual({ finish: { valueMap: { Wood: ["Matt"] } } });
  });

  test("cross-tenant from org B's side: GET / PATCH / PUT on a Test-Org type through org B's slug → 404; the Test-Org type is untouched", async ({ as, url, run, orgB }) => {
    const id = await testOrgTypeId({ run, as }, "GLASS");
    const before = (await ok<{ componentType: CT }>(await as.admin.get(url(`/component-types/${id}/field-values`)))).componentType;
    const B = (p: string) => orgApi(run.orgB.slug, p);
    await rejected(await orgB.get(B(`/component-types/${id}`)), 404, "Component type not found");
    await rejected(await orgB.get(B(`/component-types/${id}/field-values`)), 404, "Component type not found");
    // harmless bodies (a no-op active:true; the type's own current values) in case tenancy ever leaks
    await rejected(await orgB.patch(B(`/component-types/${id}`), { data: { active: true } }), 404, "ComponentType not found or access denied");
    await rejected(await orgB.put(B(`/component-types/${id}/field-values`), { data: { fieldOptionsConfig: before.fieldOptionsConfig } }), 404, "Component type not found");
    const after = (await ok<{ componentType: CT }>(await as.admin.get(url(`/component-types/${id}/field-values`)))).componentType;
    // name excluded: projects.spec.ts may rename GLASS concurrently
    expect({ ...after, name: "", updatedAt: "" }).toEqual({ ...before, name: "", updatedAt: "" });
  });

  // KNOWN BUG (pinned, R24): the ORG-side create/PATCH store `fieldsSchema` without any validation — junk
  // entries and arbitrary `dependsOn` rewiring are accepted (200/201). Stage 20 made field SHAPE / wiring
  // SuperAdmin-owned (the SA routes run validate-fields-schema; field-values refuses `dependsOn`), so an
  // org admin can bypass that through this route. When fixed: expect 400 (or the field to be ignored).
  test("KNOWN BUG: org POST / PATCH accept an unvalidated fieldsSchema (junk entries, dependsOn rewired to a missing key)", async ({ run, orgB }) => {
    const B = (p: string) => orgApi(run.orgB.slug, p);
    const junk = [{ bogus: 1 }];
    const ct = await mkBType({ run, orgB }, junk);
    expect(ct.fieldsSchema).toEqual(junk);
    const rewired = CASCADE.map((f) => (f.key === "finish" ? { ...f, dependsOn: "doesNotExist" } : f));
    const p = await orgB.patch(B(`/component-types/${ct.id}`), { data: { fieldsSchema: rewired } });
    const row = (await ok<{ componentType: CT }>(p)).componentType;
    expect(row.fieldsSchema.find((f) => f.key === "finish")!.dependsOn).toBe("doesNotExist");
  });

  // KNOWN BUG (pinned, R24): POST with a code the org already has is not mapped to 409 (PATCH maps P2002 to
  // 409 "code already in use in this org"; POST only maps "not found"/"access denied") → 500. When fixed:
  // expect 409 with that message.
  test("KNOWN BUG: POST with a duplicate code → 500 (not 409); no second row", async ({ run, orgB }) => {
    const a = await mkBType({ run, orgB });
    const categoryId = await firstCategoryId(orgB, run.orgB.slug);
    const r = await orgB.post(orgApi(run.orgB.slug, "/component-types"), {
      data: { code: a.code.toLowerCase(), name: `${run.prefix}ct-dup`, categoryId, fieldsSchema: [] },
    });
    expect(r.status(), await r.text()).toBe(500);
    expect((await listTypes(orgB, run.orgB.slug)).filter((t) => t.code === a.code)).toHaveLength(1);
  });
});
