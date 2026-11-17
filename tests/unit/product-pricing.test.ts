import { test } from "node:test";
import assert from "node:assert/strict";
import {
  combinationKey,
  combinationLabel,
  validateCombinationKey,
  validateCombinationLabel,
} from "@/lib/product-pricing/combination";
import {
  validatePriceEntries,
  validateDescription,
  sortEntries,
  hasPair,
} from "@/lib/product-pricing/price-entries";
import { findOrphans } from "@/lib/product-pricing/orphans";
import { specFieldList } from "@/lib/product-pricing/spec-fields";
import { generateCombinations, VARIANT_SEPARATOR } from "@/lib/quick-estimate/palette";
import type { FieldEntry } from "@/lib/types/field-entry";

// Stage 36 Batch 2, Unit AC1: key canonicalisation, label, generator, price entries, orphans.

const f = (key: string, over: Partial<FieldEntry> = {}): FieldEntry => ({
  key, label: key, type: "dropdown", required: false, basic: true, ...over,
});

// ─── key ─────────────────────────────────────────────────────────────────────

test("combinationKey is independent of key order and hidden fields are simply absent", () => {
  assert.equal(combinationKey({ b: "2", a: "1" }), combinationKey({ a: "1", b: "2" }));
  assert.equal(combinationKey({ a: "1", b: "2" }), '{"a":"1","b":"2"}');
  assert.notEqual(combinationKey({ a: "1" }), combinationKey({ a: "1", b: "2" }));
});

test("generated keys never contain a hidden field and round-trip through validateCombinationKey", () => {
  const fields = specFieldList([
    f("a", { productSpec: true }),
    f("b", { productSpec: true, showWhen: { field: "a", in: ["x"] } }),
  ]);
  const out = generateCombinations(fields, { a: { options: ["x", "y"] }, b: { options: ["1"] } });
  const keys = out.map((o) => combinationKey(o.values));
  assert.deepEqual(keys, ['{"a":"x","b":"1"}', '{"a":"y"}']);
  for (const k of keys) assert.equal(validateCombinationKey(k), null);
});

test("combinationLabel equals the Quick Estimate variant text in schema order", () => {
  const fields = specFieldList([f("a", { productSpec: true }), f("b", { productSpec: true })]);
  const [o] = generateCombinations(fields, { a: { options: ["Clear"] }, b: { options: ["10 mm"] } });
  assert.equal(combinationLabel(["a", "b"], o.values, VARIANT_SEPARATOR), o.text);
  assert.equal(o.text, "Clear · 10 mm");
  // a key the combination does not carry is skipped
  assert.equal(combinationLabel(["a", "z", "b"], o.values, " | "), "Clear | 10 mm");
});

// ─── generator modes ─────────────────────────────────────────────────────────

test("generator: dependsOn walks the parent value; spec mode and basic (fallback) lists give values by key", () => {
  const spec = specFieldList([
    f("type", { productSpec: true }),
    f("thickness", { productSpec: true, dependsOn: "type" }),
  ]);
  const cfg = { type: { options: ["Clear", "Frosted"] }, thickness: { valueMap: { Clear: ["10", "12"], Frosted: ["12"] } } };
  const out = generateCombinations(spec, cfg);
  assert.deepEqual(out.map((o) => o.values), [
    { type: "Clear", thickness: "10" }, { type: "Clear", thickness: "12" }, { type: "Frosted", thickness: "12" },
  ]);
  // fallback: the same generator over the basic fields, with a plain EstimateField list
  const basic = generateCombinations([{ key: "type", label: "type" }], cfg);
  assert.deepEqual(basic.map((o) => o.values), [{ type: "Clear" }, { type: "Frosted" }]);
  assert.deepEqual(generateCombinations([], cfg), []);
});

// ─── stored key shape ────────────────────────────────────────────────────────

test("validateCombinationKey accepts canonical flat string objects and rejects every other shape", () => {
  assert.equal(validateCombinationKey('{"a":"1"}'), null);
  const bad: unknown[] = [
    1, null, "", "{nope", "[]", '"s"', "{}", '{"a":1}', '{"a":""}', '{"a":{"b":"c"}}',
    '{"b":"1","a":"2"}', '{ "a": "1" }',
    JSON.stringify(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${String(i).padStart(2, "0")}`, "v"]))),
    JSON.stringify({ a: "x".repeat(1000) }),
  ];
  for (const k of bad) assert.notEqual(validateCombinationKey(k), null, String(k).slice(0, 40));
  // exactly 20 fields is fine
  assert.equal(validateCombinationKey(JSON.stringify(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${String(i).padStart(2, "0")}`, "v"])))), null);
});

