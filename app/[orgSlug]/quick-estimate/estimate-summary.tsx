"use client";

import { useTranslations } from "next-intl";
import type { SupportedCurrency } from "@/lib/currency";
import { computeEstimate, type DiscountMode, type EstimateResult, type ValueLine } from "@/lib/quick-estimate/estimate";
import { buildSheet } from "@/lib/quick-estimate/sheet";

/** The values an inquiry estimate is shown from (the stored value, or the form's pending one). */
export interface EstimateView {
  currency: SupportedCurrency;
  discountMode: DiscountMode;
  discountValue: number;
  taxPct: number;
  lines: ValueLine[];
}

/** Maths for a view: the same `computeEstimate` the popup, the preview and the PDF run (S33-7). */
export function evaluateEstimate(view: EstimateView): EstimateResult {
  return computeEstimate(view.lines, { mode: view.discountMode, value: view.discountValue }, view.taxPct);
}

/**
 * Read-only table + totals for an estimate on an inquiry (S33-20, S33-21). Rows and totals come from
 * `buildSheet`, the same builder as the export preview and the PDF, so the three cannot drift: priced lines
 * only, Discount and Tax always present (D-19), currency codes never symbols, "Tax" for every currency.
 */
export function EstimateSummary({ view }: { view: EstimateView }) {
  const t = useTranslations("quickEstimate");
  const result = evaluateEstimate(view);
  const sheet = buildSheet(view.lines, result, view.currency, {
    subtotal: t("subtotal"),
    discount: t("discount"),
    tax: t("tax"),
    total: t("total"),
  });
  // buildSheet keeps priced lines only, in order; pair each row with its unit for the "/unit" suffix.
  const priced = view.lines.filter((_, i) => result.lines[i]?.priced);

  return (
    <div>
      <div className="overflow-x-auto rounded-sm border border-border" data-testid="qe-est-table">
        <table className="w-full min-w-[600px] border-collapse text-[13px] [font-variant-numeric:tabular-nums]">
          <thead>
            <tr className="bg-bg-card text-[10px] font-bold uppercase tracking-wider text-text-muted">
              <th className="w-10 px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">{t("colItem")}</th>
              <th className="px-3 py-2 text-right">{t("colQuantity")}</th>
              <th className="px-3 py-2 text-right">{t("colRate")}</th>
              <th className="px-3 py-2 text-right">{t("colAmount")}</th>
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((r, i) => (
              <tr key={r.n} className="border-t border-border align-top">
                <td className="px-3 py-2.5 font-bold text-text-placeholder">{r.n}</td>
                <td className="px-3 py-2.5">
                  <b className="block font-extrabold text-text-heading">{r.name}</b>
                  {r.variant && <span className="mt-px block text-xs text-text-muted">{r.variant}</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right">{r.qty}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right">
                  {r.rate} <span className="font-semibold text-text-muted">/{priced[i]?.unit}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-extrabold text-text-heading">
                  {view.currency} {r.amount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex justify-end">
        <div className="w-[300px] max-w-full rounded-md border border-border bg-bg-card px-3.5 pb-2.5 pt-2" data-testid="qe-est-totals">
          {sheet.totals.map((row, i) => (
            <div
              key={i}
              className={
                row.grand
                  ? "mt-1.5 flex items-center justify-between gap-4 border-t border-border-strong pt-2.5"
                  : "flex justify-between gap-4 py-1 text-[12.5px] [font-variant-numeric:tabular-nums]"
              }
            >
              <span className={row.grand ? "text-sm font-extrabold text-text-heading" : "font-semibold text-text-muted"}>{row.label}</span>
              <span
                className={
                  row.grand
                    ? "whitespace-nowrap text-[17px] font-extrabold tracking-tight text-text-heading [font-variant-numeric:tabular-nums]"
                    : "whitespace-nowrap font-bold text-text-heading"
                }
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
