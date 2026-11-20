import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeItemPrice, serializeItemWithPrices, validateItemPrices } from "../../lib/item-price";
import { CURRENCY_ERROR_MESSAGE } from "../../lib/currency";

const ok = { currency: "INR", price: 2800, minPrice: 2500, allowAbove: false };

function bad(body: unknown): string {
  const r = validateItemPrices(body);
  assert.equal(r.ok, false);
  return r.ok ? "" : r.error;
}

test("a valid list normalises to 2 dp strings; currency trimmed and upper-cased", () => {
  const r = validateItemPrices([{ ...ok, currency: " inr " }, { currency: "USD", price: "35.5", minPrice: "30", allowAbove: true }]);
  assert.deepEqual(r, {
    ok: true,
    rows: [
      { currency: "INR", price: "2800.00", minPrice: "2500.00", allowAbove: false },
      { currency: "USD", price: "35.50", minPrice: "30.00", allowAbove: true },
    ],
  });
});

test("the empty list is valid, and { prices: [...] } is accepted", () => {
  assert.deepEqual(validateItemPrices([]), { ok: true, rows: [] });
  assert.equal(validateItemPrices({ prices: [ok] }).ok, true);
});

test("minPrice equal to price is valid", () => {
  assert.equal(validateItemPrices([{ ...ok, minPrice: 2800 }]).ok, true);
});

test("400 cases", () => {
  assert.equal(bad("x"), "prices must be an array");
  assert.equal(bad(null), "prices must be an array");
  assert.equal(bad({}), "prices must be an array");
  assert.equal(bad([5]), "prices[0] must be an object");
  assert.equal(bad([{ ...ok, currency: "EUR" }]), CURRENCY_ERROR_MESSAGE);
  assert.equal(bad([{ ...ok, currency: undefined }]), CURRENCY_ERROR_MESSAGE);
  assert.match(bad([ok, { ...ok, currency: "inr" }]), /Duplicate currency INR/);
  assert.match(bad([{ ...ok, price: "abc" }]), /price must be/);
  assert.match(bad([{ ...ok, price: 10.123, minPrice: 1 }]), /price must be/);
  assert.match(bad([{ ...ok, price: -1 }]), /price must be/);
  assert.match(bad([{ ...ok, minPrice: -1 }]), /minPrice must be/);
  assert.match(bad([{ ...ok, minPrice: undefined }]), /minPrice must be/);
  assert.match(bad([{ ...ok, minPrice: 2800.01 }]), /minPrice must not exceed price/);
  assert.match(bad([{ ...ok, allowAbove: undefined }]), /allowAbove must be a boolean/);
  assert.match(bad([{ ...ok, allowAbove: "true" }]), /allowAbove must be a boolean/);
});

test("serializeItemPrice prints 2 dp and keeps other columns; items without prices pass through", () => {
  const row = { id: "p1", currency: "INR", price: "2800", minPrice: { toString: () => "2500.5" }, allowAbove: true };
  assert.deepEqual(serializeItemPrice(row), { ...row, price: "2800.00", minPrice: "2500.50" });
  const item: { id: string; prices?: undefined } = { id: "i1" };
  assert.equal(serializeItemWithPrices(item), item);
  assert.deepEqual(serializeItemWithPrices({ id: "i1", prices: [row] }).prices, [serializeItemPrice(row)]);
});
