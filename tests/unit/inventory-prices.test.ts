import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPricesPayload,
  currencyOrder,
  draftsFromPrices,
  freeCurrencies,
  isPricedIn,
  isPricesDirty,
  priceIssues,
  priceSortValue,
  pricesValid,
  sortPrices,
} from "../../lib/inventory-prices";
import type { PriceDraft, StoredPrice } from "../../lib/inventory-prices";
import { validateItemPrices } from "../../lib/item-price";
import { DEFAULT_SORT, filterItems, sortItems, tabPricedCounts } from "../../lib/inventory-list";
import type { ListItem, ListType } from "../../lib/inventory-list";

const inr: StoredPrice = { currency: "INR", price: "2800.00", minPrice: "2500.00", allowAbove: false };
const aed: StoredPrice = { currency: "AED", price: "118.00", minPrice: "105.00", allowAbove: true };
const usd: StoredPrice = { currency: "USD", price: "35.00", minPrice: "30.00", allowAbove: false };

const row = (over: Partial<PriceDraft> = {}): PriceDraft => ({ currency: "INR", price: "100", minPrice: "80", allowAbove: false, ...over });

test("currency order: the org default first, then the supported list order", () => {
  assert.deepEqual(currencyOrder("AED"), ["AED", "INR", "USD"]);
  assert.deepEqual(currencyOrder("INR"), ["INR", "AED", "USD"]);
  assert.deepEqual(currencyOrder(undefined), ["INR", "AED", "USD"]);
  assert.deepEqual(sortPrices([usd, inr, aed], "USD").map((p) => p.currency), ["USD", "INR", "AED"]);
});

test("free currencies exclude the used ones and keep the default first", () => {
  assert.deepEqual(freeCurrencies([row({ currency: "INR" })], "INR"), ["AED", "USD"]);
  assert.deepEqual(freeCurrencies([row({ currency: "INR" })], "AED"), ["AED", "USD"]);
  assert.deepEqual(freeCurrencies([row({ currency: "AED" }), row({ currency: "INR" }), row({ currency: "USD" })]), []);
});

test("issues: max, then min, then min above max; blank and negative are invalid; min equal to max is fine", () => {
  const issues = priceIssues([
    row(),
    row({ price: "" }),
    row({ price: "-5" }),
    row({ price: "10.123" }),
    row({ minPrice: "" }),
    row({ minPrice: "-1" }),
    row({ price: "80", minPrice: "80" }),
    row({ price: "79.99", minPrice: "80" }),
    row({ price: "0", minPrice: "0" }),
  ]);
  assert.deepEqual(issues, [null, "maxInvalid", "maxInvalid", "maxInvalid", "minInvalid", "minInvalid", null, "minAboveMax", null]);
  assert.equal(pricesValid([row(), row({ currency: "AED" })]), true);
  assert.equal(pricesValid([row({ minPrice: "999" })]), false);
});

test("the draft rule agrees with the server validator (one rule, two places)", () => {
  const cases: Array<[string, string]> = [["100", "80"], ["80", "80"], ["79.99", "80"], ["1e3", "1"], ["-1", "0"], ["10.123", "1"], ["", "0"], ["5", ""], ["0", "0"]];
  for (const [price, minPrice] of cases) {
    const client = pricesValid([row({ price, minPrice })]);
    const server = validateItemPrices([{ currency: "INR", price, minPrice, allowAbove: false }]).ok;
    assert.equal(client, server, `price=${price} min=${minPrice}`);
  }
});

test("payload: 2 dp strings, invalid rows dropped, the fresh flag never sent", () => {
  const payload = buildPricesPayload([row({ price: "2800", minPrice: "2500.5", allowAbove: true, fresh: true }), row({ currency: "AED", price: "x" })]);
  assert.deepEqual(payload, [{ currency: "INR", price: "2800.00", minPrice: "2500.50", allowAbove: true }]);
  assert.deepEqual(buildPricesPayload([]), []);
});

