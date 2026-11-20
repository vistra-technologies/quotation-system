import { test } from "node:test";
import assert from "node:assert/strict";
import { lineAmountCents, parsePercentToHundredths, percentOfCents, quantityToMilli } from "../../lib/money";
import { anyLineEdited, buildLines, isLineEdited, refreshLines, repriceLines } from "../../lib/quotation/lines";
import { computeTotals, discountAmountOf } from "../../lib/quotation/totals";
import { deriveStatus, formatQuotationNumber, isDesignChanged, renewedValidUntil, validityFrom } from "../../lib/quotation/meta";
import { checkDiscount, parseQuotationPatch } from "../../lib/quotation/inputs";
import { missingPriceReport } from "../../lib/quotation/problems";
import { rowTotals, serializeQuotation, type QuotationRow } from "../../lib/quotation/view";
import type { MaterialLineInput, PriceInfo, QuotationLine } from "../../lib/quotation/types";

const m = (code: string, quantity: number, slot: string | string[] = "GLASS"): MaterialLineInput => ({ code, name: `${code} name`, slot, unit: "pieces", quantity });
const prices = (o: Record<string, [number, number, boolean?]>): Map<string, PriceInfo> =>
  new Map(Object.entries(o).map(([c, [price, minPrice, allowAbove]]) => [c, { price, minPrice, allowAbove: allowAbove ?? false }]));

// ─── money helpers ──────────────────────────────────────────────────────────────────────────────────────

test("quantityToMilli: 3 dp thousandths, half up; rejects negatives, non-finite and huge values", () => {
  assert.equal(quantityToMilli(12.76), 12760);
  assert.equal(quantityToMilli(3), 3000);
  assert.equal(quantityToMilli(0.0005), 1); // 4th digit 5 rounds up
  assert.equal(quantityToMilli(2.30000000000000004), 2300); // float noise
  for (const bad of [-1, NaN, Infinity, 1e10]) assert.equal(quantityToMilli(bad), null, String(bad));
});

test("lineAmountCents: quantity x unit price, half up to a whole cent, exact on large values", () => {
  assert.equal(lineAmountCents(2000, 280000), 560000); // 2 x 2800.00
  assert.equal(lineAmountCents(1500, 1001), 1502); // 1.5 x 10.01 = 15.015 -> 15.02
  assert.equal(lineAmountCents(333, 100), 33); // 0.333 x 1.00 = 0.333 -> 0.33
  assert.equal(lineAmountCents(335, 100), 34); // 0.335 -> 0.34 (half up)
  assert.equal(lineAmountCents(1, 1), 0);
  assert.equal(lineAmountCents(500, 1), 1); // 0.005 -> 0.01
  // 99,999,999.999 x 99,999,999,999.99 would overflow Number math; BigInt keeps it exact then range-checks
  assert.throws(() => lineAmountCents(1_000_000_000_000, 9_999_999_999_999), RangeError);
});

test("percentOfCents + parsePercentToHundredths", () => {
  assert.equal(percentOfCents(10000, 1850), 1850); // 18.5 % of 100.00
  assert.equal(percentOfCents(1001, 1000), 100); // 10 % of 10.01 = 1.001 -> 1.00
  assert.equal(percentOfCents(1005, 1000), 101); // 1.005 -> 1.01 half up
  assert.equal(parsePercentToHundredths("18.5"), 1850);
  assert.equal(parsePercentToHundredths(100), 10000);
  for (const bad of [100.01, -1, "abc", 1.005, null]) assert.equal(parsePercentToHundredths(bad), null, String(bad));
});

// ─── lines: build / refresh / reset (Unit AC2) ──────────────────────────────────────────────────────────

