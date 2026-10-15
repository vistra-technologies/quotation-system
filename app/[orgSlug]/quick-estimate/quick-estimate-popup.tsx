"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { SelectField } from "@/components/select-field";
import { SUPPORTED_CURRENCIES, type SupportedCurrency } from "@/lib/currency";
import { computeEstimate, isInvalidQty, type EstimateLineResult } from "@/lib/quick-estimate/estimate";
import { formatAmount, formatMoney } from "@/lib/quick-estimate/format";
import { toValueLines, type DraftLine } from "@/lib/quick-estimate/lines";
import type { EstimateType } from "@/lib/quick-estimate/palette";
import { ComponentChip } from "./component-chip";
import { ExportPreview } from "./export-preview";
import { ItemPicker } from "./item-picker";
import type { EstimateState } from "./use-estimate-state";
import { useFocusTrap } from "./use-focus-trap";
import "./quick-estimate.css";

interface QuickEstimatePopupProps {
  orgName: string;
  username: string;
  types: EstimateType[];
  state: EstimateState;
  /** Closes the popup; the caller returns focus to the calculator icon. */
  onClose: () => void;
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
export function QuickEstimatePopup({ orgName, username, types, state, onClose }: QuickEstimatePopupProps) {
  const t = useTranslations("quickEstimate");
  const { draft } = state;
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const clearBtnRef = useRef<HTMLButtonElement>(null);
  const exportBtnRef = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState<"edit" | "export">("edit");
  const [pickerLine, setPickerLine] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
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

  // Layered Esc. SelectField and the picker consume their own Esc (preventDefault), which is skipped here.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      if (pickerLine !== null) setPickerLine(null);
      else if (confirming) {
        setConfirming(false);
        afterRender.current = () => clearBtnRef.current?.focus();
      } else if (step === "export") backToEdit();
      else onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pickerLine, confirming, step, onClose]);

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

  function confirmClear() {
    state.clearLines();
    setConfirming(false);
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
          username={username}
          currency={currency}
          lines={valueLines}
          result={result}
          onBack={backToEdit}
        />
      ) : (
        <div
          className="qe-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
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
              <button type="button" className="qe-x" onClick={onClose} title={t("close")} aria-label={t("close")}>
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
                {state.prevCurrency !== null && (
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
              {confirming ? (
                <div className="qe-foot-confirm" role="alertdialog" aria-labelledby="qe-confirm-text">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 3 2 20h20z" />
                    <path d="M12 10v4M12 17h.01" />
                  </svg>
                  <span id="qe-confirm-text">{t("clearConfirm")}</span>
                  <span className="qe-spacer" />
                  <button
                    type="button"
                    className="qe-btn qe-btn-outline"
                    autoFocus
                    onClick={() => {
                      setConfirming(false);
                      afterRender.current = () => clearBtnRef.current?.focus();
                    }}
                  >
                    {t("keepEditing")}
                  </button>
                  <button type="button" className="qe-btn qe-btn-danger" onClick={confirmClear}>{t("clearAll")}</button>
                </div>
              ) : (
                <div className="qe-foot-main">
                  {!none && (
                    <button ref={clearBtnRef} type="button" className="qe-clear" onClick={() => setConfirming(true)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                        <path d="M3 3v5h5" />
                      </svg>
                      {t("clearAll")}
                    </button>
                  )}
                  <span className="qe-spacer" />
                  <button ref={exportBtnRef} type="button" className="qe-btn qe-btn-primary" disabled={result.priced === 0} onClick={() => setStep("export")}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
                    </svg>
                    {t("exportPdf")}
                  </button>
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
