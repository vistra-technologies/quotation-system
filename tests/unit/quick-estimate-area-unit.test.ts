import { test } from "node:test";
import assert from "node:assert/strict";
import { convertAreaQty, convertAreaQtyString, SQFT_PER_M2 } from "../../lib/quick-estimate/area-units";
import { validateValueLine } from "../../lib/quick-estimate/estimate";
import { areaUnitOf, draftToInput, storedToDraft } from "../../lib/quick-estimate/inquiry-draft";
import { emptyDraft, newLine, type DraftLine, type EstimateDraft } from "../../lib/quick-estimate/lines";
import { buildCombinations, usableEstimateTypes, type ComponentTypeInput } from "../../lib/quick-estimate/palette";
import { parseStoredDraft, serializeDraft } from "../../lib/quick-estimate/storage";
import { applyChoice, showReset, switchAreaUnit, type PricingLookup } from "../../lib/quick-estimate/suggest";
import { combinationKey } from "../../lib/product-pricing/combination";
import type { FieldEntry } from "../../lib/types/field-entry";
import type { FieldOptionsConfig } from "../../lib/types/field-options-config";

// Stage 36 Batch 5: the m² / sq ft toggle (S36-13, S36-18, PP-27, plan F-5).

const fields: FieldEntry[] = [{ key: "category", label: "category", type: "dropdown", required: true, basic: true, productSpec: true }];
const config: FieldOptionsConfig = { category: { options: ["Single", "Double", "Triple"] } };
const glass: ComponentTypeInput = { id: "id-GLASS", code: "GLASS", name: "Partition", active: true, fieldsSchema: fields, fieldOptionsConfig: config };
const [type] = usableEstimateTypes([glass]).types;
const types = [type];
const opt = (text: string) => buildCombinations(type).find((o) => o.text === text)!;
const K = (c: string) => combinationKey({ category: c });

const LOOKUP: PricingLookup = {
  [type.id]: {
    // Single: both units in INR.
    [K("Single")]: { prices: [{ currency: "INR", unit: "m2", amount: 2800 }, { currency: "INR", unit: "sqft", amount: 260 }], description: null },
    // Double: only m2 (no sq ft entry: the rate must come out empty, never converted).
    [K("Double")]: { prices: [{ currency: "INR", unit: "m2", amount: 3100 }], description: null },
    // Triple: only USD sq ft.
    [K("Triple")]: { prices: [{ currency: "USD", unit: "sqft", amount: 30 }], description: null },
  },
};

const fresh = (id = "a"): DraftLine => newLine(id);
const picked = (variant: string, qty: string, id = "a"): DraftLine => ({ ...applyChoice(fresh(id), type, opt(variant), LOOKUP, "INR", "m²"), qty });
const draftOf = (lines: DraftLine[], over: Partial<EstimateDraft> = {}): EstimateDraft => ({ ...emptyDraft("INR"), lines, ...over });
const pcsLine = (): DraftLine => ({ ...fresh("p"), typeCode: "DOOR", itemName: "Door", variantText: "Standard", unit: "pcs", qty: "3", rate: "1500" });

// ─── Quantity conversion ────────────────────────────────────────────────────

test("convert: m2 to sq ft multiplies, sq ft to m2 divides, 2 dp, rounded once", () => {
  assert.equal(convertAreaQty(1, "m²", "sq ft"), 10.76);
  assert.equal(convertAreaQty(42, "m²", "sq ft"), 452.08);
  assert.equal(convertAreaQty(452.08, "sq ft", "m²"), 42);
  assert.equal(convertAreaQty(5, "sq ft", "sq ft"), 5);
  assert.ok(SQFT_PER_M2 === 10.7639);
});

test("convert: a typed string keeps blank and non-positive input as typed", () => {
  assert.equal(convertAreaQtyString("", "m²", "sq ft"), "");
  assert.equal(convertAreaQtyString("0", "m²", "sq ft"), "0");
  assert.equal(convertAreaQtyString("abc", "m²", "sq ft"), "abc");
  assert.equal(convertAreaQtyString("12", "m²", "sq ft"), "129.17");
});

