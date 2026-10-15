import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseQuickEstimateInput,
  stampQuickEstimate,
  QuickEstimateError,
  type ParsedQuickEstimate,
} from "../../lib/quick-estimate/inquiry-estimate";

const line = (over: Record<string, unknown> = {}) => ({
  itemName: "Partition",
  variantText: "Double glazed",
  unit: "m²",
  qty: 42.5,
  unitPrice: 3200,
  ...over,
});
const input = (over: Record<string, unknown> = {}) => ({ lines: [line()], ...over });

function parsed(raw: unknown): ParsedQuickEstimate {
  const r = parseQuickEstimateInput(raw);
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.value;
}
function rejected(raw: unknown): string {
  const r = parseQuickEstimateInput(raw);
  assert.equal(r.ok, false, "expected a rejection");
  return r.ok ? "" : r.error;
}

test("valid input round-trips into the stored shape", () => {
  const v = parsed(input({ discountMode: "amount", discountValue: 100.5, taxPct: 18, currency: " inr " }));
  const now = new Date("2026-10-16T09:30:00.000Z");
  const stored = stampQuickEstimate(v, "INR", "Asha Rao", now);
  assert.deepEqual(stored, {
    v: 1,
    currency: "INR",
    discountMode: "amount",
    discountValue: 100.5,
    taxPct: 18,
    lines: [line()],
    updatedAt: "2026-10-16T09:30:00.000Z",
    updatedByName: "Asha Rao",
  });
});

test("defaults: variantText absent is empty, discount mode pct, discount and tax 0", () => {
  const v = parsed({ lines: [{ itemName: "Door", unit: "pcs", qty: 2, unitPrice: 10 }] });
  assert.equal(v.lines[0].variantText, "");
  assert.equal(v.discountMode, "pct");
  assert.equal(v.discountValue, 0);
  assert.equal(v.taxPct, 0);
  assert.equal(v.currency, undefined);
});

test("an amount discount larger than the line total is accepted unchanged", () => {
  const v = parsed(input({ discountMode: "amount", discountValue: 9_999_999 }));
  assert.equal(v.discountValue, 9_999_999);
});

test("unknown keys are dropped and client v/updatedAt/updatedByName are overwritten", () => {
  const v = parsed(input({ v: 9, updatedAt: "x", updatedByName: "Evil", componentTypeCode: "GLASS", extra: 1 }));
  const stored = stampQuickEstimate(v, "AED", "Real", new Date(0));
  assert.deepEqual(Object.keys(stored).sort(), ["currency", "discountMode", "discountValue", "lines", "taxPct", "updatedAt", "updatedByName", "v"]);
  assert.equal(stored.v, 1);
  assert.equal(stored.updatedByName, "Real");
  assert.equal(stored.updatedAt, "1970-01-01T00:00:00.000Z");
  assert.deepEqual(Object.keys(stored.lines[0]).sort(), ["itemName", "qty", "unit", "unitPrice", "variantText"]);
});

test("rejections (nothing is clamped)", () => {
  const cases: Array<[string, unknown]> = [
    ["null", null],
    ["string", "x"],
    ["array", []],
    ["no lines key", {}],
    ["lines not an array", { lines: {} }],
    ["empty lines", { lines: [] }],
    ["101 lines", { lines: Array.from({ length: 101 }, () => line()) }],
    ["blank itemName", input({ lines: [line({ itemName: "   " })] })],
    ["121-char itemName", input({ lines: [line({ itemName: "a".repeat(121) })] })],
    ["201-char variantText", input({ lines: [line({ variantText: "a".repeat(201) })] })],
    ["unit kg", input({ lines: [line({ unit: "kg" })] })],
    ["pcs qty 1.5", input({ lines: [line({ unit: "pcs", qty: 1.5 })] })],
    ["m2 qty 1.234", input({ lines: [line({ qty: 1.234 })] })],
    ["negative qty", input({ lines: [line({ qty: -1 })] })],
    ["string qty", input({ lines: [line({ qty: "3" })] })],
    ["negative unitPrice", input({ lines: [line({ unitPrice: -5 })] })],
    ["NaN-ish unitPrice", input({ lines: [line({ unitPrice: null })] })],
    ["pct discount 101", input({ discountValue: 101 })],
    ["pct discount -1", input({ discountValue: -1 })],
    ["amount discount -1", input({ discountMode: "amount", discountValue: -1 })],
    ["amount discount 10.005", input({ discountMode: "amount", discountValue: 10.005 })],
    ["discountMode fixed", input({ discountMode: "fixed" })],
    ["discountValue string", input({ discountValue: "5" })],
    ["taxPct 101", input({ taxPct: 101 })],
    ["taxPct -1", input({ taxPct: -1 })],
    ["currency number", input({ currency: 5 })],
  ];
  for (const [name, raw] of cases) assert.ok(rejected(raw).length > 0, name);
});

test("the error names the failing path", () => {
  assert.match(rejected(input({ lines: [line(), line({ unit: "kg" })] })), /quickEstimate\.lines\[1\]/);
});

test("stamper: a different client currency is an INVALID_QUICK_ESTIMATE error; the same in lower case is fine", () => {
  const now = new Date(0);
  assert.throws(
    () => stampQuickEstimate(parsed(input({ currency: "USD" })), "INR", "n", now),
    (e: unknown) => e instanceof QuickEstimateError && e.code === "INVALID_QUICK_ESTIMATE",
  );
  assert.equal(stampQuickEstimate(parsed(input({ currency: "inr" })), "INR", "n", now).currency, "INR");
  assert.equal(stampQuickEstimate(parsed(input()), "AED", "n", now).currency, "AED");
});
