/**
 * Quick Estimate PDF (Stage 33, S33-11), modelled on lib/summary/pdf.ts: jsPDF and jspdf-autotable are
 * imported dynamically inside the generator so their bundle is only fetched on Download. Standalone
 * `autoTable(doc, ...)`, A4 portrait, pt units.
 *
 * No i18n and no maths here: the caller passes already translated strings and a `Sheet` built by
 * `buildSheet` (the same one the export preview renders). Helvetica is WinAnsi: `²` and `—` are in that
 * set; negative amounts arrive with an ASCII hyphen from `buildSheet`. Stage 37 (QP-1 to QP-9): an inquiry-sourced
 * PDF gets a project details band; every drawn string goes through `stripLongDashes` (no U+2013/U+2014).
 * Not supported: Arabic, Devanagari and other non-Latin scripts (and emoji) in party names print as boxes
 * (OPEN-1, decided 2026-11-20: documented limit, no embedded font or transliteration).
 */
import type { jsPDF } from "jspdf";
import { stripLongDashes, type BandColumn } from "./details-band";
import type { Sheet } from "./sheet";

const MARGIN = 44;
const GREEN: [number, number, number] = [78, 127, 88];
const GREEN_SOFT: [number, number, number] = [236, 240, 237];

export interface QuickEstimatePdfInput {
  orgName: string;
  /** "PROJECT ESTIMATE" */
  title: string;
  /** "Prepared for" */
  preparedForLabel: string;
  /** The name typed by the user (standalone) or the End client name (inquiry); empty draws a blank 50 mm rule. */
  preparedFor: string;
  /** QP-9: "inquiry" draws the details band, "standalone" never does (the two must not mix). */
  source: "standalone" | "inquiry";
  /** Inquiry source only: the details band columns from `buildDetailsBand` (empty = no band). */
  band: BandColumn[];
  /** Right-aligned meta lines from `buildMetaLines`: inquiry number (inquiry only) then the date. */
  metaLines: string[];
  head: { item: string; qty: string; rate: string; amount: string };
  sheet: Sheet;
  /** "Indicative estimate only. Not a quotation. Final pricing is subject to a formal quotation." */
  disclaimer: string;
  filename: string;
}

