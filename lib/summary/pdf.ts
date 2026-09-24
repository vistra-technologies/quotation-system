/**
 * Summary PDF generation (Stage 26 Batch 4, S26-5). The **only** file in the repo that imports
 * `jspdf`/`jspdf-autotable` — both are dynamically imported inside `generateSummaryPdf()` so the ~500 KB
 * combined bundle is never part of the initial page load, only fetched on Export click.
 *
 * Uses jspdf-autotable's standalone `autoTable(doc, options)` function (its documented ESM entry point)
 * rather than the `doc.autoTable()` prototype method — the prototype method is only auto-attached when a
 * global `window.jsPDF` exists (browser <script> tag usage), which a bundled ESM import never sets up.
 * The standalone function still assigns `doc.lastAutoTable` as a side effect (jspdf-autotable's own
 * `drawTable()`), so `doc.lastAutoTable.finalY` chaining below works identically either way.
 */
import type { PdfHeaderFields, PdfTable } from "./pdf-rows";

const PAGE_MARGIN = 40;
const GAP_AFTER_TABLE = 16;

export interface GenerateSummaryPdfInput {
  header: PdfHeaderFields;
  kpi: { glass: PdfTable; doors: PdfTable };
  material: PdfTable[];
  filename: string;
}

export async function generateSummaryPdf(input: GenerateSummaryPdfInput): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // ─── Header (mockup-batch0.html §3, minus the Formula Set row per S26-9) ────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(input.header.orgName, PAGE_MARGIN, 50);

  doc.setFontSize(12);
  doc.text("PROJECT SUMMARY", pageWidth - PAGE_MARGIN, 50, { align: "right" });

  doc.setLineWidth(0.75);
  doc.line(PAGE_MARGIN, 62, pageWidth - PAGE_MARGIN, 62);

  // 2-column x 2-row meta grid: Project / Client on row 1, Computed at on row 2.
  const col1X = PAGE_MARGIN;
  const col2X = pageWidth / 2;
  let metaY = 82;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("PROJECT", col1X, metaY);
  doc.text(input.header.clientLabel.toUpperCase(), col2X, metaY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  metaY += 16;
  doc.text(input.header.projectLine, col1X, metaY);
  doc.text(input.header.clientValue, col2X, metaY);

  metaY += 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("COMPUTED AT", col1X, metaY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  metaY += 16;
  doc.text(input.header.computedAtLabel, col1X, metaY);

  // ─── Body tables ──────────────────────────────────────────────────────────
  let startY = metaY + 24;

  function drawTable(table: PdfTable) {
    // M1 (Stage 26 R2 review): if the title plus the head row plus one body row won't fit above the
    // bottom margin, jspdf-autotable will push the whole table to the next page on its own, leaving an
    // orphaned title behind on this one — force the page break ourselves first instead.
    if (startY + 60 > pageHeight - PAGE_MARGIN) {
      doc.addPage();
      startY = PAGE_MARGIN;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(table.title, PAGE_MARGIN, startY);

    autoTable(doc, {
      startY: startY + 8,
      margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
      head: [table.head],
      body: table.totalRow ? [...table.body, table.totalRow] : table.body,
      styles: { fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: [230, 236, 233], textColor: [30, 41, 38], fontStyle: "bold" },
      didParseCell: (data) => {
        if (table.totalRow && data.row.section === "body" && data.row.index === table.body.length) {
          data.cell.styles.fontStyle = "bold";
        }
      },
    });

    const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    startY = finalY + GAP_AFTER_TABLE + 16;
  }

  drawTable(input.kpi.glass);
  drawTable(input.kpi.doors);
  for (const table of input.material) {
    drawTable(table);
  }

  // ─── Footer — second pass, once the final page count is known ─────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(
      `Page ${i} of ${pageCount}`,
      pageWidth - PAGE_MARGIN,
      doc.internal.pageSize.getHeight() - 20,
      { align: "right" },
    );
  }

  doc.save(input.filename);
}
