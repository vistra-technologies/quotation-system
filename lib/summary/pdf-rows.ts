/**
 * PDF export data-shaping (Stage 26 Batch 4). Prisma-free, jsPDF-free — pure functions that turn
 * already-correct `Summary`/`MaterialListLine` data into flat `string[][]` autotable rows, in the fixed
 * default order the mockup/on-screen tables use on first render (never the user's current on-screen sort
 * state — nothing here reads React state or the DOM). Reuses Batch 1's `lib/summary/view.ts` helpers
 * rather than re-deriving anything.
 *
 * No `jspdf`/`jspdf-autotable` import in this file on purpose — lib/summary/pdf.ts is the sole import
 * site (S26-5: keep the ~500 KB jsPDF bundle out of the initial page load), and this file's unit test
 * doesn't need a DOM/jsPDF stub as a result.
 */
import type { MaterialListLine, Summary } from "./types";
import type { ConfigSnapshot } from "../config-snapshot";
import {
  rebuildDoorKpis,
  buildMaterialSections,
  formatGlassLabel,
  formatThickness,
  formatAreaM2,
  formatUnit,
  orDash,
} from "./view";

// ─── Header fields (S26-9: no formula set name/version anywhere) ──────────────

export interface PdfHeaderFields {
  orgName: string;
  /** "{name} (#{projectNumber})" */
  projectLine: string;
  /** "External Company" | "End Client" */
  clientLabel: string;
  /** Resolved name, or "—" when neither is set. */
  clientValue: string;
  /** Pre-formatted by the caller (same Intl.DateTimeFormat string the page already builds). */
  computedAtLabel: string;
}

/**
 * `externalCompanyName` wins if both are set (stage-26.md doesn't pin down the precedence when a project
 * somehow has both — this plan's own explicit, narrow decision). Neither set -> "—" (orDash convention).
 */
export function resolveClientField(
  externalCompanyName: string | null,
  endClientName: string | null,
): { label: string; value: string } {
  if (externalCompanyName) return { label: "External Company", value: externalCompanyName };
  if (endClientName) return { label: "End Client", value: endClientName };
  return { label: "End Client", value: orDash(null) };
}

// ─── Table shape ────────────────────────────────────────────────────────────

export interface PdfTable {
  /** Table/section title for the PDF body. */
  title: string;
  /** Column labels. */
  head: string[];
  /** Row cells, in fixed default order. */
  body: string[][];
  /** Present only on KPI tables (S26-7) — a trailing Total row. */
  totalRow?: string[];
}

/** Mirrors summary-tables.tsx's private `fmtNum`/`withUnit` (not exported) — a small, deliberate duplication. */
function fmtQty(value: number, unit: string): string {
  return `${value.toLocaleString("en-GB", { maximumFractionDigits: 3 })} ${formatUnit(unit, value)}`;
}

export function buildKpiPdfTables(summary: Summary): { glass: PdfTable; doors: PdfTable } {
  const glassRows = summary.kpis.sqmByGlassType;
  const glass: PdfTable = {
    title: "Project KPIs — Glass",
    head: ["Glass Type", "Thickness", "Area"],
    body: glassRows.map((r) => [
      formatGlassLabel(r.glassType),
      formatThickness(r.thickness),
      `${formatAreaM2(r.areaM2)} m²`,
    ]),
    // Total row per S26-7 comes from the stored kpis.totalPartitionSqm, not a sum of the (rounded) body rows.
    totalRow: ["Total", "", `${formatAreaM2(summary.kpis.totalPartitionSqm)} m²`],
  };

  const doorRows = rebuildDoorKpis(summary);
  const doorQtyTotal = doorRows.reduce((sum, r) => sum + r.quantity, 0);
  const doors: PdfTable = {
    title: "Project KPIs — Doors",
    head: ["Door Type", "Category", "Qty"],
    body: doorRows.map((r) => [orDash(r.doorType), orDash(r.category), `${r.quantity} ${r.quantity === 1 ? "pc" : "pcs"}`]),
    totalRow: ["Total", "", `${doorQtyTotal} pcs`],
  };

  return { glass, doors };
}

export function buildMaterialPdfTables(
  materialList: MaterialListLine[],
  snapshot: ConfigSnapshot,
): PdfTable[] {
  const sections = buildMaterialSections(materialList, snapshot);
  return sections.map((section) => ({
    title: section.title,
    head: ["Code", "Name", "Requirement", "Per Unit Qty", "Item Qty"],
    body: section.lines.map((line) => [
      line.code,
      line.name,
      fmtQty(line.requirement, line.unit),
      fmtQty(line.perUnitQuantity, line.unit),
      line.quantity.toLocaleString("en-GB", { maximumFractionDigits: 3 }),
    ]),
    // No Total row — matches the on-screen Material List, which has none.
  }));
}