/** Builds the document without saving it (the unit tests read it back). */
export async function renderQuickEstimatePdf(raw: QuickEstimatePdfInput): Promise<jsPDF> {
  const input: QuickEstimatePdfInput = {
    ...raw,
    orgName: stripLongDashes(raw.orgName),
    title: stripLongDashes(raw.title),
    preparedForLabel: stripLongDashes(raw.preparedForLabel),
    preparedFor: stripLongDashes(raw.preparedFor),
    metaLines: raw.metaLines.map(stripLongDashes),
    head: {
      item: stripLongDashes(raw.head.item),
      qty: stripLongDashes(raw.head.qty),
      rate: stripLongDashes(raw.head.rate),
      amount: stripLongDashes(raw.head.amount),
    },
    sheet: {
      rows: raw.sheet.rows.map((r) => ({
        ...r,
        name: stripLongDashes(r.name),
        variant: stripLongDashes(r.variant),
        ...(r.description ? { description: stripLongDashes(r.description) } : {}),
      })),
      totals: raw.sheet.totals.map((t) => ({ ...t, label: stripLongDashes(t.label), value: stripLongDashes(t.value) })),
    },
    disclaimer: stripLongDashes(raw.disclaimer),
  };
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const right = pageWidth - MARGIN;

  // Header: org + document title on the left, meta lines on the right, green rule under both.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(27, 40, 30);
  doc.text(input.orgName, MARGIN, 58);
  doc.setFontSize(9);
  doc.setTextColor(...GREEN);
  doc.text(input.title.split("").join(" "), MARGIN, 84); // QP-6: more air under the org name

  // "Prepared for: <name>", or the label followed by a blank 50 mm rule (always present, D-16).
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  const forPrefix = `${input.preparedForLabel}: `;
  const forY = 102;
  doc.text(forPrefix, MARGIN, forY);
  const forX = MARGIN + doc.getTextWidth(forPrefix);
  if (input.preparedFor) {
    doc.text(input.preparedFor, forX, forY);
  } else {
    doc.setDrawColor(150, 150, 150);
    doc.setLineWidth(0.5);
    doc.line(forX, forY + 1.5, forX + (50 * 72) / 25.4, forY + 1.5);
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  let metaY = 46;
  input.metaLines.forEach((line, i) => {
    if (i === 0) doc.setFont("helvetica", "bold");
    else doc.setFont("helvetica", "normal");
    doc.text(line, right, metaY, { align: "right" });
    metaY += 12;
  });
  const ruleY = Math.max(120, metaY + 4);
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(1.5);
  doc.line(MARGIN, ruleY, right, ruleY);

  // Project details band (QP-1/QP-2): inquiry source only, two key/value columns, empty fields already dropped.
  let tableTop = ruleY + 14;
  const band = input.source === "inquiry" ? input.band : [];
  if (band.length > 0) {
    const gap = 16;
    const colW = (right - MARGIN - gap) / 2;
    const keyW = 75;
    const valW = colW - keyW - 6;
    let bandEnd = ruleY + 12;
    band.forEach((col, ci) => {
      const x = MARGIN + ci * (colW + gap);
      let y = ruleY + 22;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(150, 150, 150);
      doc.text(stripLongDashes(col.heading).toUpperCase(), x, y);
      doc.setDrawColor(236, 236, 236);
      doc.setLineWidth(0.5);
      doc.line(x, y + 4, x + colW, y + 4);
      y += 16;
      for (const row of col.rows) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(150, 150, 150);
        doc.text(stripLongDashes(row.key), x, y);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(68, 68, 68);
        const lines = doc.splitTextToSize(row.value, valW) as string[];
        doc.text(lines, x + keyW + 6, y);
        y += lines.length * 11 + 3;
      }
      bandEnd = Math.max(bandEnd, y);
    });
    const sepY = bandEnd + 4;
    doc.setDrawColor(236, 236, 236);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, sepY, right, sepY);
    tableTop = sepY + 12;
  }

  // Line table.
  autoTable(doc, {
    startY: tableTop,
    margin: { left: MARGIN, right: MARGIN },
    head: [["#", input.head.item, input.head.qty, input.head.rate, input.head.amount]],
    body: input.sheet.rows.map((r) => [
      String(r.n),
      [r.name, r.variant, r.description].filter((p): p is string => !!p).join("\n"),
      r.qty,
      r.rate,
      r.amount,
    ]),
    theme: "plain",
    styles: { fontSize: 9, cellPadding: { top: 6, bottom: 6, left: 4, right: 4 }, textColor: [34, 34, 34], lineColor: [236, 236, 236], lineWidth: 0 },
    headStyles: { fontSize: 7.5, fontStyle: "bold", textColor: [136, 136, 136] },
    columnStyles: {
      0: { cellWidth: 22, textColor: [153, 153, 153] },
      2: { halign: "right", cellWidth: 74 },
      3: { halign: "right", cellWidth: 82 },
      4: { halign: "right", cellWidth: 86 },
    },
    didParseCell: (data) => {
      if (data.section === "head" && data.column.index >= 2) data.cell.styles.halign = "right";
    },
    didDrawCell: (data) => {
      // Hairline under every row (head included).
      doc.setDrawColor(data.section === "head" ? 204 : 236, data.section === "head" ? 204 : 236, data.section === "head" ? 204 : 236);
      doc.setLineWidth(0.5);
      doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height);
    },
  });

  // Totals block, right-aligned.
  const tableEnd = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const totalsWidth = 230;
  const lastIndex = input.sheet.totals.length - 1;
  autoTable(doc, {
    startY: tableEnd + 14,
    margin: { left: pageWidth - MARGIN - totalsWidth, right: MARGIN },
    body: input.sheet.totals.map((t) => [t.label, t.value]),
    theme: "plain",
    styles: { fontSize: 9.5, cellPadding: { top: 3, bottom: 3, left: 6, right: 6 }, textColor: [85, 85, 85] },
    columnStyles: { 1: { halign: "right" } },
    didParseCell: (data) => {
      if (data.row.index === lastIndex) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fontSize = 12;
        data.cell.styles.textColor = [17, 17, 17];
        data.cell.styles.fillColor = GREEN_SOFT;
      }
    },
  });

  // Disclaimer at the foot of the last page.
  const totalsEnd = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  if (totalsEnd > pageHeight - 90) doc.addPage();
  const footY = pageHeight - 40;
  doc.setDrawColor(238, 238, 238);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, footY - 14, right, footY - 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(136, 136, 136);
  doc.text(input.disclaimer, MARGIN, footY);

  return doc;
}

export async function generateQuickEstimatePdf(input: QuickEstimatePdfInput): Promise<void> {
  const doc = await renderQuickEstimatePdf(input);
  doc.save(input.filename);
}