test("dirty: any value, a row added or removed; amounts compare as numbers; the fresh flag is ignored", () => {
  const saved = draftsFromPrices([inr, aed], "INR");
  assert.equal(isPricesDirty(saved, draftsFromPrices([inr, aed], "INR")), false);
  assert.equal(isPricesDirty(saved, saved.map((r) => ({ ...r, price: r.price.replace(".00", "") }))), false);
  assert.equal(isPricesDirty(saved, saved.map((r) => ({ ...r, fresh: true }))), false);
  assert.equal(isPricesDirty(saved, [saved[0]]), true);
  assert.equal(isPricesDirty(saved, [...saved, row({ currency: "USD" })]), true);
  assert.equal(isPricesDirty(saved, saved.map((r, i) => (i === 0 ? { ...r, allowAbove: true } : r))), true);
  assert.equal(isPricesDirty(saved, saved.map((r, i) => (i === 1 ? { ...r, minPrice: "1" } : r))), true);
});

// ─── list: priced in the default currency, sort, tab counts ───────────────────────────────────────────────────

const item = (id: string, prices: StoredPrice[] | undefined, over: Partial<ListItem> = {}): ListItem => ({
  id,
  code: id,
  name: `${id} name`,
  componentTypeId: "t1",
  measurementUnit: "pieces",
  perUnitQuantity: 1,
  soldInWholePacks: true,
  partKey: null,
  attributes: {},
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  prices,
  ...over,
});
const types: ListType[] = [{ id: "t1", code: "T1", name: "Type 1", fieldsSchema: [], fieldOptionsConfig: null }];
const items = [item("a", [inr]), item("b", [aed]), item("c", undefined), item("d", [inr, aed], { componentTypeId: null }), item("e", [], { active: false })];

test("Priced / Unpriced mean 'has a price in the default currency'", () => {
  const f = { tab: "all", q: "", active: false, inactive: false, currency: "INR" };
  assert.deepEqual(filterItems(items, { ...f, priced: true }).map((i) => i.id), ["a", "d"]);
  assert.deepEqual(filterItems(items, { ...f, unpriced: true }).map((i) => i.id), ["b", "c", "e"]);
  assert.equal(filterItems(items, { ...f, priced: true, unpriced: true }).length, 5);
  assert.equal(filterItems(items, f).length, 5);
  assert.deepEqual(filterItems(items, { ...f, currency: "AED", priced: true }).map((i) => i.id), ["b", "d"]);
  // no currency known: the price filter is not applied
  assert.equal(filterItems(items, { tab: "all", q: "", active: false, inactive: false, priced: true }).length, 5);
});

test("tab counts: priced over total in the default currency, per tab", () => {
  const c = tabPricedCounts(items, types, "INR");
  assert.deepEqual(c.all, { priced: 2, total: 5 });
  assert.deepEqual(c.t1, { priced: 1, total: 4 });
  assert.deepEqual(c.none, { priced: 1, total: 1 });
  assert.deepEqual(tabPricedCounts(items, types, "AED").all, { priced: 2, total: 5 });
  assert.deepEqual(tabPricedCounts(items, types, "USD").all, { priced: 0, total: 5 });
});

test("sort by Max and Min in the default currency: unpriced rows sort first ascending", () => {
  const rows = [item("p", [{ ...inr, price: "300.00", minPrice: "100.00" }]), item("q", [{ ...inr, price: "200.00", minPrice: "150.00" }]), item("r", undefined)];
  assert.deepEqual(sortItems(rows, { key: "max", dir: 1 }, types, "INR").map((i) => i.id), ["r", "q", "p"]);
  assert.deepEqual(sortItems(rows, { key: "max", dir: -1 }, types, "INR").map((i) => i.id), ["p", "q", "r"]);
  assert.deepEqual(sortItems(rows, { key: "min", dir: 1 }, types, "INR").map((i) => i.id), ["r", "p", "q"]);
  assert.equal(priceSortValue([inr], "INR", "max"), 280000);
  assert.equal(priceSortValue([inr], "AED", "max"), -1);
  assert.equal(isPricedIn([inr], "INR"), true);
  assert.equal(DEFAULT_SORT.key, "code");
});
