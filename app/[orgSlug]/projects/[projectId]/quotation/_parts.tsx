"use client";

/**
 * Quotation page pieces (Stage 38 Batch 4), built to the signed-off mockup B rev 3 (layout B: Grand total tile on
 * top, totals panel at the bottom; design-docs/mockups/quotation-page-2026-11-20/). Presentational only: the one
 * state holder is quotation-page.tsx, so every region re-renders from the single server response of a mutation.
 * Class strings are lifted from the mockup's class vocabulary (C.*). No range, edit marker or helper text on a row.
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, type ReactNode } from "react";
import {
  formatCents,
  formatDate,
  formatMoney,
  isEditableLine,
  isEditedLine,
  linePriceProblem,
  priceUnit,
  quantityParts,
  sectionTotalCents,
  sectionsOf,
  type ChargesForm,
  type Kpis,
  type EditableLine,
  type QuotationDto,
} from "@/lib/quotation/present";
import { lineRange } from "@/lib/quotation/line-edit";
import type { ConfigSnapshot } from "@/lib/config-snapshot";
import type { DiscountType } from "@/lib/quotation/types";

export const C = {
  btnS: "inline-flex items-center gap-2 whitespace-nowrap rounded-sm border border-border bg-bg-white px-4 py-2 text-[13px] font-bold text-text-body hover:bg-primary-softer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-bg-white",
  btnP: "inline-flex items-center gap-2 whitespace-nowrap rounded-sm bg-primary px-4 py-2 text-[13px] font-bold text-text-on-primary hover:bg-primary-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary",
  input: "h-[34px] w-full rounded-sm border px-3 text-sm text-text-heading outline-none focus:border-primary focus:shadow-[0_0_0_2px_rgba(78,127,88,.15)]",
  inOk: "border-border bg-bg-white",
  inErr: "border-[var(--color-danger-border)] bg-[#FFF5F5]",
  err: "mt-1 text-xs font-bold text-[var(--color-status-failed-text)]",
  th: "whitespace-nowrap border border-border bg-primary-softer px-2.5 py-1.5 text-[11px] font-extrabold uppercase tracking-wide text-text-heading",
  td: "border border-border bg-bg-white px-2.5 py-1.5 align-top text-text-body",
  tdTot: "border border-border bg-bg-card px-2.5 py-1.5 font-extrabold text-text-heading",
};

const ICON = "h-[15px] w-[15px]";
const svgProps = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const RefreshIcon = ({ spin }: { spin?: boolean }) => (
  <svg {...svgProps} className={`${ICON} ${spin ? "animate-spin motion-reduce:animate-none" : ""}`}>
    <path d="M23 4v6h-6M1 20v-6h6" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);
const DownloadIcon = () => (
  <svg {...svgProps} className={ICON}>
    <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
  </svg>
);
const CalendarIcon = () => (
  <svg {...svgProps} className={ICON}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);
const AlertIcon = () => (
  <svg {...svgProps} className="mt-px h-4 w-4 shrink-0">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v4M12 16h.01" />
  </svg>
);
export const Spinner = () => (
  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none" aria-hidden="true" />
);

// ─── Header + meta band ──────────────────────────────────────────────────────

export interface HeaderProps {
  q: QuotationDto;
  projectName: string;
  projectNumber: number;
  company: string | null;
  endClient: string | null;
  preparedBy: string | null;
  canReset: boolean;
  canRenew: boolean;
  /** No OK calculation: Refresh is disabled until the design is submitted again. */
  refreshDisabled: boolean;
  busy: boolean;
  exporting: boolean;
  onRefresh: () => void;
  onReset: () => void;
  onRenew: () => void;
  onExport: () => void;
}

function Meta({ label, children, className, title, testId }: { label: string; children: ReactNode; className?: string; title?: string; testId?: string }) {
  return (
    <div data-testid={testId} className={`flex min-w-0 flex-col gap-px ${className ?? ""}`}>
      <span className="text-[10.5px] font-extrabold uppercase tracking-wide text-text-muted">{label}</span>
      <span className="truncate text-xs font-bold text-text-heading" title={title}>
        {children}
      </span>
    </div>
  );
}

