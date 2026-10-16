import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeEstimate,
  isInvalidQty,
  normalizeQty,
  parseQty,
  parseUnitPrice,
  round2,
  validateValueLine,
  type ValueLine,
} from "../../lib/quick-estimate/estimate";
import {
  buildCombinations,
  unitForCode,
  usableEstimateTypes,
  type ComponentTypeInput,
} from "../../lib/quick-estimate/palette";
import { newLine, toValueLines, hasDraftItems } from "../../lib/quick-estimate/lines";
import { draftStorageActive, parseStoredDraft, serializeDraft } from "../../lib/quick-estimate/storage";
import { formatAmount, formatMoney } from "../../lib/quick-estimate/format";
import { buildSheet } from "../../lib/quick-estimate/sheet";
import type { FieldEntry } from "../../lib/types/field-entry";
import type { FieldOptionsConfig } from "../../lib/types/field-options-config";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const choice = (key: string, extra: Partial<FieldEntry> = {}): FieldEntry => ({
  key,
  label: key,
  type: "dropdown",
  required: true,
  basic: true,
  ...extra,
});

const GLASS_FIELDS: FieldEntry[] = [
  choice("category"),
  choice("glassType", { dependsOn: "category" }),
  choice("thickness", { dependsOn: "glassType" }),
  choice("profile", { basic: false }), // advanced: must not affect the estimator
];

const GLASS_CONFIG: FieldOptionsConfig = {
  category: { options: ["Single glazed", "Double glazed"] },
  glassType: { valueMap: { "Single glazed": ["Clear", "Frosted"], "Double glazed": ["Acoustic"] } },
  thickness: { valueMap: { Clear: ["10 mm"], Frosted: ["10 mm", "12 mm"], Acoustic: ["12 mm"] } },
  // profile (advanced) deliberately unconfigured
};

const DOOR_FIELDS: FieldEntry[] = [choice("category"), choice("doorType", { dependsOn: "category" })];
const DOOR_CONFIG: FieldOptionsConfig = {
  category: { options: ["Glass door"] },
  doorType: { valueMap: { "Glass door": ["Single swing", "Sliding"] } },
};

function ct(over: Partial<ComponentTypeInput> & { code: string }): ComponentTypeInput {
  return {
    id: `id-${over.code}`,
    name: over.code === "GLASS" ? "Partition" : over.code === "DOOR" ? "Door" : over.code,
    active: true,
    fieldsSchema: [],
    fieldOptionsConfig: null,
    ...over,
  };
}

const glass = (over: Partial<ComponentTypeInput> = {}) =>
  ct({ code: "GLASS", fieldsSchema: GLASS_FIELDS, fieldOptionsConfig: GLASS_CONFIG, ...over });
const door = (over: Partial<ComponentTypeInput> = {}) =>
  ct({ code: "DOOR", fieldsSchema: DOOR_FIELDS, fieldOptionsConfig: DOOR_CONFIG, ...over });

// ─── Guard (S33-2) ──────────────────────────────────────────────────────────

test("guard: an active, fully basic-configured GLASS enables Quick Estimate", () => {
  const r = usableEstimateTypes([glass(), door()]);
  assert.equal(r.enabled, true);
  assert.deepEqual(r.types.map((t) => t.code), ["GLASS", "DOOR"]);
});

test("guard: GLASS inactive -> disabled", () => {
  assert.equal(usableEstimateTypes([glass({ active: false }), door()]).enabled, false);
});

test("guard: GLASS with fieldOptionsConfig null -> disabled", () => {
  assert.equal(usableEstimateTypes([glass({ fieldOptionsConfig: null })]).enabled, false);
});

test("guard: GLASS with an empty basic dependent branch -> disabled", () => {
  const cfg: FieldOptionsConfig = {
    ...GLASS_CONFIG,
    thickness: { valueMap: { Clear: ["10 mm"], Frosted: ["10 mm"] } }, // Acoustic branch unmapped
  };
  assert.equal(usableEstimateTypes([glass({ fieldOptionsConfig: cfg })]).enabled, false);
});

test("guard: an unconfigured ADVANCED field only does not disable it", () => {
  // GLASS_CONFIG has no `profile` entry and profile is a non-basic dropdown.
  assert.equal(usableEstimateTypes([glass()]).enabled, true);
});

