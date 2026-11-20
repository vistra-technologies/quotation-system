import { test } from "node:test";
import assert from "node:assert/strict";
import { findMissingPrices } from "../../lib/missing-prices";

test("returns unpriced items, deduped by code, in first-seen order", () => {
  const items = [
    { code: "A", name: "Alpha" },
    { code: "B", name: "Beta" },
    { code: "A", name: "Alpha again" },
    { code: "C", name: "Gamma" },
  ];
  assert.deepEqual(findMissingPrices(items, new Set(["B"])), [
    { code: "A", name: "Alpha" },
    { code: "C", name: "Gamma" },
  ]);
});

test("nothing missing when every code is priced, or the list is empty", () => {
  assert.deepEqual(findMissingPrices([{ code: "A", name: "x" }], new Set(["A"])), []);
  assert.deepEqual(findMissingPrices([], new Set()), []);
});