const Divider = () => <div className="h-[30px] w-px flex-shrink-0 bg-border" aria-hidden="true" />;

export function QuotationHeader(p: HeaderProps) {
  const t = useTranslations("quotation");
  const { q } = p;
  const expired = q.status === "EXPIRED";
  const metaItems: ReactNode[] = [
    <Meta key="i" label={t("metaIssued")}>{formatDate(q.createdAt)}</Meta>,
    <Meta key="v" label={t("metaValidUntil")}>
      {expired ? <span className="text-status-failed-text">{formatDate(q.validUntil)}</span> : formatDate(q.validUntil)}
    </Meta>,
    <Meta key="c" label={t("metaCurrency")}>{q.currency}</Meta>,
  ];
  if (p.company) metaItems.push(<Meta key="co" label={t("metaCompany")} className="max-w-[200px]" title={p.company}>{p.company}</Meta>);
  if (p.endClient) metaItems.push(<Meta key="ec" label={t("metaEndClient")} className="max-w-[220px]" title={p.endClient}>{p.endClient}</Meta>);
  if (p.preparedBy) metaItems.push(<Meta key="pb" label={t("metaPreparedBy")} testId="quotation-prepared-by">{p.preparedBy}</Meta>);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 data-testid="quotation-number" className="font-mono text-xl font-semibold tracking-tight text-text-heading">{q.number}</h1>
            <span
              data-testid="quotation-status"
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${expired ? "bg-status-failed-bg text-status-failed-text" : "bg-status-refunded-bg text-status-refunded-text"}`}
            >
              {expired ? t("statusExpired") : t("statusDraft")}
            </span>
            {q.currencyDiffers ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-status-pending-border bg-status-pending-bg px-2.5 py-0.5 text-[11px] font-extrabold text-status-pending-text">
                {t("projectCurrencyChip", { currency: q.projectCurrency })}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[13px] text-text-muted">
            <span className="font-bold text-text-body">{p.projectName}</span> (#{p.projectNumber})
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={p.refreshDisabled || p.busy}
            title={p.refreshDisabled ? t("submitFirstTitle") : undefined}
            onClick={p.onRefresh}
            className={C.btnS}
          >
            <RefreshIcon />
            {t("actionRefresh")}
          </button>
          {p.canReset ? (
            <button type="button" disabled={p.busy} onClick={p.onReset} className={C.btnS}>
              {t("actionResetPrices")}
            </button>
          ) : null}
          {p.canRenew ? (
            <button type="button" disabled={p.busy} onClick={p.onRenew} className={C.btnS}>
              <CalendarIcon />
              {t("actionRenew")}
            </button>
          ) : null}
          <button type="button" disabled={p.exporting} onClick={p.onExport} className={C.btnP}>
            <DownloadIcon />
            {p.exporting ? t("exporting") : t("actionExportPdf")}
          </button>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-md border border-border bg-bg-white px-5 py-3">
        {metaItems.flatMap((m, i) => (i === 0 ? [m] : [<Divider key={`d${i}`} />, m]))}
      </div>
    </>
  );
}

// ─── Banners ─────────────────────────────────────────────────────────────────

const SM_BTN =
  "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-sm border border-border bg-bg-white px-3 text-xs font-bold text-text-body hover:bg-primary-softer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50";

function Banner({ tone, testId, children, actions }: { tone: "warn" | "bad" | "info"; testId: string; children: ReactNode; actions?: ReactNode }) {
  const toneCls = {
    warn: "border-status-pending-border bg-status-pending-bg text-status-pending-text",
    bad: "border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] text-[var(--color-status-failed-text)]",
    info: "border-[#9fd8ef] bg-status-shipped-bg text-status-shipped-text",
  }[tone];
  return (
    <div role="status" data-testid={testId} className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sm border px-3.5 py-2.5 text-[13px] font-semibold ${toneCls}`}>
      <AlertIcon />
      <span className="min-w-0 flex-1">{children}</span>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  );
}