test("guard: GLASS usable, DOOR unusable -> enabled, DOOR not offered", () => {
  const r = usableEstimateTypes([glass(), door({ fieldOptionsConfig: null })]);
  assert.equal(r.enabled, true);
  assert.deepEqual(r.types.map((t) => t.code), ["GLASS"]);
});

test("guard: no GLASS row at all -> disabled (a usable DOOR is not enough)", () => {
  const r = usableEstimateTypes([door()]);
  assert.equal(r.enabled, false);
  assert.deepEqual(r.types.map((t) => t.code), ["DOOR"]);
});

test("guard: a renamed category with code GLASS is still enabled (matches the code, never the name)", () => {
  assert.equal(usableEstimateTypes([glass({ name: "Glass Walls" })]).enabled, true);
});

test("guard: a dangling dependsOn that points at a non-basic field fails closed", () => {
  const fields = [choice("a", { basic: false }), choice("b", { dependsOn: "a" })];
  const cfg: FieldOptionsConfig = { b: { valueMap: { x: ["y"] } } };
  const r = usableEstimateTypes([glass(), ct({ code: "ODD", fieldsSchema: fields, fieldOptionsConfig: cfg })]);
  assert.deepEqual(r.types.map((t) => t.code), ["GLASS"]);
});

test("guard: a custom active configured type is offered (pcs); an inactive custom type is not", () => {
  const custom = ct({ code: "PANEL", name: "Panel", fieldsSchema: [choice("kind")], fieldOptionsConfig: { kind: { options: ["A"] } } });
  const r = usableEstimateTypes([glass(), custom, { ...custom, id: "x", code: "OFF", active: false }]);
  assert.deepEqual(r.types.map((t) => t.code), ["GLASS", "PANEL"]);
  assert.equal(r.types[1].unit, "pcs");
});

test("guard: the trimmed type carries only basic choice fields and their option config", () => {
  const t = usableEstimateTypes([glass()]).types[0];
  assert.deepEqual(t.basicFields.map((f) => f.key), ["category", "glassType", "thickness"]);
  assert.equal("profile" in t.options, false);
});

// ─── Units (S33-4) ──────────────────────────────────────────────────────────

test("units: GLASS -> m², DOOR and a custom code -> pcs", () => {
  assert.equal(unitForCode("GLASS"), "m²");
  assert.equal(unitForCode("DOOR"), "pcs");
  assert.equal(unitForCode("PANEL"), "pcs");
});

// ─── Combinations (S33-5, D-9) ──────────────────────────────────────────────

test("combinations: a 3-level chain yields exactly the configured set, full variants only", () => {
  const t = usableEstimateTypes([glass()]).types[0];
  assert.deepEqual(
    buildCombinations(t).map((o) => o.text),
    [
      "Single glazed · Clear · 10 mm",
      "Single glazed · Frosted · 10 mm",
      "Single glazed · Frosted · 12 mm",
      "Double glazed · Acoustic · 12 mm",
    ],
  );
  assert.deepEqual(buildCombinations(t)[0].parts, ["Single glazed", "Clear", "10 mm"]);
});

test("combinations: a value with no mapped branch is never offered", () => {
  // Guard would reject this type; build the trimmed type directly to prove the builder itself never invents a branch.
  const t = usableEstimateTypes([glass()]).types[0];
  const partial = { ...t, options: { ...t.options, thickness: { valueMap: { Clear: ["10 mm"] } } } };
  assert.deepEqual(buildCombinations(partial).map((o) => o.text), ["Single glazed · Clear · 10 mm"]);
});

test("combinations: a type with no basic choice fields has zero options (no component-only row)", () => {
  const t = usableEstimateTypes([glass(), ct({ code: "BARE", name: "Bare" })]).types.find((x) => x.code === "BARE");
  assert.ok(t);
  assert.deepEqual(buildCombinations(t), []);
});

// ─── Maths (S33-6 / S33-7) ──────────────────────────────────────────────────

const L = (unit: "m²" | "pcs", qty: number, unitPrice: number, itemName = "X"): ValueLine => ({ itemName, variantText: "", unit, qty, unitPrice });
const PCT = (value: number) => ({ mode: "pct" as const, value });
const AMT = (value: number) => ({ mode: "amount" as const, value });

