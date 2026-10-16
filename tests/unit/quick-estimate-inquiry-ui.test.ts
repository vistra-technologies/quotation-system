import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEstimate } from "../../lib/quick-estimate/estimate";
import { parseQuickEstimateInput } from "../../lib/quick-estimate/inquiry-estimate";
import {
  draftToAttached,
  draftToInput,
  isPricedLine,
  pricedDraftLines,
  sameDraft,
  storedToDraft,
  storedToInput,
} from "../../lib/quick-estimate/inquiry-draft";
import { emptyDraft, newLine, toValueLines, type DraftLine, type EstimateDraft } from "../../lib/quick-estimate/lines";
import type { EstimateType } from "../../lib/quick-estimate/palette";

const TYPES: EstimateType[] = [
  { id: "t1", code: "GLASS", name: "Partition", unit: "m²", basicFields: [], options: {} as EstimateType["options"] },
  { id: "t2", code: "DOOR", name: "Door", unit: "pcs", basicFields: [], options: {} as EstimateType["options"] },
];

const line = (over: Partial<DraftLine> = {}): DraftLine => ({
  ...newLine("l1"),
  typeCode: "GLASS",
  itemName: "Partition",
  variantText: "Single glazed · Clear · 12 mm",
  unit: "m²",
  qty: "42.5",
  rate: "3200",
  ...over,
});

const draft = (over: Partial<EstimateDraft> = {}): EstimateDraft => ({ ...emptyDraft("INR"), lines: [line()], ...over });

let n = 0;
const nextId = () => `x${++n}`;

test("isPricedLine: needs an item, qty > 0 and rate > 0", () => {
  assert.equal(isPricedLine(line()), true);
  assert.equal(isPricedLine(line({ qty: "" })), false);
  assert.equal(isPricedLine(line({ qty: "0" })), false);
  assert.equal(isPricedLine(line({ rate: "" })), false);
  assert.equal(isPricedLine(line({ typeCode: null, unit: null })), false);
  // a fractional pcs quantity is invalid, so it is 0 and unpriced
  assert.equal(isPricedLine(line({ unit: "pcs", typeCode: "DOOR", qty: "1.5" })), false);
});

test("draftToInput sends priced lines only", () => {
  const d = draft({
    lines: [line({ id: "a" }), line({ id: "b", qty: "" }), line({ id: "c", rate: "0" }), line({ id: "d", typeCode: null, unit: null })],
  });
  assert.equal(pricedDraftLines(d).length, 1);
  const input = draftToInput(d);
  assert.equal(input.lines.length, 1);
  assert.deepEqual(input.lines[0], {
    itemName: "Partition",
    variantText: "Single glazed · Clear · 12 mm",
    unit: "m²",
    qty: 42.5,
    unitPrice: 3200,
  });
});

test("draftToInput never emits currency, whatever the draft currency", () => {
  const input = draftToInput(draft({ currency: "AED" }));
  assert.equal("currency" in input, false);
  assert.equal(draftToAttached(draft({ currency: "AED" })).currency, "AED");
});

test("draftToInput normalises discount and tax to the server bounds", () => {
  assert.deepEqual(
    (({ discountMode, discountValue, taxPct }) => ({ discountMode, discountValue, taxPct }))(
      draftToInput(draft({ discountMode: "pct", discountValue: "250", taxPct: "180" })),
    ),
    { discountMode: "pct", discountValue: 100, taxPct: 100 },
  );
  const amount = draftToInput(draft({ discountMode: "amount", discountValue: "12.3456", taxPct: "-3" }));
  assert.equal(amount.discountValue, 12.35);
  assert.equal(amount.taxPct, 0);
  const blank = draftToInput(draft({ discountValue: "", taxPct: "abc" }));
  assert.equal(blank.discountValue, 0);
  assert.equal(blank.taxPct, 0);
});

test("the payload passes the server parser (what the popup builds can't 400)", () => {
  const r = parseQuickEstimateInput(
    draftToInput(draft({ discountMode: "amount", discountValue: "1000.555", taxPct: "18", lines: [line(), line({ id: "k", unit: "pcs", typeCode: "DOOR", itemName: "Door", qty: "3", rate: "28500.5" })] })),
  );
  assert.ok(r.ok, r.ok ? "" : r.error);
});