test("buildLines prices every line at the Inventory max with unitPrice = defaultPrice; amounts half up", () => {
  const r = buildLines([m("A", 2), m("B", 1.5)], prices({ A: [280000, 240000, true], B: [1001, 900] }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.lines[0], {
    code: "A", name: "A name", slot: "GLASS", unit: "pieces", quantity: 2,
    defaultPrice: "2800.00", minPrice: "2400.00", allowAbove: true, unitPrice: "2800.00", amount: "5600.00",
  });
  assert.equal(r.lines[1].amount, "15.02"); // 1.5 x 10.01
  assert.equal(anyLineEdited(r.lines), false);
});

test("buildLines: any unpriced code blocks, listing each once with its name (Q-D6)", () => {
  const r = buildLines([m("A", 1), m("B", 1), m("C", 1), m("B", 2)], prices({ A: [100, 100] }));
  assert.deepEqual(r, { ok: false, missing: [{ code: "B", name: "B name" }, { code: "C", name: "C name" }] });
});

function line(code: string, quantity: number, unit: string, def: string, min: string, allowAbove = false): QuotationLine {
  return { code, name: `${code} name`, slot: "GLASS", unit: "pieces", quantity, defaultPrice: def, minPrice: min, allowAbove, unitPrice: unit, amount: "0.00" };
}

test("refreshLines (same currency): existing codes keep price and range, new codes take current values, dropped codes drop", () => {
  const existing = [line("A", 1, "2500.00", "2800.00", "2400.00"), line("GONE", 1, "10.00", "10.00", "5.00")];
  const list = [m("A", 3), m("NEW", 2)];
  const r = refreshLines(list, existing, prices({ A: [999900, 1], NEW: [5000, 4000] }), false);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.lines.map((l) => l.code), ["A", "NEW"]);
  const a = r.lines[0];
  assert.deepEqual([a.unitPrice, a.defaultPrice, a.minPrice, a.quantity, a.amount], ["2500.00", "2800.00", "2400.00", 3, "7500.00"]); // edit kept, new quantity
  assert.equal(isLineEdited(a), true);
  assert.deepEqual([r.lines[1].unitPrice, r.lines[1].amount], ["50.00", "100.00"]);
});

test("refreshLines: only NEW codes need a price (an existing code without a current price is fine); a new unpriced code blocks", () => {
  const existing = [line("A", 1, "10.00", "10.00", "5.00")];
  assert.equal(refreshLines([m("A", 1)], existing, prices({}), false).ok, true);
  assert.deepEqual(refreshLines([m("A", 1), m("N", 1)], existing, prices({}), false), { ok: false, missing: [{ code: "N", name: "N name" }] });
});

test("refreshLines (currency changed): every line at the current max, edits replaced; any unpriced code blocks", () => {
  const existing = [line("A", 1, "2500.00", "2800.00", "2400.00")];
  const r = refreshLines([m("A", 1)], existing, prices({ A: [30000, 20000, true] }), true);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual([r.lines[0].unitPrice, r.lines[0].defaultPrice, r.lines[0].minPrice, r.lines[0].allowAbove], ["300.00", "300.00", "200.00", true]);
  assert.deepEqual(refreshLines([m("A", 1)], existing, prices({}), true), { ok: false, missing: [{ code: "A", name: "A name" }] });
});

test("repriceLines: stored quantities at current Inventory values, edits discarded; missing blocks", () => {
  const existing = [line("A", 4, "2500.00", "2800.00", "2400.00")];
  const r = repriceLines(existing, prices({ A: [300000, 250000] }));
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual([r.lines[0].unitPrice, r.lines[0].defaultPrice, r.lines[0].amount, r.lines[0].quantity], ["3000.00", "3000.00", "12000.00", 4]);
  assert.deepEqual(repriceLines(existing, prices({})), { ok: false, missing: [{ code: "A", name: "A name" }] });
});

// ─── totals (Unit AC1) ──────────────────────────────────────────────────────────────────────────────────

const lines = (...amounts: string[]) => amounts.map((amount) => ({ amount }));

test("totals chain: lines + transport + other = subtotal; percent discount of the subtotal; tax on the discounted amount", () => {
  const t = computeTotals({ lines: lines("1000.00", "500.50"), transport: 10000, otherCharges: 5050, discountType: "PERCENT", discount: 1000, taxHundredths: 1800 });
  assert.equal(t.linesTotal, 150050);
  assert.equal(t.subtotal, 165100);
  assert.equal(t.discountAmount, 16510); // 10 % of 1651.00
  assert.equal(t.discountedAmount, 148590);
  assert.equal(t.taxAmount, 26746); // 18 % of 1485.90 = 267.462 -> 267.46
  assert.equal(t.grandTotal, 175336);
});

