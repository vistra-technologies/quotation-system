/**
 * The text of the quotation PDF (Stage 38 Batch 4, S38-D5). PURE: builds every string the PDF draws from the
 * quotation view, so it is unit-tested without jsPDF. Never reads or prints the price range (Q-D34): only
 * `unitPrice` and `amount` of a line are used. Every string passes `stripLongDashes` (no U+2013 / U+2014, Q-D25).
 * Negative amounts use an ASCII hyphen (Helvetica WinAnsi, same as the Quick Estimate PDF).
 */
import { stripLongDashes } from "@/lib/quick-estimate/details-band";
import type { ConfigSnapshot } from "@/lib/config-snapshot";
import { formatDate, formatMoney, formatQuantity, percentLabel, sectionsOf, unitText, type QuotationDto } from "./present";

/** The translated words, filled by the caller (the page reads them from the `quotation` namespace). */
export interface QuotationPdfLabels {
  title: string;
  preparedFor: string;
  issued: (date: string) => string;
  validUntil: (date: string) => string;
  bandProject: string;
  bandParties: string;
  quotationNo: string;
  projectName: string;
  projectNo: string;
  location: string;
  preparedBy: string;
  company: string;
  endClient: string;
  item: string;
  qty: string;
  rate: (currency: string) => string;
  amount: string;
  packOf: (size: string, unit: string) => string;
  packs: (count: string) => string;
  linesTotal: string;
  transport: string;
  otherCharges: string;
  subtotal: string;
  discount: (percent: string | null) => string;
  tax: (percent: string) => string;
  total: string;
  footerPage: (page: number, total: number) => string;
}

export interface QuotationPdfContext {
  orgName: string;
  projectName: string;
  projectNumber: number;
  projectLocation: string | null;
  preparedBy: string | null;
  company: string | null;
  endClient: string | null;
  snapshot: ConfigSnapshot | null;
}

export interface PdfRow {
  n: number;
  name: string;
  /** The code, plus ", pack of 6 m" for a pack item. */
  codeLine: string;
  qty: string;
  rate: string;
  amount: string;
}

export interface QuotationPdfInput {
  orgName: string;
  title: string;
  preparedFor: string;
  preparedForLabel: string;
  /** Right-aligned meta lines: the number (bold), Issued, Valid until. */
  metaLines: string[];
  band: Array<{ heading: string; rows: Array<{ key: string; value: string }> }>;
  head: { item: string; qty: string; rate: string; amount: string };
  sections: Array<{ title: string; rows: PdfRow[] }>;
  totals: Array<{ label: string; value: string }>;
  /** The number drawn at the left of every page footer; the right side is `footerPage(page, total)`. */
  footerNumber: string;
  footerPage: (page: number, total: number) => string;
  filename: string;
}

const clean = stripLongDashes;

export function buildQuotationPdf(q: QuotationDto, ctx: QuotationPdfContext, labels: QuotationPdfLabels): QuotationPdfInput {
  let n = 0;
  const sections = sectionsOf(q.lines, ctx.snapshot).map((sec) => ({
    title: clean(sec.title),
    rows: sec.lines.map((line): PdfRow => {
      n += 1;
      const pack = line.perUnitQuantity > 1;
      const qty = pack ? labels.packs(formatQuantity(line.quantity)) : `${formatQuantity(line.quantity)} ${unitText(line.unit, line.quantity)}`;
      const packNote = pack ? `, ${labels.packOf(formatQuantity(line.perUnitQuantity), unitText(line.unit, line.perUnitQuantity))}` : "";
      return { n, name: clean(line.name), codeLine: clean(`${line.code}${packNote}`), qty: clean(qty), rate: formatMoney(line.unitPrice), amount: formatMoney(line.amount) };
    }),
  }));

  const rowsOf = (pairs: Array<[string, string | null | undefined]>) =>
    pairs.filter(([, v]) => v && v.trim() !== "").map(([key, v]) => ({ key: clean(key), value: clean((v as string).trim()) }));
  const number = q.number;
  const band = [
    {
      heading: labels.bandProject,
      rows: rowsOf([
        [labels.quotationNo, number],
        [labels.projectName, ctx.projectName],
        [labels.projectNo, `#${ctx.projectNumber}`],
        [labels.location, ctx.projectLocation],
        [labels.preparedBy, ctx.preparedBy],
      ]),
    },
    { heading: labels.bandParties, rows: rowsOf([[labels.company, ctx.company], [labels.endClient, ctx.endClient]]) },
  ].filter((c) => c.rows.length > 0);

  const t = q.totals;
  const cur = q.currency;
  const discountPercent = q.discountType === "PERCENT" ? percentLabel(q.discount) : null;
  const totals = [
    { label: labels.linesTotal, value: formatMoney(t.linesTotal) },
    { label: labels.transport, value: `+ ${formatMoney(q.transport)}` },
    { label: labels.otherCharges, value: `+ ${formatMoney(q.otherCharges)}` },
    { label: labels.subtotal, value: formatMoney(t.subtotal) },
    { label: labels.discount(discountPercent), value: `- ${formatMoney(t.discountAmount)}` },
    { label: labels.tax(percentLabel(q.taxPercent)), value: `+ ${formatMoney(t.taxAmount)}` },
    { label: labels.total, value: `${cur} ${formatMoney(t.grandTotal)}` },
  ].map((r) => ({ label: clean(r.label), value: clean(r.value) }));

  return {
    orgName: clean(ctx.orgName),
    title: clean(labels.title),
    preparedFor: clean(ctx.company ?? ctx.endClient ?? ""),
    preparedForLabel: clean(labels.preparedFor),
    metaLines: [number, labels.issued(formatDate(q.createdAt)), labels.validUntil(formatDate(q.validUntil))].map(clean),
    band,
    head: { item: clean(labels.item), qty: clean(labels.qty), rate: clean(labels.rate(cur)), amount: clean(labels.amount) },
    sections,
    totals,
    footerNumber: number,
    footerPage: labels.footerPage,
    filename: `quotation-${number}.pdf`,
  };
}
