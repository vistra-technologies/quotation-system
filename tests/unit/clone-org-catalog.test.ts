/**
 * Unit tests for the pure exports of prisma/clone-org-catalog.ts. Importing the script is safe without
 * a DB: main() only runs when the module is the process entrypoint.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildCopyPlan,
  diffCatalogs,
  canon,
  ALLOWED_TARGET_SLUG,
  type CatalogSource,
} from "../../prisma/clone-org-catalog";

const src: CatalogSource = {
  categories: [{ id: "c1", name: "Glass" }],
  componentTypes: [
    { id: "t1", code: "GLASS", name: "Glass", categoryId: "c1", fieldsSchema: { b: 1, a: [1, 2] }, active: true, sortOrder: 1 },
  ],
  orgConfigs: [{ componentTypeId: "t1", fieldOptionsConfig: { f: { options: ["x"] } } }],
  items: [
    { id: "i1", code: "G-1", name: "Pane", category: "glass", measurementUnit: "m2", perUnitQuantity: "1", attributes: { k: 1 }, active: true, componentTypeId: "t1" },
    { id: "i2", code: "X-1", name: "Loose", category: "misc", measurementUnit: "pc", perUnitQuantity: "1", attributes: {}, active: false, componentTypeId: null },
  ],
  prices: [{ inventoryItemId: "i1", currency: "INR", price: "10.5" }],
};

function counter() {
  let n = 0;
  return () => `new-${++n}`;
}

describe("buildCopyPlan", () => {
  test("assigns fresh ids, retargets org, and remaps every FK", () => {
    const p = buildCopyPlan(src, "org-v", counter());
    const ids = [...p.categories, ...p.componentTypes, ...p.orgConfigs, ...p.items, ...p.prices].map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((i) => i.startsWith("new-")));
    assert.ok([...p.categories, ...p.componentTypes, ...p.orgConfigs, ...p.items, ...p.prices].every((r) => r.organizationId === "org-v"));
    assert.equal(p.componentTypes[0].categoryId, p.categories[0].id);
    assert.equal(p.orgConfigs[0].componentTypeId, p.componentTypes[0].id);
    assert.equal(p.items[0].componentTypeId, p.componentTypes[0].id);
    assert.equal(p.items[1].componentTypeId, null);
    assert.equal(p.prices[0].inventoryItemId, p.items[0].id);
  });

  test("throws on a dangling reference rather than writing a broken row", () => {
    const bad = { ...src, prices: [{ inventoryItemId: "nope", currency: "INR", price: "1" }] };
    assert.throws(() => buildCopyPlan(bad, "org-v", counter()), /Dangling inventoryItem/);
  });
});

describe("diffCatalogs", () => {
  test("a faithful copy (new ids, reordered JSON keys) diffs clean", () => {
    const p = buildCopyPlan(src, "org-v", counter());
    const copy: CatalogSource = {
      categories: p.categories,
      componentTypes: p.componentTypes.map((t) => ({ ...t, fieldsSchema: { a: [1, 2], b: 1 } })),
      orgConfigs: p.orgConfigs,
      items: p.items,
      prices: p.prices,
    };
    assert.deepEqual(diffCatalogs(src, copy), []);
  });

  test("reports changed, missing and extra rows", () => {
    const p = buildCopyPlan(src, "org-v", counter());
    const copy: CatalogSource = {
      categories: p.categories,
      componentTypes: p.componentTypes,
      orgConfigs: [],
      items: [{ ...p.items[0], name: "Renamed" }, { ...p.items[1], code: "EXTRA" }],
      prices: p.prices,
    };
    const d = diffCatalogs(src, copy).join("\n");
    assert.match(d, /configs "GLASS": missing in target/);
    assert.match(d, /items "G-1": values differ/);
    assert.match(d, /items "X-1": missing in target/);
    assert.match(d, /items "EXTRA": only in target/);
  });
});

describe("misc", () => {
  test("canon is key-order independent", () => {
    assert.equal(canon({ a: 1, b: { c: 2, d: 3 } }), canon({ b: { d: 3, c: 2 }, a: 1 }));
  });
  test("only vistra is writable", () => {
    assert.equal(ALLOWED_TARGET_SLUG, "vistra");
  });
});
