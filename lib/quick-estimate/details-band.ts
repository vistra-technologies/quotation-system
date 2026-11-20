/**
 * Quick Estimate PDF, project details band (Stage 37, QP-1 to QP-9; spec design-docs/quick-estimate-pdf.md).
 * Pure and value-only: shared by the PDF generator and the export preview so the two can't drift. Only an
 * inquiry-sourced PDF has a band; every empty field is left out (QP-3). Deliberately absent: the budget
 * (QP-4), end-client phone, email and address (QP-8), and a "Prepared by" row (human ruling 2026-11-20, D-15).
 */

/** The inquiry fields the band can print. Every value is optional text; blank means "omit". */
export interface InquiryDetails {
  /** App display form: `INQ-<companyInquiryNumber>` or `#<inquiryNumber>`. Absent before the inquiry exists. */
  inquiryNumber?: string;
  projectName?: string;
  location?: string;
  destination?: string;
  /** ISO date or `yyyy-mm-dd`; formatted by `formatBandDate`. */
  deadline?: string;
  endClientName?: string;
  gstNumber?: string;
  mainContractor?: string;
  interiorContractor?: string;
  mainConsultant?: string;
  interiorConsultant?: string;
}

export interface DetailsLabels {
  projectHeading: string;
  partiesHeading: string;
  inquiryNo: string;
  projectName: string;
  location: string;
  destination: string;
  deadline: string;
  endClient: string;
  gstNumber: string;
  mainContractor: string;
  interiorContractor: string;
  mainConsultant: string;
  interiorConsultant: string;
}

export interface BandRow {
  key: string;
  value: string;
}

export interface BandColumn {
  heading: string;
  rows: BandRow[];
}

/** Replace U+2013 and U+2014 (the PDF carries no long dashes, Q-D25) with an ASCII hyphen. */
export function stripLongDashes(s: string): string {
  return s.replace(/[–—]/g, "-");
}

/** `INQ-<company number>` when the inquiry has a company sequence, else `#<number>` (same as the detail page). */
export function formatInquiryNumber(companyInquiryNumber: number | null | undefined, inquiryNumber: number): string {
  return companyInquiryNumber != null ? `INQ-${companyInquiryNumber}` : `#${inquiryNumber}`;
}

/** `31 Jan 2027`, read in UTC so a date-only value never shifts a day. Unparseable text is returned as is. */
export function formatBandDate(value: string | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function rowsOf(pairs: Array<[string, string | undefined]>): BandRow[] {
  const rows: BandRow[] = [];
  for (const [key, raw] of pairs) {
    const value = stripLongDashes((raw ?? "").trim());
    if (value) rows.push({ key, value });
  }
  return rows;
}

/** The two band columns, empty columns dropped. An empty result means no band is drawn. */
export function buildDetailsBand(d: InquiryDetails, l: DetailsLabels): BandColumn[] {
  const project = rowsOf([
    [l.inquiryNo, d.inquiryNumber],
    [l.projectName, d.projectName],
    [l.location, d.location],
    [l.destination, d.destination],
    [l.deadline, formatBandDate(d.deadline)],
  ]);
  const parties = rowsOf([
    [l.endClient, d.endClientName],
    [l.gstNumber, d.gstNumber],
    [l.mainContractor, d.mainContractor],
    [l.interiorContractor, d.interiorContractor],
    [l.mainConsultant, d.mainConsultant],
    [l.interiorConsultant, d.interiorConsultant],
  ]);
  const cols: BandColumn[] = [];
  if (project.length) cols.push({ heading: l.projectHeading, rows: project });
  if (parties.length) cols.push({ heading: l.partiesHeading, rows: parties });
  return cols;
}

/** Right-aligned meta block: the inquiry number (bold) then the date on inquiry PDFs, the date alone otherwise. */
export function buildMetaLines(date: string, inquiryNumber: string | undefined): string[] {
  return inquiryNumber ? [inquiryNumber, date] : [date];
}
