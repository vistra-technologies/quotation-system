import { test } from "node:test";
import assert from "node:assert/strict";
import { validateValueLine } from "../../lib/quick-estimate/estimate";
import {
  parseQuickEstimateInput,
  stampQuickEstimate,
} from "../../lib/quick-estimate/inquiry-estimate";
import { draftToInput, storedToDraft, storedToInput } from "../../lib/quick-estimate/inquiry-draft";
import { newLine, toValueLines, type DraftLine, type EstimateDraft } from "../../lib/quick-estimate/lines";
import { buildCombinations, usableEstimateTypes, type ComponentTypeInput } from "../../lib/quick-estimate/palette";
import { parseStoredDraft, serializeDraft } from "../../lib/quick-estimate/storage";
import {
  applyChoice,
  buildPricingLookup,
  relookupForCurrency,
  resetRate,
  showReset,
  suggestFor,
  type PricingLookup,
} from "../../lib/quick-estimate/suggest";
import { buildSheet } from "../../lib/quick-estimate/sheet";
import { computeEstimate } from "../../lib/quick-estimate/estimate";
import { combinationKey } from "../../lib/product-pricing/combination";
import type { FieldEntry } from "../../lib/types/field-entry";
import type { FieldOptionsConfig } from "../../lib/types/field-options-config";

// Stage 36 Batch 4: picker modes, exact lookup, Reset, currency re-lookup, the new line keys end to end.

const f = (key: string, extra: Partial<FieldEntry> = {}): FieldEntry => ({
  key,
  label: key,
  type: "dropdown",
  required: true,
  basic: true,
  ...extra,
});

// category (spec) -> thickness (spec, depends on category); handles is basic but NOT a spec field.
const FIELDS: FieldEntry[] = [
  f("category", { productSpec: true }),
  f("thickness", { dependsOn: "category", productSpec: true }),
  f("handles"),
];
const CONFIG: FieldOptionsConfig = {
  category: { options: ["Single", "Double"] },
  thickness: { valueMap: { Single: ["10 mm", "12 mm"], Double: ["12 mm"] } },
  handles: { options: ["Chrome", "Black"] },
};

function ct(over: Partial<ComponentTypeInput> & { code: string }): ComponentTypeInput {
  return { id: `id-${over.code}`, name: over.code === "GLASS" ? "Partition" : over.code, active: true, fieldsSchema: [], fieldOptionsConfig: null, ...over };
}
const specGlass = (over: Partial<ComponentTypeInput> = {}) => ct({ code: "GLASS", fieldsSchema: FIELDS, fieldOptionsConfig: CONFIG, ...over });
const plainGlass = () =>
  ct({
    code: "GLASS",
    fieldsSchema: FIELDS.map((x) => ({ ...x, productSpec: undefined })),
    fieldOptionsConfig: CONFIG,
  });

const [specType] = usableEstimateTypes([specGlass()]).types;
const optionOf = (text: string) => buildCombinations(specType).find((o) => o.text === text)!;
const KEY_S10 = combinationKey({ category: "Single", thickness: "10 mm" });
const KEY_S12 = combinationKey({ category: "Single", thickness: "12 mm" });

const LOOKUP: PricingLookup = {
  [specType.id]: {
    [KEY_S10]: {
      prices: [
        { currency: "INR", unit: "m2", amount: 2800 },
        { currency: "USD", unit: "m2", amount: 40 },
      ],
      description: "Standard single glazed",
    },
    // Only the other area unit of INR: must not match INR/m2 and must never be converted.
    [KEY_S12]: { prices: [{ currency: "INR", unit: "sqft", amount: 260 }], description: null },
  },
};

// ─── Picker modes (AC1) ─────────────────────────────────────────────────────

test("picker: a type with spec fields lists only spec combinations, handles excluded", () => {
  assert.equal(specType.mode, "spec");
  assert.deepEqual(specType.pickerFields.map((x) => x.key), ["category", "thickness"]);
  assert.deepEqual(buildCombinations(specType).map((o) => o.text), ["Single · 10 mm", "Single · 12 mm", "Double · 12 mm"]);
  assert.equal("handles" in specType.options, false);
});