test("maths: 42.5 m² x 3200 = 136000.00 and 3 pcs x 28500 = 85500.00", () => {
  const r = computeEstimate([L("m²", 42.5, 3200), L("pcs", 3, 28500)], PCT(0), 0);
  assert.deepEqual(r.lines.map((l) => l.total), [136000, 85500]);
  assert.equal(r.subtotal, 221500);
});

test("maths: d = 5% and t = 18% (hand-computed)", () => {
  // subtotal 136000 + 85500 = 221500.00
  // discount 221500 x 5%            = 11075.00
  // tax      (221500 - 11075) x 18% = 210425 x 0.18 = 37876.50
  // total    221500 - 11075 + 37876.5 = 248301.50
  const r = computeEstimate([L("m²", 42.5, 3200), L("pcs", 3, 28500)], PCT(5), 18);
  assert.equal(r.discount, 11075);
  assert.equal(r.tax, 37876.5);
  assert.equal(r.grandTotal, 248301.5);
  assert.equal(r.priced, 2);
});

test("maths: fixed-amount discount below the subtotal subtracts as typed, tax comes after it", () => {
  // 221500 - 1000 = 220500; tax 18% = 39690; total 260190
  const r = computeEstimate([L("m²", 42.5, 3200), L("pcs", 3, 28500)], AMT(1000), 18);
  assert.equal(r.discountMode, "amount");
  assert.equal(r.discount, 1000);
  assert.equal(r.tax, 39690);
  assert.equal(r.grandTotal, 260190);
});

test("maths: a fixed amount above the subtotal is capped at the subtotal (total never goes negative)", () => {
  const r = computeEstimate([L("m²", 42.5, 3200), L("pcs", 3, 28500)], AMT(500000), 18);
  assert.equal(r.discount, 221500);
  assert.equal(r.tax, 0);
  assert.equal(r.grandTotal, 0);
  assert.equal(r.discountValue, 500000); // the entered value is left as is
});

test("maths: rounding happens at every step (per-line, then subtotal, discount, tax)", () => {
  // Three lines of 0.333 each: per-line rounding gives 0.33 x 3 = 0.99, not round2(0.999) = 1.00.
  const lines = [L("pcs", 1, 0.333), L("pcs", 1, 0.333), L("pcs", 1, 0.333)];
  const r = computeEstimate(lines, PCT(10), 18);
  assert.equal(r.subtotal, 0.99);
  assert.equal(r.discount, 0.1); // 0.099 -> 0.10
  assert.equal(r.tax, 0.16); // (0.99 - 0.10) = 0.89 x 18% = 0.1602 -> 0.16
  assert.equal(r.grandTotal, 1.05);
});

test("maths: blank, negative, NaN and over-100 inputs are clamped", () => {
  const lines = [L("pcs", 2, 100)];
  assert.equal(computeEstimate(lines, PCT(NaN), NaN).grandTotal, 200);
  assert.equal(computeEstimate(lines, PCT(-5), -5).grandTotal, 200);
  const over = computeEstimate(lines, PCT(150), 150);
  assert.equal(over.discountValue, 100);
  assert.equal(over.discount, 200);
  assert.equal(over.taxPct, 100);
  assert.equal(over.grandTotal, 0);
  assert.equal(computeEstimate(lines, AMT(-5), 0).discount, 0);
});

test("maths: a non-integer pcs quantity counts as 0; m² keeps 2 decimals", () => {
  assert.equal(normalizeQty(1.5, "pcs"), 0);
  assert.equal(normalizeQty(2, "pcs"), 2);
  assert.equal(normalizeQty(1.234, "m²"), 1.23);
  const r = computeEstimate([L("pcs", 1.5, 100)], PCT(0), 0);
  assert.equal(r.lines[0].priced, false);
  assert.equal(r.subtotal, 0);
});

test("maths: an unpriced line (qty or rate 0) adds nothing and is not counted as priced", () => {
  const r = computeEstimate([L("pcs", 0, 100), L("pcs", 2, 0), L("pcs", 2, 100)], PCT(0), 0);
  assert.deepEqual(r.lines.map((l) => l.priced), [false, false, true]);
  assert.equal(r.priced, 1);
  assert.equal(r.subtotal, 200);
});

test("maths: an empty list is all zeros", () => {
  const r = computeEstimate([], PCT(5), 18);
  assert.deepEqual(
    [r.subtotal, r.discount, r.tax, r.grandTotal, r.priced],
    [0, 0, 0, 0, 0],
  );
});

