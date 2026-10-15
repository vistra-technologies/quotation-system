import type { SupportedCurrency } from "@/lib/currency";
import type { EstimateResult, ValueLine } from "./estimate";
import { formatAmount, formatMoney, formatQty } from "./format";

/**
 * The printable estimate, built once from `computeEstimate`'s result and shared by the export preview and
 * the PDF (one source of maths and wording). Pure and value-only. Negatives use an ASCII hyphen because the
 * PDF's Helvetica is WinAnsi (S33-11). Only priced lines appear; Discount and Tax rows appear only when
 * non-zero.
 */
export interface SheetLabels {
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
}

export interface SheetRow {
  n: number;
  name: string;
  variant: string;
  qty: string;
  rate: string;
  amount: string;
}

export interface SheetTotal {
  label: string;
  value: string;
  grand?: boolean;
}

export interface Sheet {
  rows: SheetRow[];
  totals: SheetTotal[];
}

export function buildSheet(
  lines: ValueLine[],
  result: EstimateResult,
  currency: SupportedCurrency,
  labels: SheetLabels,
): Sheet {
  const rows: SheetRow[] = [];
  lines.forEach((l, i) => {
    const r = result.lines[i];
    if (!r?.priced) return;
    rows.push({
      n: rows.length + 1,
      name: l.itemName,
      variant: l.variantText,
      qty: `${formatQty(l.qty, currency)} ${l.unit}`,
      rate: formatAmount(l.unitPrice, currency),
      amount: formatAmount(r.total, currency),
    });
  });

  const totals: SheetTotal[] = [{ label: labels.subtotal, value: formatAmount(result.subtotal, currency) }];
  if (result.discount > 0) {
    const pct = result.discountMode === "pct" ? ` ${formatQty(result.discountValue, currency)}%` : "";
    totals.push({ label: `${labels.discount}${pct}`, value: `- ${formatAmount(result.discount, currency)}` });
  }
  if (result.tax > 0) {
    totals.push({ label: `${labels.tax} ${formatQty(result.taxPct, currency)}%`, value: `+ ${formatAmount(result.tax, currency)}` });
  }
  totals.push({ label: labels.total, value: formatMoney(result.grandTotal, currency), grand: true });
  return { rows, totals };
}