test("picker: no spec field -> fallback, identical to the basic combinations (handles included)", () => {
  const [t] = usableEstimateTypes([plainGlass()]).types;
  assert.equal(t.mode, "fallback");
  assert.deepEqual(t.pickerFields.map((x) => x.key), ["category", "thickness", "handles"]);
  assert.equal(buildCombinations(t).length, 6); // 3 category/thickness pairs x 2 handles
  assert.ok(buildCombinations(t).every((o) => o.parts.length === 3));
});

test("picker: a spec field that is not basic still counts, and basic non-spec fields do not gate usability", () => {
  const fields = [f("category", { productSpec: true, basic: false }), f("thickness", { dependsOn: "category", productSpec: true, basic: false }), f("handles")];
  // handles is basic but unconfigured: in spec mode it is not judged.
  const cfg: FieldOptionsConfig = { category: CONFIG.category, thickness: CONFIG.thickness };
  const r = usableEstimateTypes([ct({ code: "GLASS", fieldsSchema: fields, fieldOptionsConfig: cfg })]);
  assert.equal(r.enabled, true);
  assert.equal(r.types[0].mode, "spec");
});

test("picker: a spec set that is not fully configured makes the type unusable", () => {
  const cfg: FieldOptionsConfig = { category: CONFIG.category, thickness: { valueMap: { Single: ["10 mm"] } } };
  assert.equal(usableEstimateTypes([specGlass({ fieldOptionsConfig: cfg })]).enabled, false);
});

test("picker: a spec field whose showWhen controller is not a spec field is always visible (F-3)", () => {
  const fields = [f("category", { productSpec: true }), f("extra", { productSpec: true, showWhen: { field: "handles", in: ["Chrome"] } }), f("handles")];
  const cfg: FieldOptionsConfig = { category: { options: ["A"] }, extra: { options: ["x", "y"] }, handles: { options: ["Chrome"] } };
  const r = usableEstimateTypes([ct({ code: "GLASS", fieldsSchema: fields, fieldOptionsConfig: cfg })]);
  assert.deepEqual(buildCombinations(r.types[0]).map((o) => o.text), ["A · x", "A · y"]);
});

// ─── Lookup (AC1) ───────────────────────────────────────────────────────────

test("lookup: only spec-mode types get a map", () => {
  const [fb] = usableEstimateTypes([plainGlass()]).types;
  const l = buildPricingLookup(
    [
      { componentTypeId: specType.id, combinationKey: KEY_S10, prices: [], description: null },
      { componentTypeId: fb.id, combinationKey: "{}", prices: [], description: null },
    ],
    [specType, { ...fb, id: "fb" }],
  );
  assert.deepEqual(Object.keys(l), [specType.id]);
});

test("lookup: exact (currency, unit) match fills the price", () => {
  const s = suggestFor(LOOKUP, specType, optionOf("Single · 10 mm"), "INR", "m2");
  assert.equal(s.suggestedUnitPrice, 2800);
  assert.equal(s.suggestedUnit, "m2");
  assert.equal(s.combinationKey, KEY_S10);
  assert.equal(s.description, "Standard single glazed");
});

test("lookup: never cross-currency", () => {
  assert.equal(suggestFor(LOOKUP, specType, optionOf("Single · 10 mm"), "AED", "m2").suggestedUnitPrice, null);
});

test("lookup: an entry only in the other area unit of the same currency leaves the rate empty (no conversion)", () => {
  const s = suggestFor(LOOKUP, specType, optionOf("Single · 12 mm"), "INR", "m2");
  assert.equal(s.suggestedUnitPrice, null);
  assert.equal(s.suggestedUnit, null);
  assert.equal(s.combinationKey, KEY_S12); // still keyed, so a currency/unit switch can look it up later
});

test("lookup: an unpriced variant keeps its key but no price and no description", () => {
  const s = suggestFor(LOOKUP, specType, optionOf("Double · 12 mm"), "INR", "m2");
  assert.deepEqual(s, { combinationKey: combinationKey({ category: "Double", thickness: "12 mm" }), suggestedUnitPrice: null, suggestedUnit: null, description: null });
});

test("lookup: fallback-mode types never get a suggestion", () => {
  const [fb] = usableEstimateTypes([plainGlass()]).types;
  const opt = buildCombinations(fb)[0];
  assert.deepEqual(suggestFor(LOOKUP, fb, opt, "INR", "m2"), { combinationKey: null, suggestedUnitPrice: null, suggestedUnit: null, description: null });
});