test("no drift across 5 toggles: an m2 start returns exactly, a sq ft start settles after one round trip", () => {
  for (const start of [1, 7.5, 12.34, 42, 99.99, 0.01]) {
    let q = start;
    for (let i = 0; i < 5; i++) q = convertAreaQty(q, i % 2 === 0 ? "m²" : "sq ft", i % 2 === 0 ? "sq ft" : "m²");
    // 5 switches end in sq ft: equals a single conversion of the m2 start.
    assert.equal(q, convertAreaQty(start, "m²", "sq ft"), `m2 start ${start}`);
    let m = start;
    for (let i = 0; i < 4; i++) m = convertAreaQty(m, i % 2 === 0 ? "m²" : "sq ft", i % 2 === 0 ? "sq ft" : "m²");
    assert.equal(m, start, `m2 start ${start} after 4 switches`);
  }
  // sq ft start: stable after the first round trip (the only rounding loss), never growing.
  for (const start of [10, 100, 452.09, 3.33]) {
    const once = convertAreaQty(convertAreaQty(start, "sq ft", "m²"), "m²", "sq ft");
    const twice = convertAreaQty(convertAreaQty(once, "sq ft", "m²"), "m²", "sq ft");
    assert.equal(twice, once, `sq ft start ${start}`);
    assert.ok(Math.abs(once - start) <= 0.06, `sq ft start ${start} moved ${once}`);
  }
});

// ─── Switch: rate reset (S36-18) ────────────────────────────────────────────

test("switch: qty converts, the line unit and draft unit change, pcs lines are untouched", () => {
  const door = pcsLine();
  const { draft } = switchAreaUnit(draftOf([picked("Single", "42"), door]), "sq ft", types, LOOKUP);
  assert.equal(draft.areaUnit, "sq ft");
  assert.equal(draft.lines[0].unit, "sq ft");
  assert.equal(draft.lines[0].qty, "452.08");
  assert.deepEqual(draft.lines[1], door);
});

test("switch: exact (currency, new unit) entry gives that price and suggestion, Reset hidden", () => {
  const { draft, replaced } = switchAreaUnit(draftOf([picked("Single", "10")]), "sq ft", types, LOOKUP);
  const l = draft.lines[0];
  assert.equal(l.rate, "260");
  assert.equal(l.suggestedUnitPrice, 260);
  assert.equal(l.suggestedUnit, "sqft");
  assert.equal(showReset(l), false);
  assert.equal(replaced, false); // untouched suggestion: no toast
});

test("switch: no entry for the new unit empties the rate and the suggestion, never converts", () => {
  const { draft, replaced } = switchAreaUnit(draftOf([picked("Double", "10")]), "sq ft", types, LOOKUP);
  const l = draft.lines[0];
  assert.equal(l.rate, "");
  assert.equal(l.suggestedUnitPrice, null);
  assert.equal(l.suggestedUnit, null);
  assert.equal(showReset(l), false);
  assert.equal(replaced, false); // it sat at its default: no toast
});

test("switch: another currency's price for the new unit is not used", () => {
  const { draft } = switchAreaUnit(draftOf([picked("Triple", "10")]), "sq ft", types, LOOKUP);
  assert.equal(draft.lines[0].rate, "");
});

test("switch: an overridden rate is replaced and the toast predicate is true", () => {
  const over = { ...picked("Single", "10"), rate: "2999" };
  const { draft, replaced } = switchAreaUnit(draftOf([over]), "sq ft", types, LOOKUP);
  assert.equal(replaced, true);
  assert.equal(draft.lines[0].rate, "260");
  assert.equal(showReset(draft.lines[0]), false);
});

