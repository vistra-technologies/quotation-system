/**
 * Inventory items: list/create, get/patch/delete — and their effect on the material engine
 * (INACTIVE_ITEM / UNIT_MISMATCH / UNRESOLVED_CODE through recompute).
 *
 * Gates (route source): every verb → MANAGE_PRICING (admin + member hold it; distributor / architect do not).
 * Tenancy: an org-B item under the Test-Org slug is indistinguishable from a missing one (404).
 *
 * Test-Org items come from `f.inventoryItem` (ledgered kind `inventoryItem`, deleted at teardown) or are
 * ledgered by hand the moment a direct POST returns 201. Org-B items go with org B at teardown.
 *
 * There is NO price write route: `ItemPrice` rows are only read (GET includes `prices`, ordered by
 * currency); `upsertItemPrice` / `deleteItemPrice` in lib/data/catalog.ts have no caller. A new item's
 * `prices` is therefore always [] here.
 */
import type { APIResponse } from "@playwright/test";
import { test, expect } from "../fixtures/test";
import { covers } from "../fixtures/covers";
import type { Guarded } from "../fixtures/clients";
import type { Factories } from "../fixtures/factories";
import type { Ledger } from "../fixtures/ledger";
import type { RunState } from "../fixtures/run-state";
import { registerNegatives, GHOST, type Ctx } from "./api-matrix";
import { orgApi, tag, glassConfig, expectSubmitted, oneCellDesign } from "./project-helpers";
import { ok, rejected } from "./design-helpers";
import { allowTestOrgCodes } from "../fixtures/test-org-codes";

covers("GET /api/v1/orgs/[orgSlug]/inventory");
covers("POST /api/v1/orgs/[orgSlug]/inventory");
covers("GET /api/v1/orgs/[orgSlug]/inventory/[itemId]");
covers("PATCH /api/v1/orgs/[orgSlug]/inventory/[itemId]");
covers("DELETE /api/v1/orgs/[orgSlug]/inventory/[itemId]");

type Item = {
  id: string;
  organizationId: string;
  category: string;
  code: string;
  name: string;
  measurementUnit: string;
  perUnitQuantity: string | number;
  active: boolean;
  attributes: Record<string, unknown>;
  componentTypeId: string | null;
  componentType: { id: string; code: string; name: string } | null;
  prices?: unknown[];
};
type Problem = { kind: string; scope: string; message: string; code?: string };

const UNITS = ["metres", "pieces", "m²", "mm", "ft", "set"] as const;
const UNIT_ERR = 'measurementUnit is required and must be "metres" or "pieces" or "m²" or "mm" or "ft" or "set"';

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

/** One ledgered Test-Org item per worker, used as a read-only path by the matrix. */
const sharedItemId = (c: Ctx) => once("sharedItem", async () => (await c.f.inventoryItem()).id);

/** One org-B item per worker (rgr- code; deleted with org B) for foreign-id probes. */
function foreignItemId(c: Pick<Ctx, "run" | "orgB">): Promise<string> {
  return once("orgB-item", async () => {
    const r = await c.orgB.post(orgApi(c.run.orgB.slug, "/inventory"), {
      data: { code: `${c.run.prefix}b-inv-${tag()}`, name: "org B item", measurementUnit: "pieces" },
    });
    expect(r.status(), await r.text()).toBe(201);
    return ((await r.json()) as { item: { id: string } }).item.id;
  });
}

/** Component type id by code, as seen by `g` in org `slug`. */
async function typeIdIn(g: Guarded, slug: string, code: string): Promise<string> {
  const r = await g.get(orgApi(slug, "/component-types"));
  expect(r.status(), await r.text()).toBe(200);
  const id = ((await r.json()) as { componentTypes: { id: string; code: string }[] }).componentTypes.find((t) => t.code === code)?.id;
  if (!id) throw new Error(`org ${slug} has no ComponentType ${code}`);
  return id;
}

/**
 * POST /inventory as `g` in the Test Org and ledger any 201 immediately, under the TRIMMED code that was
 * sent (the route stores `code.trim()`; deletion is by id), so a padded code is always ledgerable.
 * A network error (no response — the server may have committed) triggers one lookup by that trimmed code
 * and ledgers a match before rethrowing; the case-/padding-tolerant teardown sweep is the backstop.
 */