test("parsers: blank / garbage / negative mean 0, and the invalid-pcs style flag", () => {
  assert.equal(parseQty("", "m²"), 0);
  assert.equal(parseQty("abc", "pcs"), 0);
  assert.equal(parseQty("-3", "pcs"), 0);
  assert.equal(parseQty("42.5", "m²"), 42.5);
  assert.equal(parseUnitPrice(""), 0);
  assert.equal(parseUnitPrice("3200"), 3200);
  assert.equal(round2(1.005), 1.01);
  assert.equal(isInvalidQty("1.5", "pcs"), true);
  assert.equal(isInvalidQty("2", "pcs"), false);
  assert.equal(isInvalidQty("", "pcs"), false);
  assert.equal(isInvalidQty("1.5", "m²"), false);
});

// ─── Line mapping ───────────────────────────────────────────────────────────

test("toValueLines: a draft line with no item is excluded and strings are parsed", () => {
  const empty = newLine("a");
  const chosen = { ...newLine("b"), typeCode: "GLASS", itemName: "Partition", variantText: "v", unit: "m²" as const, qty: "42.5", rate: "3200" };
  const out = toValueLines([empty, chosen]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { itemName: "Partition", variantText: "v", unit: "m²", qty: 42.5, unitPrice: 3200 });
  assert.equal(hasDraftItems([empty]), false);
  assert.equal(hasDraftItems([empty, chosen]), true);
});

// ─── validateValueLine (Batch 2 reuses these rules) ─────────────────────────

const good = { itemName: "Partition", variantText: "Single glazed · Clear · 10 mm", unit: "m²", qty: 42.5, unitPrice: 3200 };

test("validateValueLine: accepts a good line and trims strings; absent variantText is empty", () => {
  const r = validateValueLine({ ...good, itemName: "  Partition  " });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.line.itemName, "Partition");
  const r2 = validateValueLine({ itemName: "Door", unit: "pcs", qty: 3, unitPrice: 0 });
  assert.equal(r2.ok && r2.line.variantText, "");
});

test("validateValueLine: rejects (never clamps) bad input", () => {
  const bad: unknown[] = [
    null,
    [],
    "x",
    { ...good, itemName: "" },
    { ...good, itemName: "   " },
    { ...good, itemName: "x".repeat(121) },
    { ...good, variantText: "x".repeat(201) },
    { ...good, variantText: 5 },
    { ...good, unit: "kg" },
    { ...good, qty: -1 },
    { ...good, qty: Number.NaN },
    { ...good, qty: Number.POSITIVE_INFINITY },
    { ...good, qty: "3" },
    { ...good, qty: 1.234 }, // m²: more than 2 decimals
    { ...good, unit: "pcs", qty: 1.5 },
    { ...good, unitPrice: -0.01 },
    { ...good, unitPrice: Number.POSITIVE_INFINITY },
    { ...good, unitPrice: undefined },
  ];
  for (const b of bad) assert.equal(validateValueLine(b).ok, false, JSON.stringify(b));
  assert.equal(validateValueLine({ ...good, itemName: "x".repeat(120) }).ok, true);
});

// ─── Storage (S33-8) ────────────────────────────────────────────────────────

const types = usableEstimateTypes([glass(), door()]).types;
let seq = 0;
const nextId = () => `t${++seq}`;

test("storage: garbage, non-objects and missing data restore to an empty draft in the default currency", () => {
  for (const raw of [null, "", "{", "[]", "123", "null", '"x"']) {
    const d = parseStoredDraft(raw, types, "AED", nextId);
    assert.deepEqual([d.currency, d.lines.length, d.discountMode, d.discountValue, d.taxPct], ["AED", 0, "pct", "", ""]);
  }
});

test("storage: a round trip keeps currency, discount mode and value, tax and the lines", () => {
  const draft = {
    currency: "USD" as const,
    discountMode: "amount" as const,
    discountValue: "250",
    taxPct: "7.5",
    lines: [{ ...newLine("a"), typeCode: "GLASS", itemName: "Partition", variantText: "Single glazed · Clear · 10 mm", unit: "m²" as const, qty: "12", rate: "99", flag: true }],
  };
  const back = parseStoredDraft(serializeDraft(draft), types, "INR", nextId);
  assert.equal(back.currency, "USD");
  assert.equal(back.discountMode, "amount");
  assert.equal(back.discountValue, "250");
  assert.equal(back.taxPct, "7.5");
  assert.equal(back.lines.length, 1);
  assert.deepEqual([back.lines[0].typeCode, back.lines[0].qty, back.lines[0].rate, back.lines[0].flag], ["GLASS", "12", "99", false]);
});