test("totals: fixed discount; capped at the subtotal on recompute (S38-7); zero everything", () => {
  assert.equal(computeTotals({ lines: lines("100.00"), transport: 0, otherCharges: 0, discountType: "FIXED", discount: 3000, taxHundredths: 0 }).grandTotal, 7000);
  const capped = computeTotals({ lines: lines("100.00"), transport: 0, otherCharges: 0, discountType: "FIXED", discount: 99900, taxHundredths: 500 });
  assert.deepEqual([capped.discountAmount, capped.discountedAmount, capped.taxAmount, capped.grandTotal], [10000, 0, 0, 0]);
  assert.equal(discountAmountOf("FIXED", 10000, 10000), 10000);
  assert.equal(computeTotals({ lines: [], transport: 0, otherCharges: 0, discountType: "PERCENT", discount: 0, taxHundredths: 0 }).grandTotal, 0);
});

test("totals are summed from the rounded line amounts, not recomputed from quantities", () => {
  // 3 lines at 0.005 x 1 each round to 0.01 apiece: the sum is 0.03 (a raw sum would be 0.015)
  const built = buildLines([m("A", 0.005), m("B", 0.005), m("C", 0.005)], prices({ A: [100, 100], B: [100, 100], C: [100, 100] }));
  assert.equal(built.ok, true);
  if (built.ok) assert.equal(computeTotals({ lines: built.lines, transport: 0, otherCharges: 0, discountType: "PERCENT", discount: 0, taxHundredths: 0 }).linesTotal, 3);
});

// ─── meta (Unit AC8) ────────────────────────────────────────────────────────────────────────────────────

test("deriveStatus: EXPIRED when validUntil < now, else the stored status; ORDERED stays", () => {
  const now = new Date("2026-12-01T00:00:00Z");
  assert.equal(deriveStatus("DRAFT", new Date("2026-11-30T23:59:59Z"), now), "EXPIRED");
  assert.equal(deriveStatus("DRAFT", new Date("2026-12-01T00:00:00Z"), now), "DRAFT"); // equal is not expired
  assert.equal(deriveStatus("DRAFT", new Date("2026-12-02T00:00:00Z"), now), "DRAFT");
  assert.equal(deriveStatus("ORDERED", new Date("2020-01-01T00:00:00Z"), now), "ORDERED");
});

test("validity: +30 days; renew extends from the later of now and the current expiry", () => {
  const from = new Date("2026-11-01T00:00:00Z");
  assert.equal(validityFrom(from).toISOString(), "2026-12-01T00:00:00.000Z");
  const now = new Date("2026-12-10T00:00:00Z");
  assert.equal(renewedValidUntil(new Date("2026-12-20T00:00:00Z"), now).toISOString(), "2027-01-19T00:00:00.000Z"); // still valid: from expiry
  assert.equal(renewedValidUntil(new Date("2026-12-01T00:00:00Z"), now).toISOString(), "2027-01-09T00:00:00.000Z"); // expired: from now
});

test("formatQuotationNumber: QT-YYYY-NNNN, padded to 4 and growing beyond", () => {
  const d = new Date("2026-11-20T10:00:00Z");
  assert.equal(formatQuotationNumber(7, d), "QT-2026-0007");
  assert.equal(formatQuotationNumber(12345, d), "QT-2026-12345");
});

test("isDesignChanged: no calculation, or computed after the last pricing (S38-6)", () => {
  const priced = new Date("2026-11-20T10:00:00Z");
  assert.equal(isDesignChanged(null, priced), true);
  assert.equal(isDesignChanged(new Date("2026-11-20T10:00:01Z"), priced), true);
  assert.equal(isDesignChanged(new Date("2026-11-20T10:00:00Z"), priced), false);
  assert.equal(isDesignChanged(new Date("2026-11-19T10:00:00Z"), priced), false);
});

// ─── PATCH inputs ───────────────────────────────────────────────────────────────────────────────────────

