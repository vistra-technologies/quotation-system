import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTotalOf } from "../../lib/quick-estimate/inquiry-estimate";

const base = {
  currency: "INR",
  discountMode: "amount" as const,
  discountValue: 100,
  taxPct: 5,
  lines: [{ itemName: "Partition", variantText: "x", unit: "m²" as const, qty: 12.5, unitPrice: 3200 }],
};

test("estimateTotalOf: grand total from the stored snapshot (Stage 34 Q4)", () => {
  assert.deepEqual(estimateTotalOf(base), { currency: "INR", grandTotal: 41895 });
  assert.deepEqual(estimateTotalOf({ ...base, discountMode: "pct", discountValue: 10 }), { currency: "INR", grandTotal: 37800 });
});

test("estimateTotalOf: null for no estimate or a malformed snapshot; unpriced lines total 0", () => {
  assert.equal(estimateTotalOf(null), null);
  assert.equal(estimateTotalOf({ ...base, lines: undefined as never }), null);
  assert.deepEqual(estimateTotalOf({ ...base, lines: [{ ...base.lines[0], qty: 0 }] }), { currency: "INR", grandTotal: 0 });
});