test("switch: a typed rate on a line with no product price is cleared and the predicate is true (null counts)", () => {
  const manual: DraftLine = { ...fresh("m"), typeCode: "GLASS", itemName: "Partition", variantText: "x", unit: "m²", qty: "4", rate: "500" };
  const { draft, replaced } = switchAreaUnit(draftOf([manual]), "sq ft", types, LOOKUP);
  assert.equal(replaced, true);
  assert.equal(draft.lines[0].rate, "");
  assert.equal(draft.lines[0].suggestedUnitPrice, null);
});

test("switch: an overridden rate that ends up empty (no new-unit entry) still counts as replaced", () => {
  const over = { ...picked("Double", "10"), rate: "1" };
  const r = switchAreaUnit(draftOf([over]), "sq ft", types, LOOKUP);
  assert.equal(r.replaced, true);
  assert.equal(r.draft.lines[0].rate, "");
});

test("switch: every line at default or empty gives no toast, even with several lines", () => {
  const empty = { ...picked("Single", "5", "b"), rate: "" };
  const r = switchAreaUnit(draftOf([picked("Single", "10"), picked("Double", "10", "c"), empty, pcsLine()]), "sq ft", types, LOOKUP);
  assert.equal(r.replaced, false);
});

test("switch: one replaced rate among several lines gives one result flag (once per switch)", () => {
  const r = switchAreaUnit(draftOf([picked("Single", "10"), { ...picked("Single", "10", "b"), rate: "1" }, { ...picked("Single", "10", "c"), rate: "2" }]), "sq ft", types, LOOKUP);
  assert.equal(r.replaced, true);
});

test("switch: back to m2 resets to the m2 price (or empty), qty returns within rounding", () => {
  const there = switchAreaUnit(draftOf([{ ...picked("Single", "42"), rate: "1" }]), "sq ft", types, LOOKUP).draft;
  const back = switchAreaUnit(there, "m²", types, LOOKUP);
  assert.equal(back.draft.lines[0].rate, "2800");
  assert.equal(back.draft.lines[0].qty, "42");
  assert.equal(back.replaced, false);
  assert.equal(back.draft.lines[0].unit, "m²");
});

test("switch: the same unit is a no-op and currency is untouched", () => {
  const d = draftOf([picked("Single", "10")], { currency: "USD" });
  assert.equal(switchAreaUnit(d, "m²", types, LOOKUP).draft, d);
  assert.equal(switchAreaUnit(d, "sq ft", types, LOOKUP).draft.currency, "USD");
});

test("switch: the currency drives the lookup, the flag clears, the description is untouched", () => {
  const l = { ...picked("Single", "10"), flag: true, description: "kept", descriptionEdited: true, attachDescription: true };
  const out = switchAreaUnit(draftOf([l], { currency: "USD" }), "sq ft", types, LOOKUP).draft.lines[0];
  assert.equal(out.rate, ""); // Single has no USD sq ft entry
  assert.equal(out.flag, false);
  assert.equal(out.description, "kept");
  assert.equal(out.descriptionEdited, true);
});

// ─── A new line takes the draft's area unit ─────────────────────────────────

test("a line picked while sq ft is active shows sq ft and looks up the sq ft price", () => {
  const l = applyChoice(fresh(), type, opt("Single"), LOOKUP, "INR", "sq ft");
  assert.equal(l.unit, "sq ft");
  assert.equal(l.rate, "260");
  assert.equal(l.suggestedUnit, "sqft");
});

// ─── Validation, storage, attach/open (F-5) ─────────────────────────────────

test("validateValueLine accepts sq ft with qty up to 2 dp and rejects more", () => {
  const base = { itemName: "Partition", variantText: "x", unit: "sq ft", unitPrice: 10 };
  assert.equal(validateValueLine({ ...base, qty: 452.08 }).ok, true);
  assert.equal(validateValueLine({ ...base, qty: 452.083 }).ok, false);
  assert.equal(validateValueLine({ ...base, qty: 1, unit: "ft" }).ok, false);
  assert.equal(validateValueLine({ ...base, qty: 1, suggestedUnit: "sqft" }).ok, true);
});

