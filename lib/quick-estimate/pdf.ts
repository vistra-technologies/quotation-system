/**
 * Quick Estimate PDF (Stage 33, S33-11), modelled on lib/summary/pdf.ts: jsPDF and jspdf-autotable are
 * imported dynamically inside the generator so their bundle is only fetched on Download. Standalone
 * `autoTable(doc, ...)`, A4 portrait, pt units.
 *
 * No i18n and no maths here: the caller passes already translated strings and a `Sheet` built by
 * `buildSheet` (the same one the export preview renders). Helvetica is WinAnsi: `²` and `—` are in that
 * set; negative amounts arrive with an ASCII hyphen from `buildSheet`.
 */
import type { Sheet } from "./sheet";

const MARGIN = 44;
const GREEN: [number, number, number] = [78, 127, 88];
const GREEN_SOFT: [number, number, number] = [236, 240, 237];

export interface QuickEstimatePdfInput {
  orgName: string;
  /** "QUICK ESTIMATE" */
  title: string;
  /** Right-aligned meta lines: date, currency, "For <name>" (optional), username. */
  metaLines: string[];
  head: { item: string; qty: string; rate: string; amount: string };
  sheet: Sheet;
  /** "Indicative estimate only — not a quotation." */
  disclaimer: string;
  filename: string;
}

export async function generateQuickEstimatePdf(input: QuickEstimatePdfInput): Promise<void> {
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
  doc.text(input.title.split("").join(" "), MARGIN, 74);

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
  const ruleY = Math.max(92, metaY + 4);
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(1.5);
  doc.line(MARGIN, ruleY, right, ruleY);

  // Line table.
  autoTable(doc, {
    startY: ruleY + 14,
    margin: { left: MARGIN, right: MARGIN },
    head: [["#", input.head.item, input.head.qty, input.head.rate, input.head.amount]],
    body: input.sheet.rows.map((r) => [String(r.n), r.variant ? `${r.name}\n${r.variant}` : r.name, r.qty, r.rate, r.amount]),
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

  doc.save(input.filename);
}
