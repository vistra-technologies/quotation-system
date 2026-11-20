/**
 * Stage 37 Batch 4 (QP-1 to QP-9): the Quick Estimate PDF details band, the Rate header, the meta block and the
 * "no long dash" rule. The band logic is pure (`details-band.ts`); the generator is rendered for real with jsPDF
 * (uncompressed, so the page text is readable) and read back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDetailsBand,
  buildMetaLines,
  formatBandDate,
  formatInquiryNumber,
  stripLongDashes,
  type DetailsLabels,
  type InquiryDetails,
} from "../../lib/quick-estimate/details-band";
import { renderQuickEstimatePdf, type QuickEstimatePdfInput } from "../../lib/quick-estimate/pdf";

const LABELS: DetailsLabels = {
  projectHeading: "Project Details",
  partiesHeading: "Parties",
  inquiryNo: "Inquiry No.",
  projectName: "Project Name",
  location: "Location",
  destination: "Destination",
  deadline: "Deadline",
  endClient: "End Client",
  gstNumber: "GST Number",
  mainContractor: "Main Contractor",
  interiorContractor: "Int. Contractor",
  mainConsultant: "Main Consultant",
  interiorConsultant: "Int. Consultant",
};

const FULL: InquiryDetails = {
  inquiryNumber: "INQ-42",
  projectName: "Level 7 Fit-out",
  location: "Sheikh Zayed Road",
  destination: "UAE",
  deadline: "2027-01-31",
  endClientName: "Mashreq Bank",
  gstNumber: "29ABCDE1234F1Z5",
  mainContractor: "Arabian Contracting",
  interiorContractor: "Fit-Out LLC",
  mainConsultant: "GAJ Architects",
  interiorConsultant: "G&T Interiors",
};

const keys = (d: InquiryDetails) => buildDetailsBand(d, LABELS).flatMap((c) => c.rows.map((r) => r.key));

// ── band (AC1) ───────────────────────────────────────────────────────────────────────────────────────
test("band: every non-empty field prints, in two columns, with GST under the end client", () => {
  const cols = buildDetailsBand(FULL, LABELS);
  assert.deepEqual(cols.map((c) => c.heading), ["Project Details", "Parties"]);
  assert.deepEqual(cols[0].rows.map((r) => r.key), ["Inquiry No.", "Project Name", "Location", "Destination", "Deadline"]);
  assert.deepEqual(cols[1].rows.map((r) => r.key), ["End Client", "GST Number", "Main Contractor", "Int. Contractor", "Main Consultant", "Int. Consultant"]);
  assert.equal(cols[0].rows[4].value, "31 Jan 2027");
});

test("band: empty and blank fields are omitted, an empty column is dropped, nothing left means no band", () => {
  assert.deepEqual(keys({ projectName: "P", location: "  ", gstNumber: "" }), ["Project Name"]);
  const onlyParties = buildDetailsBand({ endClientName: "Client" }, LABELS);
  assert.deepEqual(onlyParties.map((c) => c.heading), ["Parties"]);
  assert.deepEqual(buildDetailsBand({}, LABELS), []);
});

test("band: no budget, end client phone, email or address rows exist (QP-4, QP-8)", () => {
  const all = buildDetailsBand(FULL, LABELS).flatMap((c) => c.rows.map((r) => `${r.key} ${r.value}`)).join("|").toLowerCase();
  for (const word of ["budget", "phone", "email", "address", "prepared by"]) assert.ok(!all.includes(word), word);
  const inputKeys = Object.keys(FULL).join(",").toLowerCase();
  assert.ok(!/budget|phone|email|address/.test(inputKeys));
});

test("band: long dashes in user data become ASCII hyphens", () => {
  const cols = buildDetailsBand({ projectName: "A–B—C" }, LABELS);
  assert.equal(cols[0].rows[0].value, "A-B-C");
  assert.equal(stripLongDashes("x—y"), "x-y");
});

test("formatInquiryNumber and formatBandDate use the app display forms", () => {
  assert.equal(formatInquiryNumber(7, 99), "INQ-7");
  assert.equal(formatInquiryNumber(null, 99), "#99");
  assert.equal(formatBandDate("2027-01-31T00:00:00.000Z"), "31 Jan 2027");
  assert.equal(formatBandDate(""), "");
  assert.equal(formatBandDate("not a date"), "not a date");
});

// ── meta (AC2) ───────────────────────────────────────────────────────────────────────────────────────
test("meta: inquiry number first on inquiry PDFs only, currency never", () => {
  assert.deepEqual(buildMetaLines("19 Nov 2026", "INQ-42"), ["INQ-42", "19 Nov 2026"]);
  assert.deepEqual(buildMetaLines("19 Nov 2026", undefined), ["19 Nov 2026"]);
});

// ── generated document (AC1 + AC2) ───────────────────────────────────────────────────────────────────
function input(over: Partial<QuickEstimatePdfInput>): QuickEstimatePdfInput {
  return {
    orgName: "Cloisons — Glazing",
    title: "PROJECT ESTIMATE",
    preparedForLabel: "Prepared for",
    preparedFor: "",
    source: "standalone",
    band: [],
    metaLines: ["19 Nov 2026"],
    head: { item: "Item / Variant", qty: "Qty", rate: "Rate (AED)", amount: "Amount" },
    sheet: {
      rows: [{ n: 1, name: "Panel – clear", variant: "12 mm", qty: "10 m²", rate: "185.00", amount: "1,850.00" }],
      totals: [
        { label: "Subtotal", value: "1,850.00" },
        { label: "Total", value: "AED 1,850.00", grand: true },
      ],
    },
    disclaimer: "Indicative estimate only.",
    filename: "x.pdf",
    ...over,
  };
}

async function textOf(i: QuickEstimatePdfInput): Promise<{ text: string; pages: number }> {
  const doc = await renderQuickEstimatePdf(i);
  return { text: doc.output(), pages: doc.getNumberOfPages() };
}

test("pdf: standalone never draws the band, even if a band is passed (QP-2/QP-9)", async () => {
  const { text } = await textOf(input({ source: "standalone", band: buildDetailsBand(FULL, LABELS), preparedFor: "Typed Name" }));
  assert.ok(!text.includes("Project Details") && !text.includes("PROJECT DETAILS"));
  assert.ok(!text.includes("Mashreq Bank") && !text.includes("29ABCDE1234F1Z5"));
  assert.ok(text.includes("Typed Name"));
});

test("pdf: inquiry source draws the band, GST, the inquiry number and the Prepared for name", async () => {
  const { text } = await textOf(
    input({ source: "inquiry", band: buildDetailsBand(FULL, LABELS), preparedFor: "Mashreq Bank", metaLines: buildMetaLines("19 Nov 2026", "INQ-42") }),
  );
  for (const s of ["PROJECT DETAILS", "PARTIES", "29ABCDE1234F1Z5", "INQ-42", "Level 7 Fit-out", "Mashreq Bank", "31 Jan 2027"]) {
    assert.ok(text.includes(s), s);
  }
  assert.ok(!/budget|phone|email/i.test(text));
});

test("pdf: Rate header carries the currency, Amount does not, grand total keeps its prefix", async () => {
  const { text } = await textOf(input({}));
  assert.ok(text.includes("Rate \\(AED\\)"));
  assert.ok(text.includes("Amount") && !text.includes("Amount \\("));
  assert.ok(text.includes("AED 1,850.00"));
  assert.ok(!text.includes("INQ-"));
});

test("pdf: no U+2013 or U+2014 in any generated text; the m2 glyph is the WinAnsi superscript two", async () => {
  const { text } = await textOf(input({ preparedFor: "A—B" }));
  assert.ok(!/[–—]/.test(text));
  assert.ok(text.includes("10 m\\262") || text.includes("10 m²"));
});

test("pdf: a long table splits across pages and the totals and disclaimer stay on the last page", async () => {
  const rows = Array.from({ length: 70 }, (_, i) => ({ n: i + 1, name: `Item ${i + 1}`, variant: "v", qty: "1 pcs", rate: "1.00", amount: "1.00" }));
  const doc = await renderQuickEstimatePdf(input({ sheet: { rows, totals: [{ label: "Subtotal", value: "70.00" }, { label: "Total", value: "AED 70.00", grand: true }] } }));
  const pages = doc.getNumberOfPages();
  assert.ok(pages >= 2, "split");
  const all = doc.output();
  const lastStart = all.lastIndexOf("/Type /Page\n");
  const lastPage = lastStart >= 0 ? all.slice(lastStart) : all;
  assert.ok(lastPage.includes("AED 70.00") || all.indexOf("AED 70.00") > all.indexOf("Item 70"));
  assert.ok(all.indexOf("Indicative estimate only.") > all.indexOf("AED 70.00"));
});
