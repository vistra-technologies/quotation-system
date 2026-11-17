/**
 * Stage 36 Batch 2: product pricing API (GET / PUT collection, DELETE by id).
 *
 * Gates (route source, O-1 = c): every verb requires MANAGE_PRICING (admin + member hold it; distributor and
 * architect do not). Tenancy: organizationId comes from the session; a foreign componentTypeId is a 404 on PUT,
 * a foreign row id a 404 on DELETE.
 *
 * Writes only ever go to this run's throwaway org B (rows cascade with it at teardown; its hard delete would
 * fail on the Organization FK if the cascade missed ProductPricing). The Test Org is only READ (type ids) and
 * addressed by rejected requests. The suspended-org and org-hard-delete cases live in superadmin-orgs.spec.ts
 * (org C lifecycle), the type-delete cascade is asserted here.
 */
import { covers } from "../fixtures/covers";
import type { Guarded } from "../fixtures/clients";
import type { RunState } from "../fixtures/run-state";
import { registerNegatives, GHOST as UUID_GHOST, type Ctx } from "./api-matrix";
import { orgApi } from "./project-helpers";
import { test, expect, SA, tag, json } from "./sa-helpers";

covers("GET /api/v1/orgs/[orgSlug]/product-pricing");
covers("PUT /api/v1/orgs/[orgSlug]/product-pricing");
covers("DELETE /api/v1/orgs/[orgSlug]/product-pricing/[id]");

type Price = { currency: string; unit: string; amount: number };
type Row = {
  id: string; componentTypeId: string; combinationKey: string; combinationLabel: string;
  prices: Price[]; description: string | null; updatedAt: string;
};

const PP = "/product-pricing";
const key = (o: Record<string, string>) => JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1))));

/** Component type id by code, as seen by `g` in org `slug` (a read). */
async function typeIdIn(g: Guarded, slug: string, code: string): Promise<string> {
  const r = await g.get(orgApi(slug, "/component-types"));
  expect(r.status(), await r.text()).toBe(200);
  const id = ((await r.json()) as { componentTypes: { id: string; code: string }[] }).componentTypes.find((t) => t.code === code)?.id;
  if (!id) throw new Error(`org ${slug} has no ComponentType ${code}`);
  return id;
}

async function list(g: Guarded, slug: string, query = ""): Promise<Row[]> {
  const r = await g.get(orgApi(slug, `${PP}${query}`));
  expect(r.status(), await r.text()).toBe(200);
  return ((await r.json()) as { rows: Row[] }).rows;
}

/** PUT as org B's admin; returns the response so cases can assert status and body. */
const putB = (c: { orgB: Guarded; run: RunState }, data: unknown) => c.orgB.put(orgApi(c.run.orgB.slug, PP), { data });

/** A valid PUT body for `typeId`; `over` replaces fields. Keys carry the run prefix. */
function body(prefix: string, typeId: string, label: string, over: Record<string, unknown> = {}) {
  return {
    componentTypeId: typeId,
    combinationKey: key({ rgrSpec: `${prefix}${label}` }),
    combinationLabel: `${prefix}${label}`,
    prices: [{ currency: "INR", unit: "m2", amount: 100 }],
    ...over,
  };
}

const glassOfTestOrg = (c: Ctx) => typeIdIn(c.as.admin, c.run.testOrg.slug, "GLASS");

