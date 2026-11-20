import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLinePrice, editLinePrice, formatBound, lineRange, parseLinePatch, resetLinePrice } from "../../lib/quotation/line-edit";
import { computeTotals } from "../../lib/quotation/totals";
import { linePriceProblem, type EditableLine } from "../../lib/quotation/present";
import { serializeQuotation, type QuotationRow } from "../../lib/quotation/view";
import type { QuotationLine } from "../../lib/quotation/types";

const L = (code: string, quantity: number, over: Partial<QuotationLine> = {}): QuotationLine => ({
  code, name: `${code} name`, slot: "GLASS", unit: "pieces", perUnitQuantity: 1, quantity,
  defaultPrice: "2650.00", minPrice: "2400.00", allowAbove: false, unitPrice: "2650.00", amount: String((quantity * 2650).toFixed(2)),
  ...over,
});

test("parseLinePatch: unitPrice or reset:true, exactly one, strict body", () => {
  assert.deepEqual(parseLinePatch({ code: "A", unitPrice: "2,5" }).ok, false);
  const ok = parseLinePatch({ code: "A", unitPrice: "2500.5" });
  assert.deepEqual(ok, { ok: true, patch: { code: "A", unitPriceCents: 250050 } });
  assert.deepEqual(parseLinePatch({ code: "A", unitPrice: 2500 }), { ok: true, patch: { code: "A", unitPriceCents: 250000 } });
  assert.deepEqual(parseLinePatch({ code: "A", reset: true }), { ok: true, patch: { code: "A", reset: true } });
  for (const bad of [null, [], "x", {}, { code: "" }, { code: "A" }, { code: "A", unitPrice: "1", reset: true }, { code: "A", reset: false },
    { code: "A", unitPrice: "-1" }, { code: "A", unitPrice: "1.234" }, { code: "A", unitPrice: "abc" }, { code: 5, unitPrice: "1" }, { code: "A", unitPrice: "1", extra: 1 }]) {
    assert.equal(parseLinePatch(bad).ok, false, JSON.stringify(bad));
  }
});

test("range text: no trailing .00, thousands separators, 'no upper limit' has no max", () => {
  assert.equal(formatBound("2400.00"), "2,400");
  assert.equal(formatBound("2400.50"), "2,400.50");
  assert.equal(formatBound("0.05"), "0.05");
  assert.deepEqual(lineRange(L("A", 1)), { min: "2,400", max: "2,650" });
  assert.deepEqual(lineRange(L("A", 1, { allowAbove: true })), { min: "2,400", max: null });
});

test("checkLinePrice: min and default are inclusive; allowAbove removes the cap; the message names the range", () => {
  const line = L("A", 1);
  assert.equal(checkLinePrice(line, 240000), null);
  assert.equal(checkLinePrice(line, 265000), null);
  assert.equal(checkLinePrice(line, 239999), "Enter a price from 2,400 to 2,650.");
  assert.equal(checkLinePrice(line, 265001), "Enter a price from 2,400 to 2,650.");
  const up = L("A", 1, { allowAbove: true });
  assert.equal(checkLinePrice(up, 99999999), null);
  assert.equal(checkLinePrice(up, 100), "Enter a price of 2,400 or more.");
});

test("editLinePrice: sets one line and its amount, leaves the others; reads the STORED copy (an Inventory change cannot matter)", () => {
  const lines = [L("A", 2), L("B", 3)];
  const r = editLinePrice(lines, "A", 250000);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual([r.lines[0].unitPrice, r.lines[0].amount, r.lines[0].defaultPrice], ["2500.00", "5000.00", "2650.00"]);
  assert.equal(r.lines[1], lines[1]);
  // The stored copy decides: min 2400 stays the floor even if the live price changed since (nothing here reads Inventory).
  assert.equal(editLinePrice(lines, "A", 230000).ok, false);
  // totals follow the new amounts
  assert.equal(computeTotals({ lines: r.lines, transport: 0, otherCharges: 0, discountType: "PERCENT", discount: 0, taxHundredths: 0 }).grandTotal, 500000 + 795000);
});

test("editLinePrice: amount rounds half up (1.5 x 10.01)", () => {
  const line = L("A", 1.5, { defaultPrice: "20.00", minPrice: "1.00", unitPrice: "20.00", amount: "30.00" });
  const r = editLinePrice([line], "A", 1001);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.lines[0].amount, "15.02");
});

test("editLinePrice / resetLinePrice: unknown code is noLine; reset restores the stored defaultPrice", () => {
  const lines = [L("A", 2, { unitPrice: "2500.00", amount: "5000.00" })];
  assert.deepEqual(editLinePrice(lines, "ZZ", 250000), { ok: false, reason: "noLine" });
  assert.deepEqual(resetLinePrice(lines, "ZZ"), { ok: false, reason: "noLine" });
  const r = resetLinePrice(lines, "A");
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual([r.lines[0].unitPrice, r.lines[0].amount], ["2650.00", "5300.00"]);
  const again = resetLinePrice(r.ok ? r.lines : [], "A"); // idempotent on an unedited line
  assert.ok(again.ok);
});

test("linePriceProblem: invalid text, out of range, fits; separators are accepted", () => {
  const line = L("A", 1) as EditableLine;
  assert.equal(linePriceProblem(line, "abc").problem, "invalid");
  assert.equal(linePriceProblem(line, "2,500.00").problem, null);
  assert.equal(linePriceProblem(line, "2,500.00").cents, 250000);
  assert.equal(linePriceProblem(line, "2,399").problem, "range");
  assert.equal(linePriceProblem(line, "2,651").problem, "range");
});

test("serializeQuotation carries the quoting user's name (M-1), null when unknown", () => {
  const row: QuotationRow = {
    id: "q", projectId: "p", externalCompanyId: null, createdByUserId: "u", quotationNumber: 1, status: "DRAFT", currency: "INR",
    lines: [L("A", 1)], transport: "0", otherCharges: "0", discount: "0", discountType: "PERCENT", discountAppliedAt: null, taxPercent: "0",
    subtotal: "0", grandTotal: "0", pricedAt: new Date(0), quantitiesAt: new Date(0), validUntil: new Date(9e12), createdAt: new Date(0), updatedAt: new Date(0),
  };
  const ctx = { projectCurrency: "INR", calcComputedAt: null, now: new Date(1e12), showRange: true };
  assert.equal(serializeQuotation(row, { ...ctx, createdByName: "Ritika Menon" }).createdByName, "Ritika Menon");
  assert.equal(serializeQuotation(row, ctx).createdByName, null);
});