async function createItem(g: Guarded, deps: { run: RunState; ledger: Ledger }, data: Record<string, unknown>) {
  const slug = deps.run.testOrg.slug;
  const sent = typeof data.code === "string" ? data.code.trim() : "";
  if (!sent.startsWith(deps.run.prefix)) throw new Error(`createItem: code "${sent}" must start with the run prefix ${deps.run.prefix}`);
  const add = (id: string) => deps.ledger.add({ kind: "inventoryItem", id, orgSlug: slug, label: sent });
  let res: APIResponse;
  try {
    res = await g.post(orgApi(slug, "/inventory"), { data });
  } catch (err) {
    try {
      const l = await g.get(orgApi(slug, "/inventory"));
      if (l.ok()) {
        const known = new Set(deps.ledger.all().map((e) => e.id)); // e.g. the factory item a duplicate collided with
        for (const x of ((await l.json()) as { items: Item[] }).items) if (x.code === sent && !known.has(x.id)) add(x.id);
      }
    } catch {
      /* best effort — the sweep still finds an rgr- code */
    }
    throw err;
  }
  const text = await res.text();
  let item: Item | null = null;
  if (res.status() === 201) {
    item = (JSON.parse(text) as { item: Item }).item;
    add(item.id);
  }
  return { res, text, item };
}

const code = (c: { run: RunState }, what: string) => `${c.run.prefix}inv-${what}-${tag()}`;

const postInvalid = [
  { name: "{} (code, name, measurementUnit required)", body: {}, status: 400 },
  { name: "code + name but no measurementUnit", body: (c: Ctx) => ({ code: `${c.run.prefix}x`, name: "n" }), status: 400 },
  { name: 'measurementUnit "parsecs"', body: (c: Ctx) => ({ code: `${c.run.prefix}x`, name: "n", measurementUnit: "parsecs" }), status: 400 },
  { name: 'measurementUnit "Metres" (case-sensitive)', body: (c: Ctx) => ({ code: `${c.run.prefix}x`, name: "n", measurementUnit: "Metres" }), status: 400 },
  { name: "perUnitQuantity -1", body: (c: Ctx) => ({ code: `${c.run.prefix}x`, name: "n", measurementUnit: "pieces", perUnitQuantity: -1 }), status: 400 },
  { name: "perUnitQuantity 0", body: (c: Ctx) => ({ code: `${c.run.prefix}x`, name: "n", measurementUnit: "pieces", perUnitQuantity: 0 }), status: 400 },
  { name: 'perUnitQuantity "2" (string)', body: (c: Ctx) => ({ code: `${c.run.prefix}x`, name: "n", measurementUnit: "pieces", perUnitQuantity: "2" }), status: 400 },
  { name: 'active "yes"', body: (c: Ctx) => ({ code: `${c.run.prefix}x`, name: "n", measurementUnit: "pieces", active: "yes" }), status: 400 },
  { name: "attributes []", body: (c: Ctx) => ({ code: `${c.run.prefix}x`, name: "n", measurementUnit: "pieces", attributes: [] }), status: 400 },
  { name: "attributes null", body: (c: Ctx) => ({ code: `${c.run.prefix}x`, name: "n", measurementUnit: "pieces", attributes: null }), status: 400 },
  // A blank code can never carry the rgr- prefix, so a wrongly accepted one would be unledgerable and
  // unsweepable (it would be stored as ""). Kept because the route rejects it before any write (code is
  // validated first) and the matrix's loud-2xx guard names the leak; the name carries the run prefix so a
  // human can find such a row.
  { name: "blank code", body: (c: Ctx) => ({ code: "   ", name: `${c.run.prefix}blank-code`, measurementUnit: "pieces" }), status: 400 },
  { name: "blank name", body: (c: Ctx) => ({ code: `${c.run.prefix}x`, name: "  ", measurementUnit: "pieces" }), status: 400 },
  { name: "componentTypeId 5 (not a string)", body: (c: Ctx) => ({ code: `${c.run.prefix}x`, name: "n", measurementUnit: "pieces", componentTypeId: 5 }), status: 400 },
  { name: "JSON null body", body: null, status: 400 },
  { name: "componentTypeId unknown → 422", body: (c: Ctx) => ({ code: `${c.run.prefix}x`, name: "n", measurementUnit: "pieces", componentTypeId: GHOST }), status: 422 },
  {
    name: "componentTypeId of org B's GLASS → 422 (FK-injection guard)",
    body: async (c: Ctx) => ({ code: `${c.run.prefix}x`, name: "n", measurementUnit: "pieces", componentTypeId: await typeIdIn(c.orgB, c.run.orgB.slug, "GLASS") }),
    status: 422,
  },
];

