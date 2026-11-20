import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPriceAmount, formatPriceText, inventoryPriceBasis, priceSuffix, priceUnitLabel } from "../../lib/price-format";

test("amounts: thousands separators, up to 2 decimals, trailing zeros dropped", () => {
  assert.equal(formatPriceAmount("2800.00"), "2,800");
  assert.equal(formatPriceAmount("2650.50"), "2,650.5");
  assert.equal(formatPriceAmount("40"), "40");
  assert.equal(formatPriceAmount("1450.25"), "1,450.25");
  assert.equal(formatPriceAmount(2800), "2,800");
  assert.equal(formatPriceAmount(2800.5), "2,800.5");
  assert.equal(formatPriceAmount("0.00"), "0");
});

test("a value that is not an amount is returned as is, never NaN", () => {
  assert.equal(formatPriceAmount("abc"), "abc");
  assert.equal(formatPriceAmount(Number.NaN), "NaN");
});

test("Q-D22: the text reads '<price> <currency>/<unit>'", () => {
  assert.equal(formatPriceText(2800, "INR", priceUnitLabel("m2")), "2,800 INR/m²");
  assert.equal(formatPriceText("1450", "INR", "pack"), "1,450 INR/pack");
  assert.equal(formatPriceText(260, "INR", priceUnitLabel("sqft")), "260 INR/sq ft");
  assert.equal(formatPriceText(2800, "INR", priceUnitLabel("pcs")), "2,800 INR/pcs");
  assert.equal(priceSuffix("USD", "m²"), "USD/m²");
});

test("Q-D31: the drawer heading says the unit once ('per m²', 'per pack of 3 m')", () => {
  assert.deepEqual(inventoryPriceBasis("m²", "1"), { pack: false, label: "m²" });
  assert.deepEqual(inventoryPriceBasis("metres", 3), { pack: true, label: "3 m" });
  assert.deepEqual(inventoryPriceBasis("set", "2"), { pack: true, label: "2 sets" });
});

test("Q-D25: no formatter output carries an en dash or an em dash", () => {
  const samples = [
    formatPriceText(2800, "INR", "m²"),
    formatPriceText("2650.50", "AED", "sq ft"),
    formatPriceAmount("99999999999.99"),
    inventoryPriceBasis("metres", 3).label,
  ];
  for (const s of samples) assert.doesNotMatch(s, /[–—]/);
});