// ─── Choose / Reset (AC2, AC3) ──────────────────────────────────────────────

const fresh = (): DraftLine => newLine("l1");

test("choose: a priced variant fills the rate, suggestion, key and a checked description", () => {
  const l = applyChoice(fresh(), specType, optionOf("Single · 10 mm"), LOOKUP, "INR");
  assert.equal(l.rate, "2800");
  assert.equal(l.suggestedUnitPrice, 2800);
  assert.equal(l.combinationKey, KEY_S10);
  assert.equal(l.description, "Standard single glazed");
  assert.equal(l.attachDescription, true);
  assert.equal(l.descriptionEdited, false);
  assert.equal(showReset(l), false);
});

test("choose: an unpriced variant leaves the rate empty, description unchecked and empty, no Reset", () => {
  const l = applyChoice(fresh(), specType, optionOf("Double · 12 mm"), LOOKUP, "INR");
  assert.equal(l.rate, "");
  assert.equal(l.attachDescription, false);
  assert.equal(l.description, "");
  assert.equal(showReset(l), false);
});

test("reset: an edited rate shows Reset, Reset restores the suggestion and hides itself", () => {
  const picked = applyChoice(fresh(), specType, optionOf("Single · 10 mm"), LOOKUP, "INR");
  const edited = { ...picked, rate: "3100" };
  assert.equal(showReset(edited), true);
  const back = resetRate(edited);
  assert.equal(back.rate, "2800");
  assert.equal(showReset(back), false);
  // Clearing the field also counts as a difference.
  assert.equal(showReset({ ...picked, rate: "" }), true);
});

test("reset: a manual rate (no suggestion) never shows Reset and Reset is a no-op", () => {
  const manual = { ...applyChoice(fresh(), specType, optionOf("Double · 12 mm"), LOOKUP, "INR"), rate: "999" };
  assert.equal(showReset(manual), false);
  assert.equal(resetRate(manual), manual);
});

test("choose: re-picking the same item does not clobber an edited rate or description", () => {
  const picked = applyChoice(fresh(), specType, optionOf("Single · 10 mm"), LOOKUP, "INR");
  const edited = { ...picked, rate: "3100", description: "mine", descriptionEdited: true };
  const again = applyChoice(edited, specType, optionOf("Single · 10 mm"), LOOKUP, "INR");
  assert.equal(again.rate, "3100");
  assert.equal(again.description, "mine");
});

test("choose: moving to another variant drops an untouched suggestion but keeps a typed rate", () => {
  const priced = applyChoice(fresh(), specType, optionOf("Single · 10 mm"), LOOKUP, "INR");
  assert.equal(applyChoice(priced, specType, optionOf("Double · 12 mm"), LOOKUP, "INR").rate, "");
  const typed = { ...priced, rate: "3100" };
  assert.equal(applyChoice(typed, specType, optionOf("Double · 12 mm"), LOOKUP, "INR").rate, "3100");
});

test("choose: fallback mode keeps Stage 33 behaviour (rate untouched, no key, no suggestion)", () => {
  const [fb] = usableEstimateTypes([plainGlass()]).types;
  const l = applyChoice({ ...fresh(), rate: "55" }, fb, buildCombinations(fb)[0], LOOKUP, "INR");
  assert.equal(l.rate, "55");
  assert.equal(l.combinationKey, null);
  assert.equal(l.suggestedUnitPrice, null);
  assert.equal(l.attachDescription, false);
});

// ─── Currency switch (S36-11) ───────────────────────────────────────────────

test("currency: a keyed line re-looks up (even over an override); found -> new rate and suggestion", () => {
  const picked = { ...applyChoice(fresh(), specType, optionOf("Single · 10 mm"), LOOKUP, "INR"), rate: "9999" };
  const usd = relookupForCurrency(picked, [specType], LOOKUP, "USD");
  assert.equal(usd.rate, "40");
  assert.equal(usd.suggestedUnitPrice, 40);
  assert.equal(usd.flag, false);
});