const patchInvalid = [
  { name: "{} (at least one field)", body: {}, status: 400 },
  { name: "attributes only (not an updatable field)", body: { attributes: { a: 1 } }, status: 400 },
  { name: "blank code", body: { code: " " }, status: 400 },
  { name: "name 5", body: { name: 5 }, status: 400 },
  { name: 'measurementUnit "parsecs"', body: { measurementUnit: "parsecs" }, status: 400 },
  { name: "perUnitQuantity 0", body: { perUnitQuantity: 0 }, status: 400 },
  { name: 'active "yes"', body: { active: "yes" }, status: 400 },
  { name: "componentTypeId 5", body: { componentTypeId: 5 }, status: 400 },
  { name: "JSON null body", body: null, status: 400 },
];

registerNegatives([
  { key: "GET /api/v1/orgs/[orgSlug]/inventory", method: "GET", path: () => "/inventory", permission: "MANAGE_PRICING" },
  {
    key: "POST /api/v1/orgs/[orgSlug]/inventory",
    method: "POST",
    path: () => "/inventory",
    permission: "MANAGE_PRICING",
    body: (c) => ({ code: `${c.run.prefix}neg-inv-auth` }), // incomplete → a leaked gate still creates nothing
    invalid: postInvalid,
  },
  {
    key: "GET /api/v1/orgs/[orgSlug]/inventory/[itemId]",
    method: "GET",
    path: async (c) => `/inventory/${await sharedItemId(c)}`,
    permission: "MANAGE_PRICING",
    unknownId: () => `/inventory/${GHOST}`,
    foreignId: async (c) => `/inventory/${await foreignItemId(c)}`,
  },
  {
    key: "PATCH /api/v1/orgs/[orgSlug]/inventory/[itemId]",
    method: "PATCH",
    path: () => `/inventory/${GHOST}`, // never a live row: a leaked gate updates nothing
    permission: "MANAGE_PRICING",
    body: (c) => ({ name: `${c.run.prefix}neg-inv` }),
    unknownId: () => `/inventory/${GHOST}`,
    foreignId: async (c) => `/inventory/${await foreignItemId(c)}`,
    invalid: patchInvalid,
  },
  {
    key: "DELETE /api/v1/orgs/[orgSlug]/inventory/[itemId]",
    method: "DELETE",
    path: () => `/inventory/${GHOST}`,
    permission: "MANAGE_PRICING",
    unknownId: () => `/inventory/${GHOST}`,
    foreignId: async (c) => `/inventory/${await foreignItemId(c)}`,
  },
]);