test("storage: lines of a type that is no longer usable are dropped; a vanished variant is kept", () => {
  const raw = JSON.stringify({
    currency: "INR",
    discountMode: "pct",
    discountValue: "5",
    taxPct: "18",
    lines: [
      { typeCode: "GLASS", itemName: "Partition", variantText: "Old variant nobody offers any more", qty: "2", rate: "10" },
      { typeCode: "GONE", itemName: "Removed type", variantText: "v", qty: "1", rate: "1" },
      { typeCode: "DOOR", itemName: "", variantText: "v", qty: "1", rate: "1" }, // fails validation
      "junk",
    ],
  });
  const d = parseStoredDraft(raw, types, "INR", nextId);
  assert.deepEqual(d.lines.map((l) => l.typeCode), ["GLASS"]);
  assert.equal(d.lines[0].variantText, "Old variant nobody offers any more");
  assert.equal(d.lines[0].unit, "m²"); // re-derived from the usable type, never trusted from storage
});

test("storage: an unsupported stored currency falls back to the default; an unknown discount mode to pct", () => {
  const d = parseStoredDraft(JSON.stringify({ currency: "EUR", discountMode: "fixed", lines: [] }), types, "AED", nextId);
  assert.equal(d.currency, "AED");
  assert.equal(d.discountMode, "pct");
});

test("storage: the draft is only touched once the guard has passed (a failed read must not erase it)", () => {
  assert.equal(draftStorageActive(false, []), false); // failed or empty component-types read
  assert.equal(draftStorageActive(false, types), false); // GLASS unusable (admin mid-edit): popup cannot open either
  assert.equal(draftStorageActive(true, []), false);
  assert.equal(draftStorageActive(true, types), true);
});

// ─── Format (S33-9) ─────────────────────────────────────────────────────────

test("format: INR groups en-IN, others en-US, and the currency is a code, never a symbol", () => {
  assert.equal(formatMoney(182750, "INR"), "INR 1,82,750.00");
  assert.equal(formatMoney(182750, "USD"), "USD 182,750.00");
  assert.equal(formatMoney(0, "AED"), "AED 0.00");
  assert.equal(formatAmount(1234.5, "AED"), "1,234.50");
  assert.equal(/[₹$]/.test(formatMoney(5, "INR") + formatMoney(5, "USD")), false);
});

// ─── Sheet (preview + PDF share it, S33-11) ─────────────────────────────────

const labels = { subtotal: "Subtotal", discount: "Discount", tax: "Tax", total: "Total" };

test("sheet: only priced lines are rows; Discount and Tax rows are always present, even at 0; ASCII signs", () => {
  const lines = [L("m²", 42.5, 3200, "Partition"), L("pcs", 0, 10, "Unpriced"), L("pcs", 3, 28500, "Door")];
  const r = computeEstimate(lines, PCT(5), 18);
  const s = buildSheet(lines, r, "INR", labels);
  assert.deepEqual(s.rows.map((x) => x.name), ["Partition", "Door"]);
  assert.deepEqual(s.rows[0], { n: 1, name: "Partition", variant: "", qty: "42.5 m²", rate: "3,200.00", amount: "1,36,000.00" });
  assert.deepEqual(s.totals.map((t) => [t.label, t.value]), [
    ["Subtotal", "2,21,500.00"],
    ["Discount 5%", "- 11,075.00"],
    ["Tax 18%", "+ 37,876.50"],
    ["Total", "INR 2,48,301.50"],
  ]);
  const plain = buildSheet(lines, computeEstimate(lines, PCT(0), 0), "INR", labels);
  assert.deepEqual(plain.totals.map((t) => [t.label, t.value]), [
    ["Subtotal", "2,21,500.00"],
    ["Discount 0%", "- 0.00"],
    ["Tax 0%", "+ 0.00"],
    ["Total", "INR 2,21,500.00"],
  ]);
  const amount = buildSheet(lines, computeEstimate(lines, AMT(1000), 0), "USD", labels);
  assert.deepEqual(amount.totals[1], { label: "Discount", value: "- 1,000.00" }); // no % in amount mode
});