test("currency: not found -> rate cleared, suggestion null, flagged when it had a rate", () => {
  const picked = applyChoice(fresh(), specType, optionOf("Single · 10 mm"), LOOKUP, "INR");
  const aed = relookupForCurrency(picked, [specType], LOOKUP, "AED");
  assert.equal(aed.rate, "");
  assert.equal(aed.suggestedUnitPrice, null);
  assert.equal(aed.flag, true);
  assert.equal(relookupForCurrency(fresh(), [specType], LOOKUP, "AED").flag, false);
});

test("currency: a line with no key keeps D-7 (rate kept, flagged when it has one)", () => {
  const manual = { ...fresh(), typeCode: "GLASS", unit: "m²" as const, rate: "55" };
  const r = relookupForCurrency(manual, [specType], LOOKUP, "USD");
  assert.equal(r.rate, "55");
  assert.equal(r.flag, true);
});

// ─── Line keys: validation, stamper, bridges, storage (AC4, F-4) ────────────

const base = { itemName: "Partition", variantText: "Single · 10 mm", unit: "m²", qty: 10, unitPrice: 2800 };
const full = {
  ...base,
  suggestedUnitPrice: 2800,
  suggestedUnit: "m2",
  combinationKey: KEY_S10,
  description: "  Standard  ",
  descriptionEdited: true,
  attachDescription: true,
};

test("validate: a Stage 33 line is returned with no new keys", () => {
  const r = validateValueLine(base);
  assert.ok(r.ok);
  assert.deepEqual(Object.keys(r.line).sort(), ["itemName", "qty", "unit", "unitPrice", "variantText"]);
});

test("validate: the new keys are accepted, description trimmed, blank becomes null", () => {
  const r = validateValueLine(full);
  assert.ok(r.ok);
  assert.equal(r.line.description, "Standard");
  const blank = validateValueLine({ ...full, description: "   " });
  assert.ok(blank.ok && blank.line.description === null);
  assert.ok(validateValueLine({ ...base, suggestedUnitPrice: null, suggestedUnit: null, combinationKey: null, description: null }).ok);
});

test("validate: bad new keys are rejected", () => {
  for (const bad of [
    { suggestedUnitPrice: -1 },
    { suggestedUnitPrice: 1.234 },
    { suggestedUnitPrice: "5" },
    { suggestedUnit: "sq ft" },
    { suggestedUnit: 3 },
    { combinationKey: 5 },
    { combinationKey: "x".repeat(1001) },
    { description: 7 },
    { description: "x".repeat(501) },
    { descriptionEdited: "yes" },
    { attachDescription: 1 },
  ]) {
    assert.equal(validateValueLine({ ...base, ...bad }).ok, false, JSON.stringify(bad));
  }
});

test("stamper: keeps the new keys and a Stage 33 estimate is stamped unchanged", () => {
  const parsed = parseQuickEstimateInput({ lines: [full, base] });
  assert.ok(parsed.ok);
  const stamped = stampQuickEstimate(parsed.value, "INR", "Tester", new Date("2026-11-17T00:00:00Z"));
  assert.equal(stamped.lines[0].combinationKey, KEY_S10);
  assert.equal(stamped.lines[0].attachDescription, true);
  assert.equal(stamped.lines[0].description, "Standard");
  assert.deepEqual(Object.keys(stamped.lines[1]).sort(), ["itemName", "qty", "unit", "unitPrice", "variantText"]);
});

test("stamper: an invalid new key is rejected by the parser (400 path)", () => {
  assert.equal(parseQuickEstimateInput({ lines: [{ ...base, suggestedUnit: "bogus" }] }).ok, false);
});

function draftWith(line: DraftLine): EstimateDraft {
  return { currency: "INR", discountMode: "pct", discountValue: "", taxPct: "", lines: [line] };
}
const priced = (): DraftLine => ({
  ...applyChoice(fresh(), specType, optionOf("Single · 10 mm"), LOOKUP, "INR"),
  qty: "10",
  description: "edited text",
  descriptionEdited: true,
});