test.describe("inventory: CRUD rules", () => {
  test("create (all fields) → get → list; defaults; the response shapes", async ({ as, run, ledger, url }) => {
    const c = code({ run }, "full");
    const { res, text, item } = await createItem(as.admin, { run, ledger }, {
      code: `  ${c}  `, name: `${c} name`, measurementUnit: "metres", perUnitQuantity: 2.5, active: false, attributes: { colour: "white", n: 3 },
    });
    expect(res.status(), text).toBe(201);
    expect(item).toMatchObject({
      code: c, name: `${c} name`, measurementUnit: "metres", active: false, attributes: { colour: "white", n: 3 },
      organizationId: run.testOrg.id, category: "", componentTypeId: null, componentType: null,
    });
    expect(Number(item!.perUnitQuantity)).toBe(2.5);
    expect(item).not.toHaveProperty("prices"); // create echoes componentType only

    const g = await ok<{ item: Item }>(await as.member.get(url(`/inventory/${item!.id}`)));
    expect(g.item).toMatchObject({ id: item!.id, code: c, active: false, componentType: null, prices: [] });
    expect(Number(g.item.perUnitQuantity)).toBe(2.5);

    const l = await ok<{ items: Item[] }>(await as.admin.get(url("/inventory")));
    const row = l.items.find((x) => x.id === item!.id);
    expect(row).toMatchObject({ code: c, active: false, prices: [], componentType: null }); // inactive items are listed too
    for (const x of l.items) expect(x.organizationId).toBe(run.testOrg.id);

    // defaults
    const d = await createItem(as.admin, { run, ledger }, { code: code({ run }, "dflt"), name: "defaults", measurementUnit: "pieces" });
    expect(d.res.status(), d.text).toBe(201);
    expect(d.item).toMatchObject({ active: true, attributes: {}, componentTypeId: null, category: "" });
    expect(Number(d.item!.perUnitQuantity)).toBe(1);
  });

  test("every measurementUnit round-trips (create with m², PATCH through all six)", async ({ as, run, ledger, url }) => {
    const { res, text, item } = await createItem(as.admin, { run, ledger }, { code: code({ run }, "units"), name: "units", measurementUnit: "m²" });
    expect(res.status(), text).toBe(201);
    expect(item!.measurementUnit).toBe("m²");
    for (const u of UNITS) {
      const p = await ok<{ item: Item }>(await as.admin.patch(url(`/inventory/${item!.id}`), { data: { measurementUnit: u } }));
      expect(p.item.measurementUnit).toBe(u);
      expect((await ok<{ item: Item }>(await as.admin.get(url(`/inventory/${item!.id}`)))).item.measurementUnit).toBe(u);
    }
    // the POST message names the whole list
    await rejected((await createItem(as.admin, { run, ledger }, { code: code({ run }, "bad"), name: "n", measurementUnit: "kg" })).res, 400, UNIT_ERR);
  });

  test("duplicate code → 409 (also after trimming); codes are case-sensitive; the same code is free in org B", async ({ as, f, run, ledger, url, orgB }) => {
    const a = await f.inventoryItem();
    const msg = (c: string) => `An inventory item with code "${c}" already exists in this organization`;
    // through createItem: a wrongly accepted duplicate (201) is still ledgered
    const dup = await createItem(as.admin, { run, ledger }, { code: a.code, name: "dup", measurementUnit: "pieces" });
    await rejected(dup.res, 409, msg(a.code));
    // the error echoes the code as sent (untrimmed); the stored code is trimmed so it collides
    const padded = await createItem(as.member, { run, ledger }, { code: ` ${a.code} `, name: "dup", measurementUnit: "pieces" });
    await rejected(padded.res, 409, msg(` ${a.code} `));

    // codes are NOT case-normalised: a variant with an upper-cased tail is a different item (the rgr- prefix
    // itself stays lower-case so the row is ledgered and sweepable)
    const variant = run.prefix + a.code.slice(run.prefix.length).toUpperCase();
    expect(variant).not.toBe(a.code);
    const upper = await createItem(as.admin, { run, ledger }, { code: variant, name: "upper", measurementUnit: "pieces" });
    expect(upper.res.status(), upper.text).toBe(201);
    expect(upper.item!.code).toBe(variant);

    // uniqueness is per org: org B may hold the same code (row goes with org B)
    const b = await orgB.post(orgApi(run.orgB.slug, "/inventory"), { data: { code: a.code, name: "org B twin", measurementUnit: "pieces" } });
    expect(b.status(), await b.text()).toBe(201);

    // PATCH onto a taken code → 409; nothing changes
    const other = await f.inventoryItem();
    await rejected(await as.admin.patch(url(`/inventory/${other.id}`), { data: { code: a.code, name: "renamed" } }), 409, msg(a.code));
    const after = (await ok<{ item: Item }>(await as.admin.get(url(`/inventory/${other.id}`)))).item;
    expect(after).toMatchObject({ code: other.code, name: `${other.code} name` });
  });

  test("PATCH is a partial update: only the sent fields change; code is trimmed", async ({ as, f, url }) => {
    const it = await f.inventoryItem({ measurementUnit: "metres", perUnitQuantity: 3, attributes: { keep: true } });
    const before = (await ok<{ item: Item }>(await as.admin.get(url(`/inventory/${it.id}`)))).item;

    const p1 = (await ok<{ item: Item }>(await as.member.patch(url(`/inventory/${it.id}`), { data: { name: `${it.code} renamed` } }))).item;
    expect(p1).toEqual({ ...before, name: `${it.code} renamed`, updatedAt: expect.any(String) });

    const p2 = (await ok<{ item: Item }>(await as.admin.patch(url(`/inventory/${it.id}`), { data: { perUnitQuantity: 12, active: false } }))).item;
    expect(Number(p2.perUnitQuantity)).toBe(12);
    expect(p2).toMatchObject({ active: false, name: `${it.code} renamed`, measurementUnit: "metres", attributes: { keep: true } });

    const p3 = (await ok<{ item: Item }>(await as.admin.patch(url(`/inventory/${it.id}`), { data: { active: true, code: `  ${it.code}  ` } }))).item;
    expect(p3).toMatchObject({ active: true, code: it.code });
  });

  test("componentTypeId links an item to GLASS (it then shows under that type); null clears; foreign / unknown type → 422", async ({ as, f, run, ledger, url, orgB }) => {
    const glass = await typeIdIn(as.admin, run.testOrg.slug, "GLASS");
    const door = await typeIdIn(as.admin, run.testOrg.slug, "DOOR");
    const it = await f.inventoryItem();

    const p = (await ok<{ item: Item }>(await as.admin.patch(url(`/inventory/${it.id}`), { data: { componentTypeId: glass } }))).item;
    expect(p.componentTypeId).toBe(glass);
    // the type's name is NOT asserted: projects.spec.ts renames GLASS for a short window
    expect(p.componentType).toEqual({ id: glass, code: "GLASS", name: expect.any(String) });
    const list = (await ok<{ items: Item[] }>(await as.admin.get(url("/inventory")))).items;
    expect(list.filter((x) => x.componentType?.code === "GLASS").map((x) => x.id)).toContain(it.id);
    expect(list.filter((x) => x.componentType?.code === "DOOR").map((x) => x.id)).not.toContain(it.id);

    const typeErr = "ComponentType not found or belongs to a different org";
    const bGlass = await typeIdIn(orgB, run.orgB.slug, "GLASS");
    await rejected(await as.admin.patch(url(`/inventory/${it.id}`), { data: { componentTypeId: bGlass } }), 422, typeErr);
    await rejected(await as.admin.patch(url(`/inventory/${it.id}`), { data: { componentTypeId: GHOST } }), 422, typeErr);
    expect((await ok<{ item: Item }>(await as.admin.get(url(`/inventory/${it.id}`)))).item.componentTypeId).toBe(glass);

    const cleared = (await ok<{ item: Item }>(await as.admin.patch(url(`/inventory/${it.id}`), { data: { componentTypeId: null } }))).item;
    expect(cleared).toMatchObject({ componentTypeId: null, componentType: null });

    // create linked to DOOR
    const d = await createItem(as.member, { run, ledger }, { code: code({ run }, "door"), name: "door item", measurementUnit: "set", componentTypeId: door });
    expect(d.res.status(), d.text).toBe(201);
    expect(d.item!.componentType).toEqual({ id: door, code: "DOOR", name: expect.any(String) });
  });

  test("DELETE → 204 with an empty body; afterwards GET / PATCH / DELETE → 404 and the list no longer has it", async ({ as, f, url, ledger }) => {
    const it = await f.inventoryItem();
    const d = await as.member.delete(url(`/inventory/${it.id}`));
    expect(d.status(), await d.text()).toBe(204);
    expect(await d.text()).toBe("");
    ledger.remove(it.id);
    await rejected(await as.admin.get(url(`/inventory/${it.id}`)), 404, "Inventory item not found");
    await rejected(await as.admin.patch(url(`/inventory/${it.id}`), { data: { name: "gone" } }), 404, "Inventory item not found");
    await rejected(await as.admin.delete(url(`/inventory/${it.id}`)), 404, "Inventory item not found");
    expect((await ok<{ items: Item[] }>(await as.admin.get(url("/inventory")))).items.map((x) => x.id)).not.toContain(it.id);
  });

  test("list order: category, then code (every API-created item has category \"\")", async ({ as, run, ledger, url }) => {
    const t = tag();
    for (const s of ["c", "a", "b"]) {
      const r = await createItem(as.admin, { run, ledger }, { code: `${run.prefix}ord-${t}-${s}`, name: s, measurementUnit: "pieces" });
      expect(r.res.status(), r.text).toBe(201);
    }
    const codes = (await ok<{ items: Item[] }>(await as.admin.get(url("/inventory")))).items.map((x) => x.code).filter((x) => x.startsWith(`${run.prefix}ord-${t}-`));
    expect(codes).toEqual(["a", "b", "c"].map((s) => `${run.prefix}ord-${t}-${s}`));
  });

  test("tenancy: org B cannot see, edit or delete a Test-Org item through its own slug, and vice versa", async ({ as, f, run, url, orgB }) => {
    const it = await f.inventoryItem();
    const before = (await ok<{ item: Item }>(await as.admin.get(url(`/inventory/${it.id}`)))).item;
    const B = (p: string) => orgApi(run.orgB.slug, p);
    await rejected(await orgB.get(B(`/inventory/${it.id}`)), 404, "Inventory item not found");
    await rejected(await orgB.patch(B(`/inventory/${it.id}`), { data: { name: `${run.prefix}hijack` } }), 404, "Inventory item not found");
    await rejected(await orgB.delete(B(`/inventory/${it.id}`)), 404, "Inventory item not found");
    const bList = (await ok<{ items: Item[] }>(await orgB.get(B("/inventory")))).items;
    expect(bList.map((x) => x.id)).not.toContain(it.id);
    for (const x of bList) expect(x.organizationId).toBe(run.orgB.id);
    expect((await ok<{ item: Item }>(await as.admin.get(url(`/inventory/${it.id}`)))).item).toEqual(before);

    // the org-B item is invisible from the Test Org's list
    const foreign = await foreignItemId({ run, orgB });
    expect((await ok<{ items: Item[] }>(await as.admin.get(url("/inventory")))).items.map((x) => x.id)).not.toContain(foreign);
  });

  // KNOWN BUG (pinned, R24): `code` is trimmed on create and PATCH, `name` is stored verbatim — leading /
  // trailing spaces survive (every other name in the API is trimmed). When fixed: expect `name` trimmed.
  test("KNOWN BUG: inventory names are not trimmed on create or PATCH", async ({ as, run, ledger, url }) => {
    const c = code({ run }, "pad");
    const r = await createItem(as.admin, { run, ledger }, { code: c, name: "  padded  ", measurementUnit: "pieces" });
    expect(r.res.status(), r.text).toBe(201);
    expect(r.item!.name).toBe("  padded  ");
    const p = (await ok<{ item: Item }>(await as.admin.patch(url(`/inventory/${r.item!.id}`), { data: { name: " again " } }))).item;
    expect(p.name).toBe(" again ");
  });
});

