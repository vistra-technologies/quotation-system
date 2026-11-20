/**
 * Quotation PDF (Stage 38 Batch 4, S38-D5), the Quick Estimate header style (lib/quick-estimate/pdf.ts): jsPDF and
 * jspdf-autotable are imported dynamically inside the generator so the bundle is only fetched on Export. A4
 * portrait, pt units. No i18n and no maths here: `buildQuotationPdf` (pdf-model.ts) supplies every string.
 * Footer (Q-D33): on every page only the quotation number and "Page X of Y", no terms line.
 * Latin script only: Arabic, Devanagari and similar print as boxes (OPEN-1, same documented limit as Quick Estimate).
 */
import type { jsPDF } from "jspdf";
import type { QuotationPdfInput } from "./pdf-model";

const MARGIN = 44;
const GREEN: [number, number, number] = [78, 127, 88];
const GREEN_SOFT: [number, number, number] = [236, 240, 237];

/** Builds the document without saving it (the unit tests read it back). */
export async function renderQuotationPdf(input: QuotationPdfInput): Promise<jsPDF> {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const right = pageWidth - MARGIN;

  // Header: org + title on the left, meta lines on the right, a green rule under both.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(27, 40, 30);
  doc.text(input.orgName, MARGIN, 58);
  doc.setFontSize(9);
  doc.setTextColor(...GREEN);
  doc.text(input.title.split("").join(" "), MARGIN, 84);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  const forPrefix = `${input.preparedForLabel}: `;
  doc.text(forPrefix, MARGIN, 102);
  if (input.preparedFor) doc.text(input.preparedFor, MARGIN + doc.getTextWidth(forPrefix), 102);

  let metaY = 46;
  input.metaLines.forEach((line, i) => {
    doc.setFont("helvetica", i === 0 ? "bold" : "normal");
    doc.text(line, right, metaY, { align: "right" });
    metaY += 12;
  });
  const ruleY = Math.max(120, metaY + 4);
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(1.5);
  doc.line(MARGIN, ruleY, right, ruleY);

  // Details band: Project Details and Parties, empty rows already dropped.
  let tableTop = ruleY + 14;
  if (input.band.length > 0) {
    const gap = 16;
    const colW = (right - MARGIN - gap) / 2;
    const keyW = 75;
    const valW = colW - keyW - 6;
    let bandEnd = ruleY + 12;
    input.band.forEach((col, ci) => {
      const x = MARGIN + ci * (colW + gap);
      let y = ruleY + 22;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(150, 150, 150);
      doc.text(col.heading.toUpperCase(), x, y);
      doc.setDrawColor(236, 236, 236);
      doc.setLineWidth(0.5);
      doc.line(x, y + 4, x + colW, y + 4);
      y += 16;
      for (const row of col.rows) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(150, 150, 150);
        doc.text(row.key, x, y);
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

  // Line table: one green section row per slot, then its lines; numbering runs across sections.
  const body: Array<Array<string | { content: string; colSpan: number; styles: Record<string, unknown> }>> = [];
  for (const sec of input.sections) {
    body.push([{ content: sec.title.toUpperCase(), colSpan: 5, styles: { fontStyle: "bold", fontSize: 8, textColor: GREEN, cellPadding: { top: 10, bottom: 4, left: 4, right: 4 }, halign: "left" } }]);
    for (const r of sec.rows) body.push([String(r.n), `${r.name}\n${r.codeLine}`, r.qty, r.rate, r.amount]);
  }
  autoTable(doc, {
    startY: tableTop,
    margin: { left: MARGIN, right: MARGIN, top: 50, bottom: 60 },
    head: [["#", input.head.item, input.head.qty, input.head.rate, input.head.amount]],
    body,
    theme: "plain",
    styles: { fontSize: 9, cellPadding: { top: 6, bottom: 6, left: 4, right: 4 }, textColor: [34, 34, 34], lineColor: [236, 236, 236], lineWidth: 0 },
    headStyles: { fontSize: 7.5, fontStyle: "bold", textColor: [136, 136, 136] },
    columnStyles: {
      0: { cellWidth: 22, textColor: [153, 153, 153] },
      2: { halign: "right", cellWidth: 82 },
      3: { halign: "right", cellWidth: 82 },
      4: { halign: "right", cellWidth: 86 },
    },
    rowPageBreak: "avoid",
    didParseCell: (data) => {
      if (data.section === "head" && data.column.index >= 2) data.cell.styles.halign = "right";
    },
    didDrawCell: (data) => {
      doc.setDrawColor(data.section === "head" ? 204 : 236, data.section === "head" ? 204 : 236, data.section === "head" ? 204 : 236);
      doc.setLineWidth(0.5);
      doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height);
    },
  });

  // Totals block in page order, right-aligned.
  const tableEnd = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const totalsWidth = 230;
  const lastIndex = input.totals.length - 1;
  autoTable(doc, {
    startY: tableEnd + 14,
    margin: { left: pageWidth - MARGIN - totalsWidth, right: MARGIN, top: 50, bottom: 60 },
    body: input.totals.map((t) => [t.label, t.value]),
    theme: "plain",
    styles: { fontSize: 9.5, cellPadding: { top: 3, bottom: 3, left: 6, right: 6 }, textColor: [85, 85, 85] },
    columnStyles: { 1: { halign: "right" } },
    rowPageBreak: "avoid",
    didParseCell: (data) => {
      if (data.row.index === 3) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.textColor = [27, 40, 30];
      }
      if (data.row.index === lastIndex) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fontSize = 12;
        data.cell.styles.textColor = [17, 17, 17];
        data.cell.styles.fillColor = GREEN_SOFT;
      }
    },
  });

  // Footer on every page: the quotation number and "Page X of Y", nothing else (Q-D33).
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const footY = pageHeight - 40;
    doc.setDrawColor(238, 238, 238);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, footY - 14, right, footY - 14);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(136, 136, 136);
    doc.text(input.footerNumber, MARGIN, footY);
    doc.text(input.footerPage(p, pages), right, footY, { align: "right" });
  }
  return doc;
}

export async function generateQuotationPdf(input: QuotationPdfInput): Promise<void> {
  const doc = await renderQuotationPdf(input);
  doc.save(input.filename);
}