registerNegatives([
  { key: "GET /api/v1/orgs/[orgSlug]/product-pricing", method: "GET", path: () => PP, permission: "MANAGE_PRICING" },
  {
    key: "PUT /api/v1/orgs/[orgSlug]/product-pricing",
    method: "PUT",
    path: () => PP,
    permission: "MANAGE_PRICING",
    body: (c: Ctx) => ({ componentTypeId: UUID_GHOST, combinationKey: key({ a: "b" }), combinationLabel: `${c.run.prefix}neg`, prices: [] }),
    invalid: [
      { name: "missing componentTypeId", status: 400, body: (c: Ctx) => ({ combinationKey: key({ a: "b" }), combinationLabel: `${c.run.prefix}x`, prices: [] }) },
      { name: "key not JSON", status: 400, body: async (c: Ctx) => body(c.run.prefix, await glassOfTestOrg(c), "k", { combinationKey: "{nope" }) },
      { name: "key not canonical (unsorted)", status: 400, body: async (c: Ctx) => body(c.run.prefix, await glassOfTestOrg(c), "k", { combinationKey: '{"b":"1","a":"2"}' }) },
      { name: "key with a non-string value", status: 400, body: async (c: Ctx) => body(c.run.prefix, await glassOfTestOrg(c), "k", { combinationKey: '{"a":1}' }) },
      { name: "key with an empty value", status: 400, body: async (c: Ctx) => body(c.run.prefix, await glassOfTestOrg(c), "k", { combinationKey: '{"a":""}' }) },
      { name: "key is an array", status: 400, body: async (c: Ctx) => body(c.run.prefix, await glassOfTestOrg(c), "k", { combinationKey: '["a"]' }) },
      { name: "key with more than 20 fields", status: 400, body: async (c: Ctx) => body(c.run.prefix, await glassOfTestOrg(c), "k", { combinationKey: key(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${String(i).padStart(2, "0")}`, "v"]))) }) },
      { name: "key over 1000 chars", status: 400, body: async (c: Ctx) => body(c.run.prefix, await glassOfTestOrg(c), "k", { combinationKey: key({ a: "x".repeat(1000) }) }) },
      { name: "label over 300 chars", status: 400, body: async (c: Ctx) => body(c.run.prefix, await glassOfTestOrg(c), "k", { combinationLabel: "x".repeat(301) }) },
      { name: "blank label", status: 400, body: async (c: Ctx) => body(c.run.prefix, await glassOfTestOrg(c), "k", { combinationLabel: "   " }) },
      { name: "description over 500 chars", status: 400, body: async (c: Ctx) => body(c.run.prefix, await glassOfTestOrg(c), "k", { description: "x".repeat(501) }) },
      { name: "bad currency", status: 400, body: async (c: Ctx) => body(c.run.prefix, await glassOfTestOrg(c), "k", { prices: [{ currency: "EUR", unit: "m2", amount: 1 }] }) },
      { name: "pcs on an area type", status: 400, body: async (c: Ctx) => body(c.run.prefix, await glassOfTestOrg(c), "k", { prices: [{ currency: "INR", unit: "pcs", amount: 1 }] }) },
      { name: "m2 on a piece type", status: 400, body: async (c: Ctx) => body(c.run.prefix, await typeIdIn(c.as.admin, c.run.testOrg.slug, "DOOR"), "k", { prices: [{ currency: "INR", unit: "m2", amount: 1 }] }) },
      { name: "negative amount", status: 400, body: async (c: Ctx) => body(c.run.prefix, await glassOfTestOrg(c), "k", { prices: [{ currency: "INR", unit: "m2", amount: -1 }] }) },
      { name: "3-decimal amount", status: 400, body: async (c: Ctx) => body(c.run.prefix, await glassOfTestOrg(c), "k", { prices: [{ currency: "INR", unit: "m2", amount: 1.005 }] }) },
      { name: "amount as a string", status: 400, body: async (c: Ctx) => body(c.run.prefix, await glassOfTestOrg(c), "k", { prices: [{ currency: "INR", unit: "m2", amount: "5" }] }) },
      { name: "duplicate (currency, unit) pair", status: 400, body: async (c: Ctx) => body(c.run.prefix, await glassOfTestOrg(c), "k", { prices: [{ currency: "INR", unit: "m2", amount: 1 }, { currency: "INR", unit: "m2", amount: 2 }] }) },
      { name: "more than 6 entries", status: 400, body: async (c: Ctx) => body(c.run.prefix, await glassOfTestOrg(c), "k", { prices: ["INR", "AED", "USD"].flatMap((currency) => ["m2", "sqft"].map((unit) => ({ currency, unit, amount: 1 }))).concat([{ currency: "INR", unit: "m2", amount: 9 }]) }) },
      { name: "prices not an array", status: 400, body: async (c: Ctx) => body(c.run.prefix, await glassOfTestOrg(c), "k", { prices: "none" }) },
      { name: "componentTypeId of no type", status: 404, body: (c: Ctx) => body(c.run.prefix, UUID_GHOST, "k") },
    ],
  },
  {
    key: "DELETE /api/v1/orgs/[orgSlug]/product-pricing/[id]",
    method: "DELETE",
    path: () => `${PP}/${UUID_GHOST}`, // never a live row: a leaked gate deletes nothing
    permission: "MANAGE_PRICING",
    unknownId: () => `${PP}/${UUID_GHOST}`,
    foreignId: async (c: Ctx) => {
      // an org-B row addressed under the Test-Org slug
      const typeId = await typeIdIn(c.orgB, c.run.orgB.slug, "GLASS");
      const r = await putB(c, body(c.run.prefix, typeId, `foreign-${tag()}`));
      expect(r.status(), await r.text()).toBe(200);
      return `${PP}/${((await r.json()) as { row: Row }).row.id}`;
    },
  },
]);

test.describe("product pricing: PUT / GET / DELETE rules (org B)", () => {
  test("create → update in place (one row) → delete-on-empty; shapes; label trimmed; prices sorted", async ({ orgB, run }) => {
    const c = { orgB, run };
    const glass = await typeIdIn(orgB, run.orgB.slug, "GLASS");
    const b = body(run.prefix, glass, `rule-${tag()}`, {
      combinationLabel: `  ${run.prefix}label  `,
      prices: [{ currency: "USD", unit: "sqft", amount: 12.5 }, { currency: "INR", unit: "sqft", amount: 260.12 }, { currency: "INR", unit: "m2", amount: 2800 }],
      description: "  Toughened  ",
    });

    const created = await putB(c, b);
    expect(created.status(), await created.text()).toBe(200);
    const row = ((await created.json()) as { row: Row }).row;
    expect(Object.keys(row).sort()).toEqual(["combinationKey", "combinationLabel", "componentTypeId", "description", "id", "prices", "updatedAt"]);
    expect(row).toMatchObject({ componentTypeId: glass, combinationKey: b.combinationKey, combinationLabel: `${run.prefix}label`, description: "Toughened" });
    expect(row.prices).toEqual([
      { currency: "INR", unit: "m2", amount: 2800 },
      { currency: "INR", unit: "sqft", amount: 260.12 },
      { currency: "USD", unit: "sqft", amount: 12.5 },
    ]);

    // same key again: updated in place, still one row, same id
    const again = await putB(c, { ...b, prices: [{ currency: "AED", unit: "m2", amount: 0 }], description: null });
    expect(again.status(), await again.text()).toBe(200);
    const updated = ((await again.json()) as { row: Row }).row;
    expect(updated.id).toBe(row.id);
    expect(updated.prices).toEqual([{ currency: "AED", unit: "m2", amount: 0 }]); // 0 is a valid price
    expect(updated.description).toBeNull();
    expect((await list(orgB, run.orgB.slug)).filter((r) => r.combinationKey === b.combinationKey)).toHaveLength(1);

    // description only (no prices) keeps the row; blank description + no prices deletes it
    const descOnly = await putB(c, { ...b, prices: [], description: "Only a note" });
    expect(((await descOnly.json()) as { row: Row }).row).toMatchObject({ id: row.id, prices: [], description: "Only a note" });
    const gone = await putB(c, { ...b, prices: [], description: "   " });
    expect(gone.status(), await gone.text()).toBe(200);
    expect(await gone.json()).toEqual({ row: null });
    expect((await list(orgB, run.orgB.slug)).some((r) => r.combinationKey === b.combinationKey)).toBe(false);
    // deleting a row that does not exist through an empty PUT is still { row: null }
    expect(await (await putB(c, { ...b, prices: [], description: null })).json()).toEqual({ row: null });
  });

  test("piece type takes pcs; GET org-scoped and filtered by componentTypeId; DELETE by id then 404", async ({ orgB, run }) => {
    const c = { orgB, run };
    const glass = await typeIdIn(orgB, run.orgB.slug, "GLASS");
    const door = await typeIdIn(orgB, run.orgB.slug, "DOOR");
    const g = body(run.prefix, glass, `g-${tag()}`);
    const d = body(run.prefix, door, `d-${tag()}`, { prices: [{ currency: "AED", unit: "pcs", amount: 450 }] });
    const gr = ((await (await putB(c, g)).json()) as { row: Row }).row;
    const dr = ((await (await putB(c, d)).json()) as { row: Row }).row;

    const all = await list(orgB, run.orgB.slug);
    expect(all.map((r) => r.id)).toEqual(expect.arrayContaining([gr.id, dr.id]));
    const onlyDoor = await list(orgB, run.orgB.slug, `?componentTypeId=${door}`);
    expect(onlyDoor.every((r) => r.componentTypeId === door)).toBe(true);
    expect(onlyDoor.map((r) => r.id)).toContain(dr.id);
    expect(onlyDoor.map((r) => r.id)).not.toContain(gr.id);
    expect(await list(orgB, run.orgB.slug, `?componentTypeId=${UUID_GHOST}`)).toEqual([]);

    for (const row of [gr, dr]) {
      const del = await orgB.delete(orgApi(run.orgB.slug, `${PP}/${row.id}`));
      expect(del.status(), await del.text()).toBe(200);
      expect(await del.json()).toEqual({ ok: true });
      expect((await orgB.delete(orgApi(run.orgB.slug, `${PP}/${row.id}`))).status()).toBe(404); // already gone
    }
  });

  test("tenancy: the Test Org (admin) never sees org B's rows; org B's row survives a Test-Org DELETE of its id", async ({ orgB, as, run }) => {
    const glassB = await typeIdIn(orgB, run.orgB.slug, "GLASS");
    const row = ((await (await putB({ orgB, run }, body(run.prefix, glassB, `ten-${tag()}`))).json()) as { row: Row }).row;
    expect((await list(as.admin, run.testOrg.slug)).some((r) => r.id === row.id)).toBe(false);
    // the Test-Org admin deleting org B's id under its OWN slug: 404, and the row is still there
    expect((await as.admin.delete(orgApi(run.testOrg.slug, `${PP}/${row.id}`))).status()).toBe(404);
    expect((await list(orgB, run.orgB.slug)).some((r) => r.id === row.id)).toBe(true);
    // org B's type addressed from the Test Org's PUT: 404 (foreign type), nothing written
    const foreign = await as.admin.put(orgApi(run.testOrg.slug, PP), { data: body(run.prefix, glassB, "xorg") });
    expect(foreign.status(), await foreign.text()).toBe(404);
    expect((await list(orgB, run.orgB.slug)).filter((r) => r.combinationLabel === `${run.prefix}xorg`)).toHaveLength(0);
    expect((await orgB.delete(orgApi(run.orgB.slug, `${PP}/${row.id}`))).status()).toBe(200);
  });

  test("deleting a ComponentType removes its price rows (cascade); other types' rows are kept", async ({ sa, orgB, run }) => {
    const categories = (await json<{ categories: { id: string }[] }>(await sa.get(`${SA}/component-categories?orgId=${run.orgB.id}`))).categories;
    const code = `${run.prefix}pp-${tag()}`.toUpperCase();
    const made = await sa.post(`${SA}/component-types`, { data: { orgId: run.orgB.id, code, name: `${code} name`, categoryId: categories[0].id } });
    const type = (await json<{ componentType: { id: string } }>(made, 201, "create type")).componentType;
    const glass = await typeIdIn(orgB, run.orgB.slug, "GLASS");

    const mine = ((await (await putB({ orgB, run }, body(run.prefix, type.id, `cas-${tag()}`, { prices: [{ currency: "INR", unit: "pcs", amount: 5 }] }))).json()) as { row: Row }).row;
    const keep = ((await (await putB({ orgB, run }, body(run.prefix, glass, `keep-${tag()}`))).json()) as { row: Row }).row;
    expect((await list(orgB, run.orgB.slug, `?componentTypeId=${type.id}`)).map((r) => r.id)).toEqual([mine.id]);

    expect(await json(await sa.delete(`${SA}/component-types/${type.id}?orgId=${run.orgB.id}`))).toEqual({ ok: true });

    const rows = await list(orgB, run.orgB.slug);
    expect(rows.some((r) => r.id === mine.id)).toBe(false);
    expect(rows.some((r) => r.id === keep.id)).toBe(true);
    expect((await orgB.delete(orgApi(run.orgB.slug, `${PP}/${keep.id}`))).status()).toBe(200);
  });
});