/** f.wall + one GLASS selection whose `u_profile` points at `uProfileCode`, then Submit Design → 200. */
async function submittedUsing(f: Factories, admin: Guarded, url: (p: string) => string, uProfileCode: string) {
  // S31-7: both the shared codes and this test's own u_profile code must be dropdown choices before the project exists
  const cfg = { ...(await glassConfig(f)), u_profile: uProfileCode };
  await allowTestOrgCodes("GLASS", { u_profile: uProfileCode });
  const w = await f.wall();
  const sel = await f.selection(w.projectId, "GLASS", cfg);
  const p = await admin.patch(url(`/partitions/${w.partitionId}`), { data: { heightMm: 2400, design: oneCellDesign(sel.id) } });
  expect(p.status(), await p.text()).toBe(200);
  await expectSubmitted(await admin.post(url(`/projects/${w.projectId}/submit-design`)));
  return w;
}

async function expectRefused(r: APIResponse, kind: string, itemCode: string): Promise<Problem> {
  const rep = await ok<{ ok: boolean; problems: Problem[]; problemCount: number; error: string }>(r, 422);
  expect(rep.ok).toBe(false);
  expect(rep.problemCount).toBe(rep.problems.length);
  const hit = rep.problems.find((p) => p.kind === kind && p.code === itemCode);
  expect(hit, JSON.stringify(rep.problems)).toBeTruthy();
  expect(hit!.scope).toBe("INVENTORY");
  return hit!;
}

