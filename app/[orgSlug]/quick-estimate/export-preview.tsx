"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { SupportedCurrency } from "@/lib/currency";
import type { EstimateResult, ValueLine } from "@/lib/quick-estimate/estimate";
import { generateQuickEstimatePdf } from "@/lib/quick-estimate/pdf";
import { buildSheet, type SheetLabels } from "@/lib/quick-estimate/sheet";

interface ExportPreviewProps {
  orgName: string;
  currency: SupportedCurrency;
  lines: ValueLine[];
  result: EstimateResult;
  onBack: () => void;
}

const PREPARED_FOR_MAX = 80;

function localDateParts(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return { iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, label: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) };
}

/**
 * The export step (S33-11): a full-screen preview of the one-page estimate with "Prepared for" (max 80,
 * never sent anywhere) and Download. The preview and the PDF are built from the same `buildSheet`, so the
 * wording and numbers can't drift.
 */
export function ExportPreview({ orgName, currency, lines, result, onBack }: ExportPreviewProps) {
  const t = useTranslations("quickEstimate");
  const [preparedFor, setPreparedFor] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Fixed for the lifetime of this step, so the preview date and the file name can't disagree.
  const [today] = useState(() => localDateParts(new Date()));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const labels: SheetLabels = { subtotal: t("subtotal"), discount: t("discount"), tax: t("tax"), total: t("total") };
  const sheet = buildSheet(lines, result, currency, labels);
  const forName = preparedFor.trim();
  const metaLines = [today.label, currency];

  async function download() {
    setBusy(true);
    setFailed(false);
    try {
      await generateQuickEstimatePdf({
        orgName,
        title: t("pdfTitle"),
        preparedForLabel: t("pdfPreparedFor"),
        preparedFor: forName,
        metaLines,
        head: { item: t("pdfColItem"), qty: t("pdfColQty"), rate: t("pdfColRate"), amount: t("pdfColAmount") },
        sheet,
        disclaimer: t("disclaimer"),
        filename: `project-estimate-${today.iso}.pdf`,
      });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="qe-pdf-backdrop" role="dialog" aria-modal="true" aria-label={t("exportPdf")}>
      <div className="qe-pdf-wrap">
        <div className="qe-pdf-bar">
          <button type="button" className="qe-x" onClick={onBack} title={t("back")} aria-label={t("back")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <label className="qe-pdf-for">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
            <input
              ref={inputRef}
              value={preparedFor}
              maxLength={PREPARED_FOR_MAX}
              onChange={(e) => setPreparedFor(e.target.value)}
              placeholder={t("preparedFor")}
              aria-label={t("preparedFor")}
            />
          </label>
          <button type="button" className="qe-btn qe-btn-primary" onClick={download} disabled={busy}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
            </svg>
            {t("download")}
          </button>
        </div>
        {failed && (
          <div role="alert" style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>
            {t("exportFailed")}
          </div>
        )}

        <div className="qe-sheet">
          <div className="qe-s-top">
            <div>
              <div className="qe-s-org">{orgName}</div>
              <div className="qe-s-doc">{t("pdfTitle")}</div>
              <div className="qe-s-for" data-testid="qe-s-for">
                {t("pdfPreparedFor")}: {forName ? <span>{forName}</span> : <span className="qe-s-for-rule" aria-hidden="true" />}
              </div>
            </div>
            <div className="qe-s-meta">
              {metaLines.map((line, i) => (
                <div key={i}>{i === 0 ? <b>{line}</b> : line}</div>
              ))}
            </div>
          </div>
          <div className="qe-s-row qe-h">
            <span>#</span>
            <span>{t("pdfColItem")}</span>
            <span>{t("pdfColQty")}</span>
            <span>{t("pdfColRate")}</span>
            <span>{t("pdfColAmount")}</span>
          </div>
          <div className="qe-s-rows">
            {sheet.rows.map((r) => (
              <div key={r.n} className="qe-s-row">
                <span>{r.n}</span>
                <span>
                  <b>{r.name}</b>
                  {r.variant && <div className="qe-s-sub">{r.variant}</div>}
                </span>
                <span>{r.qty}</span>
                <span>{r.rate}</span>
                <span>{r.amount}</span>
              </div>
            ))}
          </div>
          <div className="qe-s-sum">
            {sheet.totals.map((row, i) => (
              <div key={i} className={row.grand ? "qe-g" : undefined}>
                <span>{row.label}</span>
                <span>{row.value}</span>
              </div>
            ))}
          </div>
          <div className="qe-s-note">{t("disclaimer")}</div>
        </div>
      </div>
    </div>
  );
}