test("storedToDraft matches the palette by name + unit; no match is a generic line", () => {
  const stored = {
    currency: "INR",
    discountMode: "pct" as const,
    discountValue: 5,
    taxPct: 18,
    lines: [
      { itemName: "Partition", variantText: "A", unit: "m²" as const, qty: 10, unitPrice: 100 },
      { itemName: "Door", variantText: "B", unit: "pcs" as const, qty: 2, unitPrice: 50 },
      { itemName: "Renamed thing", variantText: "", unit: "pcs" as const, qty: 1, unitPrice: 10 },
      // same name, different unit: not the Partition (m²) type
      { itemName: "Partition", variantText: "", unit: "pcs" as const, qty: 1, unitPrice: 10 },
    ],
  };
  const d = storedToDraft(stored, TYPES, "INR", nextId);
  assert.deepEqual(d.lines.map((l) => l.typeCode), ["GLASS", "DOOR", "", ""]);
  assert.equal(d.discountValue, "5");
  assert.equal(d.taxPct, "18");
  assert.equal(d.currency, "INR");
  assert.ok(d.lines.every((l) => !l.flag));
  assert.equal(new Set(d.lines.map((l) => l.id)).size, 4);
});

test("storedToDraft in another currency keeps rates, flags priced ones and locks the currency (D-28)", () => {
  const d = storedToDraft(
    {
      currency: "INR",
      discountMode: "amount",
      discountValue: 0,
      taxPct: 0,
      lines: [
        { itemName: "Partition", variantText: "", unit: "m²", qty: 1, unitPrice: 4200 },
        { itemName: "Door", variantText: "", unit: "pcs", qty: 1, unitPrice: 0 },
      ],
    },
    TYPES,
    "AED",
    nextId,
  );
  assert.equal(d.currency, "AED");
  assert.equal(d.lines[0].rate, "4200"); // never converted
  assert.deepEqual(d.lines.map((l) => l.flag), [true, false]);
  assert.equal(d.discountValue, ""); // 0 shows blank
});

test("round trip: stored -> draft -> input equals the stored values (priced lines)", () => {
  const stored = {
    currency: "AED",
    discountMode: "amount" as const,
    discountValue: 250.5,
    taxPct: 5,
    lines: [
      { itemName: "Partition", variantText: "Single glazed · Clear · 12 mm", unit: "m²" as const, qty: 48.5, unitPrice: 190 },
      { itemName: "Door", variantText: "Glass door · Sliding", unit: "pcs" as const, qty: 4, unitPrice: 840.25 },
    ],
  };
  const d = storedToDraft(stored, TYPES, "AED", nextId);
  assert.deepEqual(draftToInput(d), storedToInput(stored));
  // and the maths read the same from either side
  const a = computeEstimate(toValueLines(d.lines), { mode: "amount", value: 250.5 }, 5);
  const b = computeEstimate(stored.lines, { mode: stored.discountMode, value: stored.discountValue }, stored.taxPct);
  assert.deepEqual(a, b);
});

test("storedToInput drops the server stamp and currency", () => {
  const input = storedToInput({
    currency: "INR",
    discountMode: "pct",
    discountValue: 0,
    taxPct: 0,
    lines: [{ itemName: "Door", variantText: "", unit: "pcs", qty: 1, unitPrice: 1 }],
    // extra keys from the stored V1 object must not leak through
    ...({ v: 1, updatedAt: "x", updatedByName: "y" } as object),
  });
  assert.deepEqual(Object.keys(input).sort(), ["discountMode", "discountValue", "lines", "taxPct"]);
});

test("sameDraft: equal by value, different on any edit", () => {
  const a = draft();
  assert.equal(sameDraft(a, structuredClone(a)), true);
  assert.equal(sameDraft(a, draft({ taxPct: "1" })), false);
  assert.equal(sameDraft(a, draft({ lines: [line({ qty: "43" })] })), false);
  assert.equal(sameDraft(a, draft({ lines: [line({ flag: true })] })), false);
});