test.describe("inventory: effect on the material engine (recompute)", () => {
  test("INACTIVE_ITEM: deactivating a used item makes recompute refuse (422) and leaves the stored calculation alone; reactivating fixes it", async ({ as, f, url }) => {
    const it = await f.inventoryItem({ measurementUnit: "metres" }); // a Test-Org row this test owns
    const w = await submittedUsing(f, as.admin, url, it.code);
    const calc0 = await ok<{ computedAt: string; materialList: { code: string }[] }>(await as.admin.get(url(`/projects/${w.projectId}/calculation`)));
    expect(calc0.materialList.map((l) => l.code)).toContain(it.code);

    try {
      await ok(await as.member.patch(url(`/inventory/${it.id}`), { data: { active: false } }));
      const hit = await expectRefused(await as.admin.post(url(`/projects/${w.projectId}/recompute`)), "INACTIVE_ITEM", it.code);
      expect(hit.message).toBe(`Inventory item "${it.code}" is inactive`);
      const calc1 = await ok<{ computedAt: string }>(await as.admin.get(url(`/projects/${w.projectId}/calculation`)));
      expect(calc1.computedAt).toBe(calc0.computedAt); // refusal is not an invalidation
    } finally {
      await ok(await as.admin.patch(url(`/inventory/${it.id}`), { data: { active: true } }));
    }
    expect((await ok<{ item: Item }>(await as.admin.get(url(`/inventory/${it.id}`)))).item.active).toBe(true);
    await ok(await as.admin.post(url(`/projects/${w.projectId}/recompute`)));
  });

  test("UNIT_MISMATCH: changing a used item's unit makes recompute refuse; restoring it fixes it", async ({ as, f, url }) => {
    const it = await f.inventoryItem({ measurementUnit: "metres" });
    const w = await submittedUsing(f, as.admin, url, it.code);
    try {
      await ok(await as.admin.patch(url(`/inventory/${it.id}`), { data: { measurementUnit: "pieces" } }));
      await expectRefused(await as.admin.post(url(`/projects/${w.projectId}/recompute`)), "UNIT_MISMATCH", it.code);
    } finally {
      await ok(await as.admin.patch(url(`/inventory/${it.id}`), { data: { measurementUnit: "metres" } }));
    }
    await ok(await as.admin.post(url(`/projects/${w.projectId}/recompute`)));
  });

  // DECISION NEEDED (pinned, not a confirmed bug): DELETE has no "in use" guard (Hotfix 2026-09-27 H-6 only
  // cascades ItemPrice rows). Deleting an item that a submitted project's selection references succeeds
  // (204), and that project's next recompute is refused with UNRESOLVED_CODE. If a guard is added, expect
  // 409 here instead and keep the recompute 200.
  test("DECISION NEEDED: deleting an item a submitted project uses → 204; recompute then refuses with UNRESOLVED_CODE", async ({ as, f, url, ledger }) => {
    const it = await f.inventoryItem({ measurementUnit: "metres" });
    const w = await submittedUsing(f, as.admin, url, it.code);
    const d = await as.admin.delete(url(`/inventory/${it.id}`));
    expect(d.status(), await d.text()).toBe(204);
    ledger.remove(it.id);
    await expectRefused(await as.admin.post(url(`/projects/${w.projectId}/recompute`)), "UNRESOLVED_CODE", it.code);
    // the stored calculation still exists (refusal leaves it untouched)
    expect((await as.admin.get(url(`/projects/${w.projectId}/calculation`))).status()).toBe(200);
  });
});
