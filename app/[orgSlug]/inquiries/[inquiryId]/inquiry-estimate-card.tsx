"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { isSupportedCurrency, type SupportedCurrency } from "@/lib/currency";
import { draftToInput, storedToDraft, storedToInput, type EstimateInput } from "@/lib/quick-estimate/inquiry-draft";
import type { InquiryQuickEstimateV1 } from "@/lib/quick-estimate/inquiry-estimate";
import { emptyDraft } from "@/lib/quick-estimate/lines";
import { EstimateActionButton } from "../../quick-estimate/estimate-action-button";
import { EstimatePanel } from "../../quick-estimate/estimate-panel";
import { useEstimate, type InquiryMode } from "../../quick-estimate/estimate-provider";
import { evaluateEstimate, type EstimateView } from "../../quick-estimate/estimate-summary";
import { ExportOverlay } from "../../quick-estimate/export-overlay";
import { UndoToast, useUndoToast } from "../../quick-estimate/undo-toast";
import { updateInquiryEstimate } from "../actions";

interface InquiryEstimateCardProps {
  orgSlug: string;
  inquiryId: string;
  /** NEW inquiries can add, edit and remove; any other status is read-only with Export PDF (S33-22). */
  status: string;
  /** `Inquiry.currency`: the popup is locked to it and a different estimate currency shows the drift chip (D-25). */
  currency: string;
  projectName: string;
  endClientName: string | null;
  quickEstimate: InquiryQuickEstimateV1 | null;
}

/** UTC on both server and client, so the server render and hydration agree. */
function formatUpdated(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * The Quick Estimate on the inquiry detail page (S33-21 / S33-22, P7 mockup). A NEW inquiry without an estimate
 * offers "Add estimate"; with one it shows the table with Edit, Export PDF and Remove; any other status shows the
 * table read-only with Export PDF only (and nothing at all when there is no estimate). Edits go through the
 * `updateInquiryEstimate` server action (PATCH). It edits a storage-free session copy and never reads or writes
 * the shared draft.
 */
export function InquiryEstimateCard({ orgSlug, inquiryId, status, currency, projectName, endClientName, quickEstimate }: InquiryEstimateCardProps) {
  const t = useTranslations("quickEstimate");
  const router = useRouter();
  const est = useEstimate();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const { toast, show: showToast, hide: hideToast } = useUndoToast();
  const addBtnRef = useRef<HTMLButtonElement>(null);

  const isNew = status === "NEW";
  const inquiryCurrency: SupportedCurrency = isSupportedCurrency(currency) ? currency : "INR";
  const storedCurrency: SupportedCurrency | null = quickEstimate && isSupportedCurrency(quickEstimate.currency) ? quickEstimate.currency : null;
  const view: EstimateView | null =
    quickEstimate && storedCurrency
      ? {
          currency: storedCurrency,
          discountMode: quickEstimate.discountMode,
          discountValue: quickEstimate.discountValue,
          taxPct: quickEstimate.taxPct,
          lines: quickEstimate.lines,
        }
      : null;

  /** PATCH through the server action; on success refresh the server-rendered page and run `after`. */
  function save(input: EstimateInput | null, after?: () => void) {
    setError(null);
    startTransition(async () => {
      let message: string | null;
      try {
        message = (await updateInquiryEstimate(orgSlug, inquiryId, input)).error;
      } catch {
        message = t("saveFailed");
      }
      if (message) {
        setError(message);
        return;
      }
      router.refresh();
      after?.();
    });
  }

  function openPopup(trigger: HTMLElement, isUpdate: boolean) {
    if (!est.enabled) return;
    const mode: InquiryMode = {
      currency: inquiryCurrency,
      isUpdate,
      onAttach: (snapshot) => save(draftToInput(snapshot), () => showToast(isUpdate ? t("toastUpdated") : t("toastAttached"))),
      getExportMeta: () => ({ preparedFor: endClientName ?? "", projectName }),
    };
    let seq = 0;
    est.session.reset(
      quickEstimate
        ? storedToDraft(quickEstimate, est.types, inquiryCurrency, () => `s${++seq}`)
        : emptyDraft(inquiryCurrency),
    );
    est.open({ kind: "inquiry", source: "session", mode, returnFocus: trigger });
  }

  function remove() {
    if (!quickEstimate) return;
    const previous = storedToInput(quickEstimate);
    // A drifted estimate gets no Undo: re-saving would stamp the inquiry's currency on unconverted rates (D-25).
    const drifted = quickEstimate.currency !== currency;
    save(null, () => showToast(t("toastRemoved"), drifted ? undefined : () => save(previous)));
  }

  if (!view && !isNew) return null;

  return (
    <>
      {view && (
        <EstimatePanel
          view={view}
          inquiryCurrency={currency}
          updatedLine={
            quickEstimate ? t("estimateUpdated", { date: formatUpdated(quickEstimate.updatedAt), name: quickEstimate.updatedByName }) : undefined
          }
          canEdit={isNew}
          guardOn={est.enabled}
          busy={pending}
          onEdit={(trigger) => openPopup(trigger, true)}
          onExport={() => setExporting(true)}
          onRemove={remove}
        />
      )}

      {!view && isNew && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-bg-white px-5 py-3 shadow-card">
          <EstimateActionButton
            enabled={est.enabled}
            buttonRef={addBtnRef}
            onClick={(trigger) => openPopup(trigger, false)}
            data-testid="qe-add-estimate"
            className="inline-flex items-center gap-2 rounded-sm border border-border bg-bg-white px-4 py-2.5 text-sm font-bold text-primary-dark hover:border-primary-soft hover:bg-primary-softer"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="2.5" width="14" height="19" rx="2" />
              <rect x="8" y="5.5" width="8" height="4" rx=".5" />
              <path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01" />
            </svg>
            {t("addEstimate")}
          </EstimateActionButton>
        </div>
      )}

      {error && (
        <div role="alert" className="mt-4 rounded-sm border border-status-failed-text/20 bg-status-failed-bg px-4 py-3">
          <p className="text-sm font-semibold text-status-failed-text">{error}</p>
        </div>
      )}

      {exporting && view && (
        <ExportOverlay
          orgName={est.orgName}
          currency={view.currency}
          lines={view.lines}
          result={evaluateEstimate(view)}
          initialPreparedFor={endClientName ?? ""}
          projectName={projectName}
          onClose={() => setExporting(false)}
        />
      )}
      <UndoToast toast={toast} onDone={hideToast} />
    </>
  );
}