test("sessionStorage round trip keeps the area unit; an old draft without it loads as m2", () => {
  const d = switchAreaUnit(draftOf([picked("Single", "10")]), "sq ft", types, LOOKUP).draft;
  let n = 0;
  const back = parseStoredDraft(serializeDraft(d), types, "INR", () => `x${++n}`);
  assert.equal(back.areaUnit, "sq ft");
  assert.equal(back.lines[0].unit, "sq ft");
  assert.equal(back.lines[0].qty, "107.64");
  const old = JSON.parse(serializeDraft(d));
  delete old.areaUnit;
  const loaded = parseStoredDraft(JSON.stringify(old), types, "INR", () => `y${++n}`);
  assert.equal(loaded.areaUnit, "m²");
  assert.equal(loaded.lines[0].unit, "m²");
  assert.equal(parseStoredDraft(JSON.stringify({ ...old, areaUnit: "acres" }), types, "INR", () => "z").areaUnit, "m²");
});

test("attach stores sq ft lines with the sq ft suggestion; the payload has no top-level unit key", () => {
  const d = switchAreaUnit(draftOf([picked("Single", "10")]), "sq ft", types, LOOKUP).draft;
  const input = draftToInput({ ...d, lines: d.lines.map((l) => ({ ...l, rate: "260" })) });
  assert.equal(input.lines[0].unit, "sq ft");
  assert.equal(input.lines[0].suggestedUnit, "sqft");
  assert.equal("areaUnit" in input, false);
});

test("opening an inquiry derives the area unit from the first area line (F-5), matches the type for the chip", () => {
  const stored = {
    currency: "INR",
    discountMode: "pct" as const,
    discountValue: 0,
    taxPct: 0,
    lines: [
      { itemName: "Door", variantText: "s", unit: "pcs" as const, qty: 1, unitPrice: 5 },
      { itemName: "Partition", variantText: "Single", unit: "sq ft" as const, qty: 10, unitPrice: 260 },
      { itemName: "Partition", variantText: "Double", unit: "m²" as const, qty: 2, unitPrice: 3100 },
    ],
  };
  assert.equal(areaUnitOf(stored.lines), "sq ft");
  assert.equal(areaUnitOf([{ unit: "pcs" }]), "m²");
  let n = 0;
  const d = storedToDraft(stored, types, "INR", () => `s${++n}`);
  assert.equal(d.areaUnit, "sq ft");
  assert.equal(d.lines[1].typeCode, "GLASS");
  assert.equal(d.lines[2].typeCode, "GLASS");
  // Mixed estimate: nothing converted on open; switching to m2 converts only the sq ft line.
  assert.equal(d.lines[2].qty, "2");
  const sw = switchAreaUnit(d, "m²", types, LOOKUP).draft;
  assert.equal(sw.lines[1].qty, "0.93");
  assert.equal(sw.lines[2].qty, "2");
});

test("re-pick: a line still in the other area unit has its qty converted, never kept as the same number", () => {
  const stale: DraftLine = { ...picked("Single", "2"), unit: "m²" }; // a mixed stored estimate: draft unit is sq ft
  const out = applyChoice(stale, type, opt("Double"), LOOKUP, "INR", "sq ft");
  assert.equal(out.unit, "sq ft");
  assert.equal(out.qty, "21.53");
  const back = applyChoice({ ...out }, type, opt("Single"), LOOKUP, "INR", "m²");
  assert.equal(back.unit, "m²");
  assert.equal(back.qty, "2");
  // same unit: untouched; area to pcs type kind change still clears
  assert.equal(applyChoice(picked("Single", "7"), type, opt("Double"), LOOKUP, "INR", "m²").qty, "7");
  assert.equal(applyChoice({ ...pcsLine(), qty: "3" }, type, opt("Double"), LOOKUP, "INR", "m²").qty, "");
});