export interface BannersProps {
  q: QuotationDto;
  /** The design changed and the project has no calculation to refresh from: the action is Go to Design. */
  designNeedsSubmit: boolean;
  /** No OK calculation: every Refresh entry point is disabled (same rule as the header button). */
  refreshDisabled: boolean;
  designHref: string;
  canReset: boolean;
  canRenew: boolean;
  busy: boolean;
  onRefresh: () => void;
  onReset: () => void;
  onRenew: () => void;
  onRefreshCurrency: () => void;
}

export function QuotationBanners(p: BannersProps) {
  const t = useTranslations("quotation");
  const { q } = p;
  const expired = q.status === "EXPIRED";
  const showAny = q.designChanged || expired || q.currencyDiffers;
  if (!showAny) return null;
  const expiredActions = (p.canReset || p.canRenew) ? (
    <>
      {p.canReset ? <button type="button" disabled={p.busy} onClick={p.onReset} className={SM_BTN}>{t("actionResetPrices")}</button> : null}
      {p.canRenew ? <button type="button" disabled={p.busy} onClick={p.onRenew} className={SM_BTN}>{t("actionRenew")}</button> : null}
    </>
  ) : null;
  return (
    <div className="mt-4 flex flex-col gap-2">
      {q.designChanged ? (
        p.designNeedsSubmit ? (
          <Banner tone="warn" testId="quotation-banner-design" actions={<Link href={p.designHref} className={SM_BTN}>{t("goToDesign")}</Link>}>
            {t("bannerDesignNoCalc")}
          </Banner>
        ) : (
          <Banner
            tone="warn"
            testId="quotation-banner-design"
            actions={<button type="button" disabled={p.busy} onClick={p.onRefresh} className={SM_BTN}><RefreshIcon />{t("actionRefresh")}</button>}
          >
            {t("bannerDesign")}
          </Banner>
        )
      ) : null}
      {expired ? (
        <Banner tone="bad" testId="quotation-banner-expired" actions={expiredActions}>
          {expiredActions ? t("bannerExpired", { date: formatDate(q.validUntil) }) : t("bannerExpiredAsk", { date: formatDate(q.validUntil) })}
        </Banner>
      ) : null}
      {q.currencyDiffers ? (
        <Banner
          tone="info"
          testId="quotation-banner-currency"
          actions={<button type="button" disabled={p.busy || p.refreshDisabled} title={p.refreshDisabled ? t("submitFirstTitle") : undefined} onClick={p.onRefreshCurrency} className={SM_BTN}><RefreshIcon />{t("refreshIn", { currency: q.projectCurrency })}</button>}
        >
          {t("bannerCurrency", { projectCurrency: q.projectCurrency, currency: q.currency })}
        </Banner>
      ) : null}
    </div>
  );
}

// ─── KPI tiles (unpriced, Q-D1) + Grand total ────────────────────────────────

function Tile({ label, value, unit, sub, hi, testId }: { label: string; value: string; unit: string; sub: string; hi?: boolean; testId?: string }) {
  return (
    <div data-testid={testId} className={`rounded-sm border px-4 py-3 ${hi ? "border-primary-soft bg-primary-softer" : "border-border bg-bg-white"}`}>
      <div className="text-[11px] font-extrabold uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="text-xl font-extrabold tabular-nums text-text-heading">{value}</span>
        <span className="text-[12.5px] text-text-muted">{unit}</span>
      </div>
      <div className="mt-0.5 text-xs text-text-muted">{sub}</div>
    </div>
  );
}

export function QuotationKpis({ q, kpis, sectionCount }: { q: QuotationDto; kpis: Kpis | null; sectionCount: number }) {
  const t = useTranslations("quotation");
  const sub =
    q.discountType === "PERCENT"
      ? t("kpiAfterPercent", { discount: stripZeros(q.discount), tax: stripZeros(q.taxPercent) })
      : t("kpiAfterFixed", { tax: stripZeros(q.taxPercent) });
  return (
    <div className={`mt-5 grid gap-3 ${kpis ? "grid-cols-4" : "grid-cols-2"}`}>
      {kpis ? (
        <>
          <Tile label={t("kpiGlass")} value={kpis.glassM2.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} unit="m²" sub={t("kpiGlassTypes", { count: kpis.glassTypes })} />
          <Tile label={t("kpiDoors")} value={String(kpis.doors)} unit={t("kpiPcs")} sub={t("kpiDoorTypes", { count: kpis.doorTypes })} />
        </>
      ) : null}
      <Tile label={t("kpiLines")} value={String(q.lines.length)} unit={t("kpiItems")} sub={t("kpiSections", { count: sectionCount })} />
      <Tile testId="quotation-grand-total-tile" hi label={t("kpiGrandTotal")} value={formatMoney(q.totals.grandTotal)} unit={q.currency} sub={sub} />
    </div>
  );
}

