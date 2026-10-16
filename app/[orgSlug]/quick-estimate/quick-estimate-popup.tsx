"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { SelectField } from "@/components/select-field";
import { SUPPORTED_CURRENCIES, type SupportedCurrency } from "@/lib/currency";
import { computeEstimate, isInvalidQty, type EstimateLineResult } from "@/lib/quick-estimate/estimate";
import { formatAmount, formatMoney } from "@/lib/quick-estimate/format";
import { sameDraft } from "@/lib/quick-estimate/inquiry-draft";
import { toValueLines, type DraftLine } from "@/lib/quick-estimate/lines";
import type { EstimateType } from "@/lib/quick-estimate/palette";
import { ComponentChip } from "./component-chip";
import type { InquiryMode } from "./estimate-provider";
import { ExportPreview } from "./export-preview";
import { ItemPicker } from "./item-picker";
import type { EstimateState } from "./use-estimate-state";
import { useFocusTrap } from "./use-focus-trap";
import "./quick-estimate.css";

interface QuickEstimatePopupProps {
  orgName: string;
  types: EstimateType[];
  state: EstimateState;
  /** Closes the popup; the caller returns focus to the opener. */
  onClose: () => void;
  /**
   * Inquiry mode (S33-23): the currency is locked and shown as a label, the primary footer button attaches or
   * updates the inquiry's estimate, Export PDF is secondary. The popup writes nothing to sessionStorage; the
   * caller persists the snapshot. Absent = standalone, all Batch 1 behaviour.
   */
  inquiryMode?: InquiryMode;
}

interface LineRowProps {
  line: DraftLine;
  result: EstimateLineResult | null;
  currency: SupportedCurrency;
  types: EstimateType[];
  pickerOpen: boolean;
  onTogglePicker: () => void;
  onClosePicker: (refocus: boolean) => void;
  state: EstimateState;
  onChosen: (id: string) => void;
}