test("validateCombinationLabel trims and bounds 1 to 300", () => {
  assert.deepEqual(validateCombinationLabel("  x  "), { ok: true, label: "x" });
  assert.equal(validateCombinationLabel("   ").ok, false);
  assert.equal(validateCombinationLabel("x".repeat(301)).ok, false);
  assert.equal(validateCombinationLabel("x".repeat(300)).ok, true);
  assert.equal(validateCombinationLabel(5).ok, false);
});

// ─── price entries ───────────────────────────────────────────────────────────

test("validatePriceEntries: unit family by type, currency, sign, 2 dp, duplicates, max 6; zero allowed; sorted", () => {
  const ok = validatePriceEntries(
    [{ currency: "USD", unit: "sqft", amount: 1.1 }, { currency: "INR", unit: "sqft", amount: 0 }, { currency: "INR", unit: "m2", amount: 2800.5 }],
    true,
  );
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.entries.map((e) => `${e.currency}:${e.unit}`), ["INR:m2", "INR:sqft", "USD:sqft"]);
  assert.ok(validatePriceEntries([], true).ok);
  assert.ok(validatePriceEntries([{ currency: "AED", unit: "pcs", amount: 450 }], false).ok);

  const reject = (raw: unknown, isArea: boolean) => assert.equal(validatePriceEntries(raw, isArea).ok, false, JSON.stringify(raw));
  reject("x", true);
  reject([{ currency: "EUR", unit: "m2", amount: 1 }], true);
  reject([{ currency: "INR", unit: "pcs", amount: 1 }], true); // pcs on an area type
  reject([{ currency: "INR", unit: "m2", amount: 1 }], false); // area unit on a piece type
  reject([{ currency: "INR", unit: "m2", amount: -0.01 }], true);
  reject([{ currency: "INR", unit: "m2", amount: 1.005 }], true);
  reject([{ currency: "INR", unit: "m2", amount: "1" }], true);
  reject([{ currency: "INR", unit: "m2", amount: Number.POSITIVE_INFINITY }], true);
  reject([{ currency: "INR", unit: "m2", amount: 1 }, { currency: "INR", unit: "m2", amount: 2 }], true); // duplicate pair
  const six = ["INR", "AED", "USD"].flatMap((currency) => ["m2", "sqft"].map((unit) => ({ currency, unit, amount: 1 })));
  assert.ok(validatePriceEntries(six, true).ok);
  reject([...six, { currency: "INR", unit: "m2", amount: 1 }], true);
});

test("sortEntries and hasPair", () => {
  assert.deepEqual(
    sortEntries([{ currency: "USD", unit: "m2" }, { currency: "AED", unit: "sqft" }, { currency: "AED", unit: "m2" }, { currency: "INR", unit: "sqft" }]).map((e) => `${e.currency}:${e.unit}`),
    ["INR:sqft", "AED:m2", "AED:sqft", "USD:m2"],
  );
  assert.equal(hasPair([{ currency: "INR", unit: "m2" }], "INR", "m2"), true);
  assert.equal(hasPair([{ currency: "INR", unit: "m2" }], "INR", "sqft"), false);
});

test("validateDescription: trim, blank to null, 500 max", () => {
  assert.deepEqual(validateDescription("  hi  "), { ok: true, description: "hi" });
  assert.deepEqual(validateDescription("   "), { ok: true, description: null });
  assert.deepEqual(validateDescription(undefined), { ok: true, description: null });
  assert.deepEqual(validateDescription(null), { ok: true, description: null });
  assert.equal(validateDescription("x".repeat(500)).ok, true);
  assert.equal(validateDescription("x".repeat(501)).ok, false);
  assert.equal(validateDescription(7).ok, false);
});

// ─── orphans ─────────────────────────────────────────────────────────────────

test("findOrphans returns stored keys the current config no longer produces", () => {
  const generated = ['{"a":"x"}', '{"a":"y"}'];
  assert.deepEqual(findOrphans(['{"a":"x"}', '{"a":"gone"}'], generated), ['{"a":"gone"}']);
  assert.deepEqual(findOrphans([], generated), []);
  assert.deepEqual(findOrphans(['{"a":"x"}'], new Set(generated)), []);
});