function stripZeros(fixed: string): string {
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

// ─── Lines ledger (sections from the data, S38-D8) ───────────────────────────

/** The line price edit controller (38c): present only for an internal user holding APPLY_DISCOUNT (Q-D14). */
export interface LineEditCtl {
  /** The line whose popover is open (read-only first: null until the pencil is clicked). */
  code: string | null;
  draft: string;
  /** The server message for the last failed save (400 range, 409, 500), shown in the popover. */
  error: string | null;
  saving: boolean;
  /** Any quotation request in flight: row controls wait. */
  busy: boolean;
  onOpen: (code: string) => void;
  onDraft: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onReset: (code: string) => void;
}

const UndoIcon = () => (
  <svg {...svgProps} className="h-[13px] w-[13px]">
    <path d="M1 4v6h6" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </svg>
);
const PencilIcon = () => (
  <svg {...svgProps} className="h-[13px] w-[13px]">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const ICON_BTN =
  "flex h-6 w-6 items-center justify-center rounded-sm text-text-muted hover:bg-bg-hover hover:text-text-heading focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50";

/** The row popover (mockup B rev 3, line edit 2): the allowed range and the validation error live here, never on the row. */
function LinePopover({ line, currency, edit }: { line: EditableLine; currency: string; edit: LineEditCtl }) {
  const t = useTranslations("quotation");
  const ref = useRef<HTMLDivElement>(null);
  const { onCancel } = edit;
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onCancel]);

  const range = lineRange(line);
  const check = linePriceProblem(line, edit.draft);
  const rangeText = range.max === null ? t("popoverRangeUp", { min: range.min }) : t("popoverRange", { min: range.min, max: range.max });
  const problemText =
    check.problem === "invalid"
      ? t("popoverInvalid")
      : check.problem === "range"
        ? range.max === null
          ? t("popoverRangeErrorUp", { min: range.min })
          : t("popoverRangeError", { min: range.min, max: range.max })
        : null;
  const shownError = problemText ?? edit.error;
  const unchanged = check.cents !== null && formatMoney(edit.draft) === formatMoney(line.unitPrice);
  const edited = isEditedLine(line);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t("popoverLabel", { code: line.code })}
      data-testid="quotation-line-popover"
      className="absolute right-0 top-full z-20 mt-1.5 w-[320px] rounded-md border border-border bg-bg-white p-4 text-left shadow-[0_8px_24px_-8px_rgba(27,40,30,.18)]"
    >
      <div className="font-mono text-[11.5px] text-text-muted">{line.code}</div>
      <div className="line-clamp-1 text-[13px] font-extrabold text-text-heading">{line.name}</div>
      <label className="mb-1.5 mt-3 block text-xs font-extrabold text-text-heading" htmlFor={`line-price-${line.code}`}>
        {t("popoverUnitPrice")}
      </label>
      <div className="flex">
        <input
          id={`line-price-${line.code}`}
          data-testid="quotation-line-input"
          value={edit.draft}
          inputMode="decimal"
          autoFocus
          aria-invalid={shownError ? true : undefined}
          onChange={(e) => edit.onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") edit.onCancel();
            if (e.key === "Enter" && !check.problem && !unchanged && !edit.busy) edit.onSave();
          }}
          className={`${C.input} h-8 rounded-r-none px-2 text-right text-[13px] tabular-nums ${shownError ? C.inErr : C.inOk}`}
        />
        <span className="flex h-8 items-center whitespace-nowrap rounded-r-sm border border-l-0 border-border bg-bg-subtle px-2 text-[11.5px] font-bold text-text-muted">
          {currency}/{priceUnit(line)}
        </span>
      </div>
      {shownError ? (
        <p role="alert" data-testid="quotation-line-error" className={C.err}>
          {shownError}
        </p>
      ) : (
        <p data-testid="quotation-line-range" className="mt-1 text-[11px] tabular-nums text-text-muted">
          {rangeText}
        </p>
      )}
      <div className="mt-3.5 flex items-center gap-2">
        {edited ? (
          <button
            type="button"
            data-testid="quotation-line-popover-reset"
            disabled={edit.busy}
            onClick={() => edit.onReset(line.code)}
            className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-sm px-2 text-xs font-bold text-primary-dark hover:bg-primary-softer focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
          >
            <UndoIcon />
            {t("popoverResetTo", { price: formatMoney(line.defaultPrice) })}
          </button>
        ) : null}
        <span className="flex-1" />
        <button
          type="button"
          data-testid="quotation-line-cancel"
          onClick={edit.onCancel}
          className="inline-flex h-8 items-center rounded-sm border border-border bg-bg-white px-3 text-xs font-bold text-text-body hover:bg-bg-hover"
        >
          {t("popoverCancel")}
        </button>
        <button
          type="button"
          data-testid="quotation-line-save"
          disabled={!!check.problem || unchanged || edit.busy}
          onClick={edit.onSave}
          className="inline-flex h-8 items-center rounded-sm border border-primary-dark bg-primary px-3 text-xs font-bold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("popoverSave")}
        </button>
      </div>
    </div>
  );
}

