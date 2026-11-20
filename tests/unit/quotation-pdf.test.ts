/**
 * Stage 38 Batch 4 (S38-D5, Q-D33, Q-D34, Q-D25): the Quotation PDF text. The model is pure (`pdf-model.ts`); the
 * generator is rendered for real with jsPDF (uncompressed, so the page text is readable) and read back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuotationPdf, type QuotationPdfContext, type QuotationPdfLabels } from "../../lib/quotation/pdf-model";
import { renderQuotationPdf } from "../../lib/quotation/pdf";
import type { QuotationDto } from "../../lib/quotation/present";

const LABELS: QuotationPdfLabels = {
  title: "QUOTATION",
  preparedFor: "Prepared for",
  issued: (d) => `Issued ${d}`,
  validUntil: (d) => `Valid until ${d}`,
  bandProject: "Project Details",
  bandParties: "Parties",
  quotationNo: "Quotation No.",
  projectName: "Project Name",
  projectNo: "Project No.",
  location: "Location",
  preparedBy: "Prepared by",
  company: "Company",
  endClient: "End Client",
  item: "Item / Code",
  qty: "Qty",
  rate: (c) => `Rate (${c})`,
  amount: "Amount",
  packOf: (s, u) => `pack of ${s} ${u}`,
  packs: (n) => `${n} ${n === "1" ? "pack" : "packs"}`,
  linesTotal: "Lines total",
  transport: "Transport",
  otherCharges: "Other charges",
  subtotal: "Subtotal",
  discount: (p) => (p ? `Discount ${p}%` : "Discount"),
  tax: (p) => `Tax ${p}%`,
  total: "Total",
  footerPage: (p, t) => `Page ${p} of ${t}`,
};

const CTX: QuotationPdfContext = {
  orgName: "E2E Test Org",
  projectName: "Level 7 office fit-out",
  projectNumber: 42,
  projectLocation: "Whitefield, Bengaluru",
  preparedBy: "ritika",
  company: "Arcline Interiors",
  endClient: "Kavya Software Services",
  snapshot: { takenAt: "x", componentTypes: [{ id: "1", code: "GLASS", name: "Partition", active: true, fieldsSchema: [], fieldOptionsConfig: {} }] },
};

// Staff payload: carries the stored range, which must never reach the PDF.
function line(i: number, over: Record<string, unknown> = {}) {
  return {
    code: `GL-${i}`, name: `Glass item ${i}`, slot: "GLASS", unit: "m²", perUnitQuantity: 1, quantity: 2.5,
    defaultPrice: "2650.00", minPrice: "2400.00", allowAbove: false, unitPrice: "2650.00", amount: "6625.00", ...over,
  };
}

function quotation(lines: ReturnType<typeof line>[], over: Partial<QuotationDto> = {}): QuotationDto {
  return {
    id: "q1", projectId: "p1", quotationNumber: 187, number: "QT-2026-0187", status: "DRAFT", currency: "INR", projectCurrency: "INR",
    currencyDiffers: false, lines, transport: "18000.00", otherCharges: "4500.00", discountType: "PERCENT", discount: "5.00", taxPercent: "18.00",
    totals: { linesTotal: "6625.00", subtotal: "29125.00", discountAmount: "1456.25", discountedAmount: "27668.75", taxAmount: "4980.38", grandTotal: "32649.13" },
    anyLineEdited: false, designChanged: false, pricedAt: "2026-11-20T10:00:00.000Z", quantitiesAt: "2026-11-20T10:00:00.000Z",
    validUntil: "2026-12-20T10:00:00.000Z", discountAppliedAt: null, createdAt: "2026-11-20T10:00:00.000Z",
    ...over,
  } as QuotationDto;
}

test("model: the header, band, Rate header, rows, totals in page order and the footer numbers", () => {
  const q = quotation([line(1), line(2, { code: "PS-1", name: "Profile stop", slot: "DOOR", unit: "metres", perUnitQuantity: 3, quantity: 11, unitPrice: "870.00", amount: "9570.00" })]);
  const m = buildQuotationPdf(q, CTX, LABELS);
  assert.equal(m.metaLines[0], "QT-2026-0187");
  assert.deepEqual(m.metaLines.slice(1), ["Issued 20 Nov 2026", "Valid until 20 Dec 2026"]);
  assert.equal(m.head.rate, "Rate (INR)");
  assert.deepEqual(m.band.map((c) => c.heading), ["Project Details", "Parties"]);
  assert.deepEqual(m.band[0].rows.map((r) => r.key), ["Quotation No.", "Project Name", "Project No.", "Location", "Prepared by"]);
  assert.deepEqual(m.sections.map((s) => s.title), ["Partition", "DOOR"]); // snapshot title, unknown slot titled with its code
  assert.deepEqual(m.sections.flatMap((s) => s.rows.map((r) => r.n)), [1, 2]);
  assert.equal(m.sections[1].rows[0].qty, "11 packs");
  assert.equal(m.sections[1].rows[0].codeLine, "PS-1, pack of 3 m");
  assert.equal(m.sections[0].rows[0].rate, "2,650.00");
  assert.deepEqual(m.totals.map((t) => t.label), ["Lines total", "Transport", "Other charges", "Subtotal", "Discount 5%", "Tax 18%", "Total"]);
  assert.deepEqual(m.totals.map((t) => t.value), ["6,625.00", "+ 18,000.00", "+ 4,500.00", "29,125.00", "- 1,456.25", "+ 4,980.38", "INR 32,649.13"]);
  assert.equal(m.footerNumber, "QT-2026-0187");
  assert.equal(m.footerPage(2, 3), "Page 2 of 3");
});

test("model: empty details are dropped, a fixed discount has no percent, no min or max anywhere (Q-D34)", () => {
  const q = quotation([line(1, { minPrice: "2400.00", defaultPrice: "2650.00", allowAbove: true })], { discountType: "FIXED", discount: "25000.00" });
  const m = buildQuotationPdf(q, { ...CTX, projectLocation: null, preparedBy: "  ", endClient: null }, LABELS);
  assert.deepEqual(m.band[0].rows.map((r) => r.key), ["Quotation No.", "Project Name", "Project No."]);
  assert.deepEqual(m.band[1].rows.map((r) => r.key), ["Company"]);
  assert.equal(m.totals[4].label, "Discount");
  const text = JSON.stringify(m);
  for (const s of ["2400", "2,400", "minPrice", "defaultPrice", "allowAbove", "No upper limit"]) assert.ok(!text.includes(s), s);
  assert.ok(!Object.keys(m.sections[0].rows[0]).some((k) => /min|max|default|edit/i.test(k)));
});

test("model: no U+2013 / U+2014 survives, even from user-typed names (Q-D25)", () => {
  const q = quotation([line(1, { name: "Glass – clear — 12 mm" })]);
  const m = buildQuotationPdf(q, { ...CTX, projectName: "Fit–out", company: "A — B" }, LABELS);
  assert.ok(!/[–—]/.test(JSON.stringify(m)));
});

async function render(q: QuotationDto) {
  const doc = await renderQuotationPdf(buildQuotationPdf(q, CTX, LABELS));
  return { text: doc.output(), pages: doc.getNumberOfPages() };
}

test("pdf: carries the number, the Rate header, every code, the grand total, and no range or dash (AC5)", async () => {
  const lines = [line(1), line(2), line(3, { slot: "DOOR" })];
  const { text } = await render(quotation(lines));
  for (const s of ["QT-2026-0187", "Rate \\(INR\\)", "GL-1", "GL-2", "GL-3", "INR 32,649.13", "PROJECT DETAILS", "PARTIES"]) assert.ok(text.includes(s), s);
  assert.ok(!text.includes("2,400") && !text.includes("2400.00"), "no minimum");
  assert.ok(!/[–—]/.test(text));
});

test("pdf: every page footer reads only the number and 'Page X of Y'; no terms line (Q-D33)", async () => {
  const lines = Array.from({ length: 70 }, (_, i) => line(i + 1, { code: `GL-${i + 1}`, name: `Item ${i + 1}` }));
  const { text, pages } = await render(quotation(lines));
  assert.ok(pages >= 2, "a long table splits across pages");
  const footers = [...text.matchAll(/\(Page (\d+) of (\d+)\) Tj/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(footers, Array.from({ length: pages }, (_, i) => [i + 1, pages]));
  assert.equal([...text.matchAll(/\(QT-2026-0187\) Tj/g)].length >= pages, true);
  assert.ok(!/terms|valid for|subject to/i.test(text.replace(/Valid until/g, "")));
});
