"use client";

import type { Ref } from "react";
import { useTranslations } from "next-intl";
import { EstimateActionButton } from "./estimate-action-button";
import { EstimateSummary, evaluateEstimate, type EstimateView } from "./estimate-summary";

interface EstimatePanelProps {
  view: EstimateView;
  /** The inquiry's currency (the form's Currency field, or `Inquiry.currency`): a different estimate currency shows the chip. */
  inquiryCurrency: string;
  /** Detail card only: "Updated 16 Oct 2026 by Asha Rao". */
  updatedLine?: string;
  /** NEW inquiry: Edit and Remove are offered. Otherwise only Export PDF (S33-22). */
  canEdit: boolean;
  /** The setup guard passed; false disables Edit with the calculator icon's tooltip (D-27). Export still works. */
  guardOn: boolean;
  /** An action is in flight: Edit and Remove wait. */
  busy?: boolean;
  sectionRef?: Ref<HTMLElement>;
  onEdit: (trigger: HTMLButtonElement) => void;
  onExport: () => void;
  onRemove: () => void;
}

const ICON = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;
const iconBtn =
  "flex h-[30px] w-[30px] items-center justify-center rounded-sm border border-border bg-bg-white text-text-body transition-colors hover:border-primary-soft hover:bg-primary-softer hover:text-primary-dark disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The "Estimate" section shared by the New Inquiry form and the inquiry detail card (v3 mockup, P7 mockup):
 * title with the "Attached" badge and the currency-drift chip, subtitle, header tools, and the read-only
 * table + totals. Presentation only: the owner decides what Edit, Export and Remove do.
 */
export function EstimatePanel({ view, inquiryCurrency, updatedLine, canEdit, guardOn, busy, sectionRef, onEdit, onExport, onRemove }: EstimatePanelProps) {
  const t = useTranslations("quickEstimate");
  const count = evaluateEstimate(view).priced;
  const drifted = view.currency !== inquiryCurrency;
  const subtitle = t("estimateSubtitle", { count, currency: view.currency });

  return (
    <section
      ref={sectionRef}
      aria-labelledby="qe-est-title"
      data-testid="qe-est-section"
      className="mb-6 overflow-hidden rounded-md border border-border bg-bg-card shadow-card"
    >
      <div className="flex flex-wrap items-center gap-3 bg-primary-softer px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <h2 id="qe-est-title" className="flex flex-wrap items-center gap-2 text-base font-extrabold text-primary-dark">
            {t("estimateTitle")}
            <span className="inline-flex items-center rounded-pill bg-status-paid-bg px-2 py-[3px] text-[10.5px] font-bold text-status-paid-text">
              {t("estimateAttached")}
            </span>
            {drifted && (
              <span
                data-testid="qe-est-drift"
                title={t("currencyMismatchTip", { inquiry: inquiryCurrency })}
                className="inline-flex items-center gap-[5px] rounded-pill bg-status-pending-bg px-[9px] py-[3px] text-[11px] font-bold text-status-pending-text"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" strokeWidth="2" aria-hidden="true" {...ICON}>
                  <path d="M12 3 2 20h20z" />
                  <path d="M12 10v4M12 17h.01" />
                </svg>
                {t("currencyMismatch", { estimate: view.currency, inquiry: inquiryCurrency })}
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-xs font-medium text-text-muted">
            {subtitle}
            {updatedLine ? ` · ${updatedLine}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {canEdit && (
            <EstimateActionButton
              enabled={guardOn}
              placement="below"
              align="right"
              onClick={(trigger) => {
                if (!busy) onEdit(trigger);
              }}
              data-testid="qe-est-edit"
              className="inline-flex h-[30px] items-center gap-1.5 rounded-sm border border-border bg-bg-white px-[11px] text-[12.5px] font-bold text-text-body hover:border-primary-soft hover:bg-primary-softer hover:text-primary-dark"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" strokeWidth="2" aria-hidden="true" {...ICON}>
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
              {t("editEstimate")}
            </EstimateActionButton>
          )}
          <button type="button" className={iconBtn} title={t("estimateExport")} aria-label={t("estimateExport")} onClick={onExport}>
            <svg width="14" height="14" viewBox="0 0 24 24" strokeWidth="2" aria-hidden="true" {...ICON}>
              <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
            </svg>
          </button>
          {canEdit && (
            <button
              type="button"
              className={`${iconBtn} hover:!border-[#F3B9B1] hover:!bg-status-failed-bg hover:!text-status-failed-text`}
              title={t("estimateRemoveTitle")}
              aria-label={t("estimateRemove")}
              disabled={busy}
              onClick={onRemove}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" strokeWidth="1.8" aria-hidden="true" {...ICON}>
                <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="bg-bg-white px-5 pb-4 pt-3.5">
        <EstimateSummary view={view} />
      </div>
    </section>
  );
}