/**
 * The Unit price cell. Always the bold amount plus the muted currency/unit, never the range (Q-D34). Staff with
 * APPLY_DISCOUNT additionally get the Edited tag, the per-line Reset icon (edited lines) and the pencil that opens the popover.
 */
function UnitPriceCell({ line, currency, edit }: { line: QuotationDto["lines"][number]; currency: string; edit: LineEditCtl | null }) {
  const t = useTranslations("quotation");
  const amount = (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className="font-extrabold tabular-nums text-text-heading">{formatMoney(line.unitPrice)}</span>
      <span className="text-[11.5px] text-text-muted">{currency}/{priceUnit(line)}</span>
    </span>
  );
  if (!edit || !isEditableLine(line)) return <div className="text-right">{amount}</div>;

  const edited = isEditedLine(line);
  const open = edit.code === line.code;
  const def = formatMoney(line.defaultPrice);
  return (
    <div className="relative flex items-center justify-end gap-1.5">
      <div className="flex items-center justify-end gap-1.5 text-right">
        {edited ? (
          <span
            data-testid="quotation-line-edited"
            title={t("editedTagTitle", { price: def, currency })}
            className="inline-flex h-[18px] items-center rounded-[4px] bg-status-pending-bg px-1.5 text-[10.5px] font-extrabold text-status-pending-text"
          >
            {t("editedTag")}
          </span>
        ) : null}
        {amount}
      </div>
      <div className="flex w-[52px] justify-end gap-0.5">
        {edited ? (
          <button
            type="button"
            data-testid="quotation-line-reset"
            disabled={edit.busy}
            aria-label={t("resetLineLabel", { code: line.code, price: def, currency })}
            title={t("resetLineTitle", { price: def })}
            onClick={() => edit.onReset(line.code)}
            className={ICON_BTN}
          >
            <UndoIcon />
          </button>
        ) : null}
        <button
          type="button"
          data-testid="quotation-line-edit"
          disabled={edit.busy}
          aria-label={t("editPriceLabel", { code: line.code })}
          onClick={() => edit.onOpen(line.code)}
          className={`${ICON_BTN} ${open ? "bg-primary-softer text-primary-dark" : ""}`}
        >
          <PencilIcon />
        </button>
      </div>
      {open ? <LinePopover line={line} currency={currency} edit={edit} /> : null}
    </div>
  );
}

