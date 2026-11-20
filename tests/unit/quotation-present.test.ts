/**
 * Stage 38 Batch 4: the pure presentation helpers of the Quotation page (lib/quotation/present.ts): money text,
 * quantity / unit text, data-driven sections, KPIs, the totals-form checks (Q-D33 cap, PATCH diff).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chargesFormValid,
  chargesPatch,
  discountCapExceeded,
  editedLineCount,
  formatCents,
  formatDate,
  formatMoney,
  formatQuantity,
  kpisOf,
  percentLabel,
  priceUnit,
  quantityParts,
  sectionTotalCents,
  sectionsOf,
  unitText,
  type ChargesForm,
} from "../../lib/quotation/present";
import type { Summary } from "../../lib/summary/types";

const SNAPSHOT = {
  takenAt: "2026-11-01T00:00:00.000Z",
  componentTypes: [
    { id: "1", code: "GLASS", name: "Partition", active: true, fieldsSchema: [], fieldOptionsConfig: {} },
    { id: "2", code: "DOOR", name: "Door", active: true, fieldsSchema: [], fieldOptionsConfig: {} },
  ],
};

test("formatMoney: 2 dp with thousands separators, from any stored decimal text", () => {
  assert.equal(formatMoney("2650"), "2,650.00");
  assert.equal(formatMoney("2650.5"), "2,650.50");
  assert.equal(formatMoney("1234567.89"), "1,234,567.89");
  assert.equal(formatMoney("0"), "0.00");
  assert.equal(formatMoney("abc"), "abc");
  assert.equal(formatCents(1800000), "18,000.00");
});

test("formatDate is UTC, so the server render and the browser agree", () => {
  assert.equal(formatDate("2026-11-20T23:30:00.000Z"), "20 Nov 2026");
  assert.equal(formatDate(new Date("2026-12-20T00:00:00.000Z")), "20 Dec 2026");
});

test("quantity text: decimals as stored, packs read 'N packs of M unit' (Q-D16)", () => {
  assert.equal(formatQuantity(86.42), "86.42");
  assert.equal(formatQuantity(14), "14");
  assert.deepEqual(quantityParts({ quantity: 86.42, perUnitQuantity: 1, unit: "m²" }), { main: "86.42", muted: "m²" });
  assert.deepEqual(quantityParts({ quantity: 36, perUnitQuantity: 1, unit: "pieces" }), { main: "36", muted: "pcs" });
  assert.deepEqual(quantityParts({ quantity: 1, perUnitQuantity: 1, unit: "pieces" }), { main: "1", muted: "pc" });
  assert.deepEqual(quantityParts({ quantity: 14, perUnitQuantity: 6, unit: "metres" }), { main: "14 packs", muted: "of 6 m" });
  assert.deepEqual(quantityParts({ quantity: 1, perUnitQuantity: 25, unit: "metres" }), { main: "1 pack", muted: "of 25 m" });
  assert.deepEqual(quantityParts({ quantity: 2, perUnitQuantity: 100, unit: "pieces" }), { main: "2 packs", muted: "of 100 pcs" });
  assert.equal(unitText("set", 3), "sets");
  assert.equal(unitText("set", 1), "set");
});

test("price unit: 'pack' for a pack item, else the unit symbol", () => {
  assert.equal(priceUnit({ perUnitQuantity: 6, unit: "metres" }), "pack");
  assert.equal(priceUnit({ perUnitQuantity: 1, unit: "metres" }), "m");
  assert.equal(priceUnit({ perUnitQuantity: 1, unit: "pieces" }), "pc");
  assert.equal(priceUnit({ perUnitQuantity: 1, unit: "m²" }), "m²");
});

test("sections: grouped by slot from the data in snapshot order, unknown slots after, shared last (S38-D8)", () => {
  const line = (code: string, slot: string | string[]) => ({ code, slot });
  const out = sectionsOf(
    [line("D1", "DOOR"), line("X1", "EXTRA"), line("G1", "GLASS"), line("S1", ["GLASS", "DOOR"]), line("G2", "GLASS"), line("Y1", "OTHER")],
    SNAPSHOT,
  );
  assert.deepEqual(out.map((s) => [s.code, s.title, s.lines.map((l) => l.code)]), [
    ["GLASS", "Partition", ["G1", "G2"]],
    ["DOOR", "Door", ["D1"]],
    ["EXTRA", "EXTRA", ["X1"]],
    ["OTHER", "OTHER", ["Y1"]],
    ["shared", "Shared materials", ["S1"]],
  ]);
  assert.deepEqual(sectionsOf([line("A", "PROFILE_STOP")], null).map((s) => s.title), ["PROFILE_STOP"]);
  assert.deepEqual(sectionsOf([], SNAPSHOT), []);
});

test("section total sums the stored amounts in cents; edited lines are counted from the staff payload only", () => {
  assert.equal(sectionTotalCents([{ amount: "100.10" }, { amount: "0.05" }]), 10015);
  assert.equal(editedLineCount([{ unitPrice: "10.00", defaultPrice: "10.00" }, { unitPrice: "9.00", defaultPrice: "10.00" }]), 1);
  assert.equal(editedLineCount([{ unitPrice: "9.00" }]), 0); // an external line has no defaultPrice
});

test("KPIs: glass area and types, door count and distinct door types", () => {
  const summary = {
    floors: [{ floorId: "f", floorLabel: "F", rooms: [{ roomId: "r", roomLabel: "R", walls: [{
      partitionId: "p", wallLabel: "W", glass: [],
      doors: [
        { widthMm: 900, heightMm: 2100, handing: "LH", category: "Single", doorType: "Simple Glass", quantity: 4 },
        { widthMm: 900, heightMm: 2100, handing: "RH", category: "Single", doorType: "Simple Glass", quantity: 1 },
        { widthMm: 900, heightMm: 2100, handing: "LH", category: "Single", doorType: "Sliding", quantity: 1 },
      ],
    }] }] }],
    kpis: {
      totalPartitionSqm: 0,
      sqmByGlassType: [{ glassType: "ID1", thickness: "12", areaM2: 86.42 }, { glassType: "NT2", thickness: "15.3", areaM2: 24.18 }],
      doorsByType: [],
    },
  } as unknown as Summary;
  const k = kpisOf(summary);
  assert.equal(k.glassTypes, 2);
  assert.equal(Math.round(k.glassM2 * 100), 11060);
  assert.deepEqual([k.doors, k.doorTypes], [6, 2]);
});

const FORM: ChargesForm = { transport: "18,000.00", otherCharges: "4,500.00", discountType: "PERCENT", discount: "5", taxPercent: "18" };

test("discount cap (Q-D33): a typed fixed discount above lines + typed charges is refused, equal is fine, a percent never is", () => {
  const lines = 10_000_00;
  assert.equal(discountCapExceeded(lines, { ...FORM, discountType: "FIXED", discount: "32,500.00" }), null); // exactly the subtotal
  assert.equal(discountCapExceeded(lines, { ...FORM, discountType: "FIXED", discount: "32,500.01" }), "32,500.00");
  // the cap follows the typed charges, not the stored ones
  assert.equal(discountCapExceeded(lines, { ...FORM, transport: "0", otherCharges: "0", discountType: "FIXED", discount: "10,000.01" }), "10,000.00");
  assert.equal(discountCapExceeded(lines, { ...FORM, discountType: "PERCENT", discount: "100" }), null);
  assert.equal(discountCapExceeded(lines, { ...FORM, discountType: "FIXED", discount: "abc" }), null);
});

test("form validity: money to 2 dp, percents 0 to 100", () => {
  assert.equal(chargesFormValid(FORM), true);
  assert.equal(chargesFormValid({ ...FORM, transport: "-1" }), false);
  assert.equal(chargesFormValid({ ...FORM, otherCharges: "1.005" }), false);
  assert.equal(chargesFormValid({ ...FORM, taxPercent: "100.01" }), false);
  assert.equal(chargesFormValid({ ...FORM, discount: "101" }), false);
  assert.equal(chargesFormValid({ ...FORM, discountType: "FIXED", discount: "101" }), true);
  assert.equal(chargesFormValid({ ...FORM, transport: "" }), false);
});

test("PATCH diff: only changed fields, separators stripped, a type change carries its discount, none changed is null", () => {
  const stored: ChargesForm = { transport: "18000.00", otherCharges: "4500.00", discountType: "PERCENT", discount: "5.00", taxPercent: "18.00" };
  assert.equal(chargesPatch(stored, FORM), null);
  assert.deepEqual(chargesPatch(stored, { ...FORM, transport: "20,000.00" }), { transport: "20000.00" });
  assert.deepEqual(chargesPatch(stored, { ...FORM, discountType: "FIXED" }), { discountType: "FIXED", discount: "5" });
  assert.deepEqual(chargesPatch(stored, { ...FORM, discount: "7.5", taxPercent: "12" }), { discount: "7.5", discountType: "PERCENT", taxPercent: "12" });
});

test("percent label drops trailing zeros", () => {
  assert.equal(percentLabel("5.00"), "5");
  assert.equal(percentLabel("18.50"), "18.5");
  assert.equal(percentLabel("100"), "100");
  assert.equal(percentLabel("0.00"), "0");
});