test("parseQuotationPatch: valid subsets, strict keys and ranges", () => {
  assert.deepEqual(parseQuotationPatch({ transport: "100.5", otherCharges: 20, discount: 10, discountType: "PERCENT", taxPercent: "18" }), {
    ok: true, patch: { transport: 10050, otherCharges: 2000, discount: 1000, discountType: "PERCENT", taxHundredths: 1800 },
  });
  const bad: unknown[] = [null, [], "x", {}, { foo: 1 }, { transport: -1 }, { transport: "1.005" }, { taxPercent: 100.01 }, { discountType: "AMOUNT" }, { discount: "x" }, { otherCharges: 1e21 }];
  for (const b of bad) assert.equal(parseQuotationPatch(b).ok, false, JSON.stringify(b));
});

test("checkDiscount: fixed above the subtotal refused (equal fits, message names the subtotal); percent above 100 refused", () => {
  assert.equal(checkDiscount("FIXED", 10000, 10000), null);
  assert.equal(checkDiscount("FIXED", 10001, 10000), "The discount cannot exceed the subtotal (100.00)");
  assert.equal(checkDiscount("PERCENT", 10000, 0), null);
  assert.match(checkDiscount("PERCENT", 10001, 0) ?? "", /100/);
});

// ─── problem report + view ──────────────────────────────────────────────────────────────────────────────

test("missingPriceReport: MISSING_PRICE problems in the INVENTORY scope with code, item name and currency", () => {
  const rep = missingPriceReport([{ code: "A", name: "Alpha" }, { code: "B", name: "Beta" }], "AED");
  assert.equal(rep.ok, false);
  assert.equal(rep.problemCount, 2);
  assert.deepEqual(rep.problems.map((p) => [p.kind, p.scope, p.code, p.itemName, p.currency]), [
    ["MISSING_PRICE", "INVENTORY", "A", "Alpha", "AED"],
    ["MISSING_PRICE", "INVENTORY", "B", "Beta", "AED"],
  ]);
  assert.equal(rep.problems[0].message, "Alpha (A) has no AED price.");
});

function row(over: Partial<QuotationRow> = {}): QuotationRow {
  return {
    id: "q1", projectId: "p1", externalCompanyId: null, quotationNumber: 3, status: "DRAFT", currency: "INR",
    lines: [line("A", 2, "2500.00", "2800.00", "2400.00")].map((l) => ({ ...l, amount: "5000.00" })),
    transport: "0", otherCharges: "0", discount: "0", discountType: "PERCENT", discountAppliedAt: null, taxPercent: "0",
    subtotal: "5000", grandTotal: "5000",
    pricedAt: new Date("2026-11-20T10:00:00Z"), validUntil: new Date("2026-12-20T10:00:00Z"),
    createdAt: new Date("2026-11-20T10:00:00Z"), updatedAt: new Date("2026-11-20T10:00:00Z"),
    ...over,
  };
}

test("serializeQuotation: number, derived status and flags, 2 dp strings, totals recomputed from lines", () => {
  const v = serializeQuotation(row({ currency: "INR" }), { projectCurrency: "AED", calcComputedAt: new Date("2026-11-21T00:00:00Z"), now: new Date("2027-01-01T00:00:00Z") });
  assert.equal(v.number, "QT-2026-0003");
  assert.equal(v.status, "EXPIRED");
  assert.equal(v.currencyDiffers, true);
  assert.equal(v.designChanged, true);
  assert.equal(v.anyLineEdited, true);
  assert.equal(v.transport, "0.00");
  assert.equal(v.totals.grandTotal, "5000.00");
});

test("rowTotals caps a stored fixed discount above a lowered subtotal and keeps the stored input (S38-7)", () => {
  const r = row({ discountType: "FIXED", discount: "9999.00" });
  const t = rowTotals(r);
  assert.deepEqual([t.discountAmount, t.grandTotal], [500000, 0]);
  assert.equal(serializeQuotation(r, { projectCurrency: "INR", calcComputedAt: null, now: new Date("2026-11-21T00:00:00Z") }).discount, "9999.00");
});