export function QuotationLines({ q, snapshot, edit = null }: { q: QuotationDto; snapshot: ConfigSnapshot | null; edit?: LineEditCtl | null }) {
  const t = useTranslations("quotation");
  const sections = sectionsOf(q.lines, snapshot);
  // Numbering runs across sections: each section starts after the lines of the ones before it.
  const starts = sections.map((_, i) => sections.slice(0, i).reduce((sum, sec) => sum + sec.lines.length, 0));
  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center gap-2 text-[15px] font-extrabold text-text-heading">
        <span className="h-4 w-1 rounded-sm bg-primary" aria-hidden="true" />
        {t("linesTitle")}
      </div>
      <div className="rounded-sm border border-border bg-bg-white">
        <table className="w-full border-collapse text-[12.5px] [font-variant-numeric:tabular-nums]">
          {sections.map((sec, si) => (
            <tbody key={sec.code} data-testid="quotation-section" data-slot={sec.code}>
              <tr>
                <th className={`${C.th} w-9 text-center`}>{t("colNumber")}</th>
                <th className={`${C.th} text-left`}>{t("colCode")}</th>
                <th className={`${C.th} text-left`}>{sec.title}</th>
                <th className={`${C.th} text-right`}>{t("colQty")}</th>
                <th className={`${C.th} text-right`}>{t("colUnitPrice")}</th>
                <th className={`${C.th} text-right`}>{t("colAmount", { currency: q.currency })}</th>
              </tr>
              {sec.lines.map((line, li) => {
                const n = starts[si] + li + 1;
                const qty = quantityParts(line);
                return (
                  <tr key={line.code} data-testid="quotation-line" data-code={line.code} className="hover:[&>td]:bg-bg-page">
                    <td className={`${C.td} text-center text-text-muted`}>{n}</td>
                    <td className={`${C.td} whitespace-nowrap font-mono text-xs text-text-heading`}>{line.code}</td>
                    <td className={C.td}><div className="line-clamp-2 text-text-heading">{line.name}</div></td>
                    <td className={`${C.td} whitespace-nowrap text-right tabular-nums text-text-heading`}>
                      {qty.main} <span className="text-text-muted">{qty.muted}</span>
                    </td>
                    <td className={C.td}>
                      <UnitPriceCell line={line} currency={q.currency} edit={edit} />
                    </td>
                    <td className={`${C.td} whitespace-nowrap text-right font-semibold tabular-nums text-text-heading`}>{formatMoney(line.amount)}</td>
                  </tr>
                );
              })}
              <tr>
                <td colSpan={5} className={C.tdTot}>{t("sectionTotal", { title: sec.title })}</td>
                <td className={`${C.tdTot} text-right tabular-nums`}>{formatCents(sectionTotalCents(sec.lines))}</td>
              </tr>
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}

// ─── Totals (read-only first, Edit for APPLY_DISCOUNT; values change after Save only) ─────────────────────────────

export interface TotalsEdit {
  form: ChargesForm;
  setForm: (next: ChargesForm) => void;
  saving: boolean;
  error: string | null;
  /** Largest allowed fixed discount when the typed one is above the subtotal (Q-D33), else null. */
  cap: string | null;
  valid: boolean;
  changed: boolean;
  onSave: () => void;
  onCancel: () => void;
}

function MoneyField({ label, value, suffix, onChange, invalid, disabled }: { label: string; value: string; suffix: string; onChange: (v: string) => void; invalid?: boolean; disabled?: boolean }) {
  return (
    <div className="flex w-[170px]">
      <input
        value={value}
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid ? true : undefined}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`${C.input} h-8 rounded-r-none px-2 text-right text-[13px] tabular-nums ${invalid ? C.inErr : C.inOk}`}
      />
      <span className="flex h-8 w-11 items-center justify-center rounded-r-sm border border-l-0 border-border bg-bg-subtle text-[11.5px] font-bold text-text-muted">{suffix}</span>
    </div>
  );
}

function DiscountToggle({ type, currency, onChange, disabled }: { type: DiscountType; currency: string; onChange: (t: DiscountType) => void; disabled?: boolean }) {
  const t = useTranslations("quotation");
  const seg = (on: boolean, value: DiscountType, label: string) => (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={() => onChange(value)}
      className={`h-8 px-2.5 text-xs font-bold first:rounded-l-sm last:rounded-r-sm ${on ? "bg-primary text-white" : "bg-bg-white text-text-body hover:bg-bg-hover"}`}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label={t("discountType")} className="flex shrink-0 overflow-hidden rounded-sm border border-border-strong">
      {seg(type === "PERCENT", "PERCENT", "%")}
      {seg(type === "FIXED", "FIXED", currency)}
    </div>
  );
}

export function QuotationTotals({ q, canEdit, edit, onEdit }: { q: QuotationDto; canEdit: boolean; edit: TotalsEdit | null; onEdit: () => void }) {
  const t = useTranslations("quotation");
  const tt = q.totals;
  const row = (label: string, value: string, cls?: string, testId?: string) => (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 ${cls ?? ""}`}>
      <dt className="text-[13px]">{label}</dt>
      <dd data-testid={testId} className="text-[13px] tabular-nums">{value}</dd>
    </div>
  );
  const discountLabel = q.discountType === "PERCENT" ? t("discountPercent", { percent: stripZeros(q.discount) }) : t("discount");
  return (
    <div className="mt-5 grid grid-cols-[minmax(0,1fr)_400px] items-start gap-5">
      <div />
      <section data-testid="quotation-totals" aria-labelledby="quotation-totals-h" className="rounded-md border border-border bg-bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 id="quotation-totals-h" className="text-[15px] font-extrabold text-text-heading">{t("totalsTitle")}</h2>
          {canEdit && !edit ? (
            <button type="button" onClick={onEdit} className={`${C.btnS} h-8 px-3 py-0 text-xs`}>{t("edit")}</button>
          ) : null}
        </div>
        {edit ? (
          <div className="px-4 py-2">
            <div className="flex items-baseline justify-between gap-4 py-1.5 text-[13px]">
              <span>{t("linesTotal")}</span>
              <span className="tabular-nums">{formatMoney(tt.linesTotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 py-1.5">
              <label className="text-[13px] font-bold text-text-heading">{t("transport")}</label>
              <MoneyField label={t("transport")} value={edit.form.transport} suffix={q.currency} disabled={edit.saving} onChange={(v) => edit.setForm({ ...edit.form, transport: v })} />
            </div>
            <div className="flex items-center justify-between gap-3 py-1.5">
              <label className="text-[13px] font-bold text-text-heading">{t("otherCharges")}</label>
              <MoneyField label={t("otherCharges")} value={edit.form.otherCharges} suffix={q.currency} disabled={edit.saving} onChange={(v) => edit.setForm({ ...edit.form, otherCharges: v })} />
            </div>
            <div className="flex items-center justify-between gap-3 py-1.5">
              <label className="text-[13px] font-bold text-text-heading">{t("discount")}</label>
              <div className="flex items-center gap-2">
                <DiscountToggle type={edit.form.discountType} currency={q.currency} disabled={edit.saving} onChange={(d) => edit.setForm({ ...edit.form, discountType: d })} />
                <MoneyField label={t("discount")} value={edit.form.discount} suffix={edit.form.discountType === "PERCENT" ? "%" : q.currency} invalid={!!edit.cap} disabled={edit.saving} onChange={(v) => edit.setForm({ ...edit.form, discount: v })} />
              </div>
            </div>
            {edit.cap ? <p role="alert" data-testid="discount-cap-error" className={`${C.err} text-right`}>{t("discountCap", { max: edit.cap })}</p> : null}
            <div className="flex items-center justify-between gap-3 py-1.5">
              <label className="text-[13px] font-bold text-text-heading">{t("tax")}</label>
              <MoneyField label={t("taxPercentLabel")} value={edit.form.taxPercent} suffix="%" disabled={edit.saving} onChange={(v) => edit.setForm({ ...edit.form, taxPercent: v })} />
            </div>
            {edit.error ? (
              <div role="alert" className="mt-3 flex items-start gap-2 rounded-sm border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2.5 text-xs font-semibold text-[var(--color-status-failed-text)]">
                <AlertIcon />
                <span>{edit.error}</span>
              </div>
            ) : null}
            <div className="mt-3 flex justify-end gap-2 pb-2">
              <button type="button" disabled={edit.saving} onClick={edit.onCancel} className={C.btnS}>{t("cancel")}</button>
              <button type="button" disabled={edit.saving || !edit.valid || !!edit.cap || !edit.changed} onClick={edit.onSave} className={C.btnP}>
                {edit.saving ? <><Spinner />{t("saving")}</> : t("save")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <dl className="px-4 py-2 text-text-body">
              {row(t("linesTotal"), formatMoney(tt.linesTotal))}
              {row(t("transport"), formatMoney(q.transport))}
              {row(t("otherCharges"), formatMoney(q.otherCharges))}
              {row(t("subtotal"), formatMoney(tt.subtotal), "mt-1 border-t border-border pt-2.5 font-extrabold text-text-heading", "totals-subtotal")}
              {row(discountLabel, `−${formatMoney(tt.discountAmount)}`)}
              {row(t("taxWithPercent", { percent: stripZeros(q.taxPercent) }), `+${formatMoney(tt.taxAmount)}`)}
            </dl>
            <div className="flex items-baseline justify-between gap-4 rounded-b-md border-t border-primary-soft bg-primary-softer px-4 py-3">
              <span className="text-sm font-extrabold text-text-heading">{t("grandTotal")}</span>
              <span className="inline-flex items-baseline gap-1.5">
                <span data-testid="totals-grand" className="text-lg font-extrabold tabular-nums text-text-heading">{formatMoney(tt.grandTotal)}</span>
                <span className="text-[12.5px] text-text-muted">{q.currency}</span>
              </span>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ─── Empty and blocked states ────────────────────────────────────────────────

const DOC_PATHS = ["M14 2.5H6.8a1.8 1.8 0 0 0-1.8 1.8v15.4a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8V8.3z", "M14 2.5v5.8h5.2", "M8 13h8M8 17h5"];

function EmptyBox({ icon, tone, title, children, testId }: { icon: "doc" | "grid" | "lock"; tone?: string; title: string; children?: ReactNode; testId: string }) {
  return (
    <div data-testid={testId} className="rounded-md border border-dashed border-border bg-bg-white px-6 py-16 text-center">
      <div className={`mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-[10px] ${tone ?? "bg-primary-softer text-primary"}`} aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {icon === "doc" ? DOC_PATHS.map((d) => <path key={d} d={d} />) : null}
          {icon === "grid" ? (<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 3v18M13 9v3M17 9v5" /></>) : null}
          {icon === "lock" ? (<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>) : null}
        </svg>
      </div>
      <p className="text-sm font-bold text-text-heading">{title}</p>
      {children}
    </div>
  );
}

const GHOST_LINK = "inline-flex items-center rounded-sm border border-border bg-bg-white px-4 py-2 text-xs font-bold text-text-body hover:bg-primary-softer";

export function CreateState({ canCreate, creating, designHref, onCreate }: { canCreate: boolean; creating: boolean; designHref: string; onCreate: () => void }) {
  const t = useTranslations("quotation");
  if (!canCreate) {
    return (
      <EmptyBox testId="quotation-empty-nocalc" icon="grid" title={t("emptyNoCalc")}>
        <div className="mt-4 flex justify-center gap-2.5">
          <button type="button" disabled className={C.btnP}>{t("create")}</button>
          <Link href={designHref} className={GHOST_LINK}>{`‹ ${t("goToDesign")}`}</Link>
        </div>
      </EmptyBox>
    );
  }
  return (
    <EmptyBox testId="quotation-empty-create" icon="doc" title={t("emptyNone")}>
      <button type="button" disabled={creating} aria-busy={creating || undefined} onClick={onCreate} className={`${C.btnP} mt-4 disabled:opacity-80`}>
        {creating ? <><Spinner />{t("creating")}</> : t("create")}
      </button>
    </EmptyBox>
  );
}

export function NoAccessState({ summaryHref }: { summaryHref: string }) {
  const t = useTranslations("quotation");
  return (
    <EmptyBox testId="quotation-no-access" icon="lock" tone="bg-bg-subtle text-text-muted" title={t("noAccess")}>
      <Link href={summaryHref} className={`${GHOST_LINK} mt-4`}>{t("backToSummary")}</Link>
    </EmptyBox>
  );
}