test("attach payload: draftToInput carries the keys; storedToInput and storedToDraft round trip them", () => {
  const input = draftToInput(draftWith(priced()));
  assert.equal(input.lines[0].combinationKey, KEY_S10);
  assert.equal(input.lines[0].suggestedUnitPrice, 2800);
  assert.equal(input.lines[0].description, "edited text");
  assert.equal(input.lines[0].descriptionEdited, true);
  assert.equal(input.lines[0].attachDescription, true);

  const stored = { currency: "INR", ...input };
  assert.deepEqual(storedToInput(stored).lines[0], input.lines[0]);
  const seeded = storedToDraft(stored, [specType], "INR", () => "n1");
  assert.equal(seeded.lines[0].suggestedUnitPrice, 2800);
  assert.equal(seeded.lines[0].combinationKey, KEY_S10);
  assert.equal(seeded.lines[0].description, "edited text");
  assert.equal(showReset(seeded.lines[0]), false);
  assert.equal(showReset({ ...seeded.lines[0], rate: "1" }), true);
});

test("storedToDraft: a Stage 33 line seeds with the defaults (no suggestion, unchecked, empty)", () => {
  const d = storedToDraft({ currency: "INR", discountMode: "pct", discountValue: 0, taxPct: 0, lines: [{ itemName: "Partition", variantText: "x", unit: "m²", qty: 1, unitPrice: 5 }] }, [specType], "INR", () => "n1");
  const l = d.lines[0];
  assert.deepEqual([l.suggestedUnitPrice, l.suggestedUnit, l.combinationKey, l.description, l.descriptionEdited, l.attachDescription], [null, null, null, "", false, false]);
});

test("storage: the new line keys survive a serialise/parse round trip", () => {
  const raw = serializeDraft(draftWith(priced()));
  const back = parseStoredDraft(raw, [specType], "INR", () => "r1").lines[0];
  assert.equal(back.suggestedUnitPrice, 2800);
  assert.equal(back.suggestedUnit, "m2");
  assert.equal(back.combinationKey, KEY_S10);
  assert.equal(back.description, "edited text");
  assert.equal(back.descriptionEdited, true);
  assert.equal(back.attachDescription, true);
});

test("storage: an old draft without the new keys loads with the defaults", () => {
  const old = JSON.stringify({
    currency: "INR",
    discountMode: "pct",
    discountValue: "",
    taxPct: "",
    lines: [{ typeCode: "GLASS", itemName: "Partition", variantText: "Single · 10 mm", qty: "4", rate: "100" }],
  });
  const l = parseStoredDraft(old, [specType], "INR", () => "o1").lines[0];
  assert.equal(l.rate, "100");
  assert.deepEqual([l.suggestedUnitPrice, l.suggestedUnit, l.combinationKey, l.description, l.descriptionEdited, l.attachDescription], [null, null, null, "", false, false]);
});

test("storage: a corrupt new key takes its default and never drops the line", () => {
  const bad = JSON.stringify({
    currency: "INR",
    lines: [{ typeCode: "GLASS", itemName: "Partition", variantText: "v", qty: "1", rate: "1", suggestedUnitPrice: "x", suggestedUnit: "zz", combinationKey: 9, description: 4, attachDescription: "yes" }],
  });
  const l = parseStoredDraft(bad, [specType], "INR", () => "b1").lines[0];
  assert.deepEqual([l.suggestedUnitPrice, l.suggestedUnit, l.combinationKey, l.description, l.attachDescription], [null, null, null, "", false]);
});

// ─── Sheet / PDF text (AC5) ─────────────────────────────────────────────────

function sheetOf(lines: Parameters<typeof computeEstimate>[0]) {
  const result = computeEstimate(lines, { mode: "pct", value: 0 }, 0);
  return buildSheet(lines, result, "INR", { subtotal: "Subtotal", discount: "Discount", tax: "Tax", total: "Total" });
}

test("sheet: the description prints only when attached and non-blank", () => {
  const lines = toValueLines([
    priced(), // attached, "edited text"
    { ...priced(), id: "l2", attachDescription: false },
    { ...priced(), id: "l3", description: "   " },
    { ...fresh(), id: "l4", typeCode: "GLASS", unit: "m²", itemName: "Partition", variantText: "old", qty: "1", rate: "5" },
  ]);
  const rows = sheetOf(lines).rows;
  assert.equal(rows.length, 4);
  assert.equal(rows[0].description, "edited text");
  assert.equal(rows[1].description, undefined);
  assert.equal(rows[2].description, undefined);
  assert.equal(rows[3].description, undefined);
});