function LineRow({ line, result, currency, types, pickerOpen, onTogglePicker, onClosePicker, state, onChosen }: LineRowProps) {
  const t = useTranslations("quickEstimate");
  const itemRef = useRef<HTMLButtonElement>(null);
  const hasItem = line.typeCode !== null && line.unit !== null;
  const qtyBad = hasItem && line.unit !== null && isInvalidQty(line.qty, line.unit);
  const label = hasItem ? `${line.itemName} · ${line.variantText}` : t("selectItem");

  return (
    <div className="qe-line qe-grid" data-line={line.id}>
      <button
        ref={itemRef}
        type="button"
        className="qe-item"
        aria-haspopup="listbox"
        aria-expanded={pickerOpen}
        title={label}
        onClick={onTogglePicker}
      >
        {hasItem ? (
          <>
            <ComponentChip code={line.typeCode ?? ""} name={line.itemName} />
            <span className="qe-item-text">
              <span className="qe-n">{line.variantText}</span>
            </span>
          </>
        ) : (
          <>
            <span className="qe-chip qe-chip-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span className="qe-item-text">
              <span className="qe-ph">{t("selectItem")}</span>
            </span>
          </>
        )}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m7 10 5 5 5-5" />
        </svg>
      </button>

      <div className={`qe-in${hasItem ? "" : " qe-off"}${qtyBad ? " qe-bad" : ""}`}>
        <input
          data-qty={line.id}
          type="number"
          min={0}
          step={line.unit === "pcs" ? 1 : "any"}
          inputMode={line.unit === "pcs" ? "numeric" : "decimal"}
          placeholder="0"
          aria-label={t("quantity")}
          aria-invalid={qtyBad || undefined}
          value={line.qty}
          disabled={!hasItem}
          onChange={(e) => state.setQty(line.id, e.target.value)}
        />
        <span className="qe-unit">{line.unit ?? ""}</span>
      </div>

      <div className={`qe-in${line.flag ? " qe-flag" : ""}${hasItem ? "" : " qe-off"}`}>
        <span className="qe-pre">{currency}</span>
        <input
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          placeholder="0.00"
          aria-label={t("unitRate")}
          value={line.rate}
          disabled={!hasItem}
          onChange={(e) => state.setRate(line.id, e.target.value)}
        />
        <span className="qe-unit">{line.unit ? `/${line.unit}` : ""}</span>
      </div>

      <div className="qe-amt">
        {result?.priced ? formatAmount(result.total, currency) : <span className="qe-dash">—</span>}
      </div>

      <button type="button" className="qe-del" title={t("removeLine")} aria-label={t("removeLine")} onClick={() => state.removeLine(line.id)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
        </svg>
      </button>

      {pickerOpen && (
        <ItemPicker
          anchorRef={itemRef}
          types={types}
          selectedCode={line.typeCode}
          selectedText={line.variantText}
          onChoose={(ty, option) => {
            state.chooseItem(line.id, ty, option);
            onChosen(line.id);
          }}
          onClose={onClosePicker}
        />
      )}
    </div>
  );
}

/**
 * Quick Estimate popup (Stage 33). Rendered through a portal (the top bar is `sticky z-30` and would trap
 * an inline fixed overlay). A modal dialog: Esc closes in layers (picker, Clear confirm, export step, then
 * the popup), focus is trapped, and the backdrop closes it. Makes no network request (S33-14); the draft
 * lives in the caller (`useEstimateState`).
 */
export function QuickEstimatePopup({ orgName, types, state, onClose, inquiryMode }: QuickEstimatePopupProps) {
  const t = useTranslations("quickEstimate");
  const { draft } = state;
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const clearBtnRef = useRef<HTMLButtonElement>(null);
  const exportBtnRef = useRef<HTMLButtonElement>(null);
  const attachBtnRef = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState<"edit" | "export">("edit");
  const [pickerLine, setPickerLine] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"clear" | "discard" | null>(null);
  // What the popup was opened with: the discard confirm compares against it (S33-23).
  const [opened] = useState(() => state.draft);
  // Inquiry exports prefill "Prepared for" and add the project name; read when the export step opens.
  const [exportMeta, setExportMeta] = useState<{ preparedFor: string; projectName: string } | null>(null);
  // A focus move to run after the next render (new DOM must exist first). Refs only: no state in effects.
  const afterRender = useRef<(() => void) | null>(null);

  useFocusTrap(rootRef);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const run = afterRender.current;
    if (run) {
      afterRender.current = null;
      run();
    }
  });

  // Closing an inquiry-mode update with unsaved changes asks first (S33-23); everything else closes at once.
  const requestClose = useCallback(() => {
    if (inquiryMode?.isUpdate && !sameDraft(state.draft, opened)) {
      setPickerLine(null);
      setConfirm("discard");
      return;
    }
    onClose();
  }, [inquiryMode?.isUpdate, state.draft, opened, onClose]);

  // Layered Esc. SelectField and the picker consume their own Esc (preventDefault), which is skipped here.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      if (pickerLine !== null) setPickerLine(null);
      else if (confirm !== null) {
        const kind = confirm;
        setConfirm(null);
        afterRender.current = () => (kind === "clear" ? clearBtnRef : attachBtnRef).current?.focus();
      } else if (step === "export") backToEdit();
      else requestClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pickerLine, confirm, step, requestClose]);

  // Back from the export step re-mounts the editor: put focus on the Export PDF button, not on body.
  function backToEdit() {
    setStep("edit");
    afterRender.current = () => exportBtnRef.current?.focus();
  }

  const currency = draft.currency;
  const valueLines = toValueLines(draft.lines);
  const result = computeEstimate(
    valueLines,
    { mode: draft.discountMode, value: parseFloat(draft.discountValue) },
    parseFloat(draft.taxPct),
  );
  // Per-line results line up with `valueLines`, which skips lines that have no item yet.
  let vi = 0;
  const lineResults = draft.lines.map((l) => (l.typeCode !== null && l.unit !== null ? result.lines[vi++] : null));

  const flagged = draft.lines.some((l) => l.flag);
  const none = draft.lines.length === 0;

  function addItem() {
    const id = state.addLine();
    setPickerLine(id);
    afterRender.current = () =>
      dialogRef.current?.querySelector(`[data-line="${id}"]`)?.scrollIntoView({ block: "nearest" });
  }

  function focusQty(id: string) {
    setPickerLine(null);
    afterRender.current = () => {
      const el = rootRef.current?.querySelector<HTMLInputElement>(`[data-qty="${id}"]`);
      el?.focus();
      el?.select();
    };
  }

  function openExport() {
    setExportMeta(inquiryMode ? inquiryMode.getExportMeta() : null);
    setStep("export");
  }

  function attach() {
    if (!inquiryMode || result.priced === 0) return;
    inquiryMode.onAttach(state.draft);
    onClose();
  }

  function confirmClear() {
    state.clearLines();
    setConfirm(null);
    setPickerLine(null);
    afterRender.current = () => rootRef.current?.querySelector<HTMLElement>("[data-empty-add]")?.focus();
  }

  const discountId = "qe-discount";
  const taxId = "qe-tax";

  return createPortal(
    <div ref={rootRef} className="qe-root">
      {step === "export" ? (
        <ExportPreview
          orgName={orgName}
          currency={currency}
          lines={valueLines}
          result={result}
          initialPreparedFor={exportMeta?.preparedFor}
          projectName={exportMeta?.projectName}
          onBack={backToEdit}
        />
      ) : (
        <div
          className="qe-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) requestClose();
          }}
        >
          <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="qe-title" className="qe-dialog">
            <div className="qe-head">
              <div className="qe-head-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="5" y="2.5" width="14" height="19" rx="2" />
                  <rect x="8" y="5.5" width="8" height="4" rx=".5" />
                  <path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01" />
                </svg>
              </div>
              <h2 className="qe-title" id="qe-title">{t("title")}</h2>
              <span className="qe-info" tabIndex={0} aria-label={t("infoLabel")}>
                i
                <span className="qe-info-tip" role="tooltip">{t("infoTip")}</span>
              </span>
              <span className="qe-spacer" />
              {inquiryMode ? (
                <span className="qe-cur-label" title={t("currency")} aria-label={`${t("currency")} ${currency}`}>{currency}</span>
              ) : (
                <div className="qe-cur">
                  <SelectField
                    value={currency}
                    title={t("currency")}
                    onChange={(e) => state.setCurrency(e.target.value as SupportedCurrency)}
                  >
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </SelectField>
                </div>
              )}
              <button type="button" className="qe-x" onClick={requestClose} title={t("close")} aria-label={t("close")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>

            {flagged && (
              <div className="qe-notice" role="status">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3 2 20h20z" />
                  <path d="M12 10v4M12 17h.01" />
                </svg>
                <span>{t("currencyChanged", { currency })}</span>
                <span className="qe-spacer" />
                {state.prevCurrency !== null && !inquiryMode && (
                  <button type="button" onClick={state.undoCurrency}>{t("undo")}</button>
                )}
                <button type="button" className="qe-notice-ok" onClick={state.acceptRates}>{t("ratesCorrect")}</button>
              </div>
            )}

            <div className="qe-scroll">
              {!none ? (
                <div>
                  <div className="qe-cols qe-grid" aria-hidden="true">
                    <span>{t("colItem")}</span>
                    <span className="qe-r">{t("colQuantity")}</span>
                    <span className="qe-r">{t("colRate")}</span>
                    <span className="qe-r">{t("colAmount")}</span>
                    <span />
                  </div>
                  <div className="qe-lines">
                    {draft.lines.map((line, i) => (
                      <LineRow
                        key={line.id}
                        line={line}
                        result={lineResults[i]}
                        currency={currency}
                        types={types}
                        pickerOpen={pickerLine === line.id}
                        onTogglePicker={() => setPickerLine(pickerLine === line.id ? null : line.id)}
                        onClosePicker={(refocus) => {
                          setPickerLine(null);
                          if (refocus) {
                            afterRender.current = () =>
                              rootRef.current?.querySelector<HTMLElement>(`[data-line="${line.id}"] .qe-item`)?.focus();
                          }
                        }}
                        state={state}
                        onChosen={focusQty}
                      />
                    ))}
                  </div>
                  <div className="qe-add-row">
                    <button type="button" className="qe-add" onClick={addItem}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      {t("addItem")}
                    </button>
                  </div>

                  <div className="qe-bottom">
                    <div className="qe-tot">
                      <div className="qe-tot-rows">
                        <div className="qe-trow">
                          <span className="qe-l">{t("subtotal")}</span>
                          <span />
                          <span className="qe-v">{formatMoney(result.subtotal, currency)}</span>
                        </div>
                        <div className="qe-trow">
                          <label className="qe-l" htmlFor={discountId}>{t("discount")}</label>
                          <span className="qe-ctl">
                            <input
                              id={discountId}
                              type="number"
                              min={0}
                              max={draft.discountMode === "pct" ? 100 : undefined}
                              step="any"
                              inputMode="decimal"
                              value={draft.discountValue}
                              onChange={(e) => state.setDiscountValue(e.target.value)}
                            />
                            <span className="qe-ctl-u" role="group" aria-label={t("discountType")}>
                              <button
                                type="button"
                                className={draft.discountMode === "pct" ? "qe-on" : undefined}
                                aria-pressed={draft.discountMode === "pct"}
                                title={t("discountPercent")}
                                aria-label={t("discountPercent")}
                                onClick={() => state.setDiscountMode("pct")}
                              >
                                %
                              </button>
                              <button
                                type="button"
                                className={draft.discountMode === "amount" ? "qe-on" : undefined}
                                aria-pressed={draft.discountMode === "amount"}
                                title={t("discountAmount")}
                                aria-label={t("discountAmount")}
                                onClick={() => state.setDiscountMode("amount")}
                              >
                                {currency}
                              </button>
                            </span>
                          </span>
                          <span className="qe-v qe-minus">− {formatMoney(result.discount, currency)}</span>
                        </div>
                        <div className="qe-trow">
                          <label className="qe-l" htmlFor={taxId}>{t("tax")}</label>
                          <span className="qe-ctl">
                            <input
                              id={taxId}
                              type="number"
                              min={0}
                              max={100}
                              step="any"
                              inputMode="decimal"
                              value={draft.taxPct}
                              onChange={(e) => state.setTaxPct(e.target.value)}
                            />
                            <span className="qe-ctl-u"><span>%</span></span>
                          </span>
                          <span className="qe-v qe-plus">+ {formatMoney(result.tax, currency)}</span>
                        </div>
                      </div>
                      <div className="qe-grand">
                        <span>{t("total")}</span>
                        <b>{formatMoney(result.grandTotal, currency)}</b>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="qe-empty">
                  <div className="qe-empty-in">
                    <div className="qe-empty-art">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="5" y="2.5" width="14" height="19" rx="2" />
                        <rect x="8" y="5.5" width="8" height="4" rx=".5" />
                        <path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01" />
                      </svg>
                    </div>
                    <div className="qe-empty-title">{t("emptyTitle")}</div>
                    <button type="button" className="qe-btn qe-btn-primary" data-empty-add onClick={addItem}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      {t("addItem")}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="qe-foot">
              {confirm !== null ? (
                <div className="qe-foot-confirm" role="alertdialog" aria-labelledby="qe-confirm-text">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 3 2 20h20z" />
                    <path d="M12 10v4M12 17h.01" />
                  </svg>
                  <span id="qe-confirm-text">{confirm === "clear" ? t("clearConfirm") : t("discardConfirm")}</span>
                  <span className="qe-spacer" />
                  <button
                    type="button"
                    className="qe-btn qe-btn-outline"
                    autoFocus
                    onClick={() => {
                      const kind = confirm;
                      setConfirm(null);
                      afterRender.current = () => (kind === "clear" ? clearBtnRef : attachBtnRef).current?.focus();
                    }}
                  >
                    {t("keepEditing")}
                  </button>
                  {confirm === "clear" ? (
                    <button type="button" className="qe-btn qe-btn-danger" onClick={confirmClear}>{t("clearAll")}</button>
                  ) : (
                    <button
                      type="button"
                      className="qe-btn qe-btn-danger"
                      onClick={() => {
                        setConfirm(null);
                        onClose();
                      }}
                    >
                      {t("discard")}
                    </button>
                  )}
                </div>
              ) : (
                <div className="qe-foot-main">
                  {!none && (
                    <button ref={clearBtnRef} type="button" className="qe-clear" onClick={() => setConfirm("clear")}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                        <path d="M3 3v5h5" />
                      </svg>
                      {t("clearAll")}
                    </button>
                  )}
                  <span className="qe-spacer" />
                  <button
                    ref={exportBtnRef}
                    type="button"
                    className={`qe-btn ${inquiryMode ? "qe-btn-outline" : "qe-btn-primary"}`}
                    disabled={result.priced === 0}
                    onClick={openExport}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
                    </svg>
                    {t("exportPdf")}
                  </button>
                  {inquiryMode && (
                    <button
                      ref={attachBtnRef}
                      type="button"
                      className="qe-btn qe-btn-primary"
                      disabled={result.priced === 0}
                      onClick={attach}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
                      </svg>
                      {inquiryMode.isUpdate ? t("updateEstimate") : t("attachToInquiry")}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
