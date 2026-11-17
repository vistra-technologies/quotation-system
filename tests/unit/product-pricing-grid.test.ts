import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPricingGrid, MAX_GRID_ROWS, type StoredPricingRow } from "@/lib/product-pricing/grid";
import { combinationKey } from "@/lib/product-pricing/combination";
import { validatePriceEntries } from "@/lib/product-pricing/price-entries";
import type { EstimateField } from "@/lib/quick-estimate/palette";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";

// Stage 36 Batch 3: the page's combination grid (cap, sort, priced count excluding orphans) and the
// Batch 2 review nit (amount stored rounded to 2 dp).

const fields: EstimateField[] = [
  { key: "glass", label: "Glass" },
  { key: "thk", label: "Thickness" },
];
const config: FieldOptionsConfig = {
  glass: { options: ["Single", "Double"] },
  thk: { options: ["12 mm", "8 mm"] },
} as FieldOptionsConfig;

function stored(values: Record<string, string>, label: string, priced = true, id = label): StoredPricingRow {
  return {
    id,
    componentTypeId: "t1",
    combinationKey: combinationKey(values),
    combinationLabel: label,
    prices: priced ? [{ currency: "INR", unit: "m2", amount: 100 }] : [],
    description: priced ? null : "note",
  };
}

test("buildPricingGrid: sorted by label, keys from the shared generator, priced count", () => {
  const g = buildPricingGrid(fields, config, [stored({ glass: "Single", thk: "8 mm" }, "Single · 8 mm")]);
  assert.deepEqual(g.rows.map((r) => r.label), ["Double · 12 mm", "Double · 8 mm", "Single · 12 mm", "Single · 8 mm"]);
  assert.equal(g.total, 4);
  assert.equal(g.capped, false);
  assert.equal(g.pricedCount, 1);
  assert.equal(g.rows[3].row?.id, "Single · 8 mm");
  assert.equal(g.rows[0].row, null);
  assert.equal(g.rows[0].key, combinationKey({ glass: "Double", thk: "12 mm" }));
});

test("buildPricingGrid: orphans are separate, excluded from the priced count, keep the stored label", () => {
  const orphan = stored({ glass: "Laminated", thk: "25 mm" }, "Laminated · 25 mm");
  const g = buildPricingGrid(fields, config, [stored({ glass: "Single", thk: "8 mm" }, "x"), orphan]);
  assert.equal(g.orphans.length, 1);
  assert.equal(g.orphans[0].label, "Laminated · 25 mm");
  assert.deepEqual(g.orphans[0].values, { glass: "Laminated", thk: "25 mm" });
  assert.equal(g.pricedCount, 1);
  assert.equal(g.rows.length, 4);
});

test("buildPricingGrid: a description only row is not priced; a malformed stored key still lists as an orphan", () => {
  const descOnly = stored({ glass: "Double", thk: "8 mm" }, "d", false);
  const bad: StoredPricingRow = { ...stored({ glass: "a" }, "bad"), combinationKey: "not json" };
  const g = buildPricingGrid(fields, config, [descOnly, bad]);
  assert.equal(g.pricedCount, 0);
  assert.equal(g.orphans.length, 1);
  assert.deepEqual(g.orphans[0].values, {});
});

test("buildPricingGrid: more than 500 combinations shows the first 500 by label and reports the total", () => {
  const many: EstimateField[] = [{ key: "n", label: "N" }];
  const opts = Array.from({ length: 520 }, (_, i) => `v${String(i).padStart(4, "0")}`);
  const g = buildPricingGrid(many, { n: { options: opts } } as FieldOptionsConfig, []);
  assert.equal(g.total, 520);
  assert.equal(g.capped, true);
  assert.equal(g.rows.length, MAX_GRID_ROWS);
  assert.equal(g.rows[0].label, "v0000");
  assert.equal(g.rows[MAX_GRID_ROWS - 1].label, "v0499");
});

test("buildPricingGrid: no fields yields an empty grid", () => {
  const g = buildPricingGrid([], {}, []);
  assert.equal(g.total, 0);
  assert.equal(g.rows.length, 0);
});

test("validatePriceEntries stores the amount rounded to 2 decimals", () => {
  const r = validatePriceEntries([{ currency: "INR", unit: "m2", amount: 2800.000000001 }], true);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.entries[0].amount, 2800);
  const r2 = validatePriceEntries([{ currency: "INR", unit: "m2", amount: 12.5 }], true);
  assert.ok(r2.ok);
  if (r2.ok) assert.equal(r2.entries[0].amount, 12.5);
});
