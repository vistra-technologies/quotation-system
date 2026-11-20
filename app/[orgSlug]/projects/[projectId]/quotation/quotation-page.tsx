"use client";

/**
 * Quotation page, wizard step 5 (Stage 38 Batch 4). The one state holder: `q` is the last quotation the server
 * returned, replaced by the response of every mutation (create, Refresh, Reset all prices, Renew, Save of the
 * money inputs), so the Grand total tile, the section totals, the totals panel and the PDF always agree and the
 * totals never change while a field is being typed (Q-D33). Permissions only hide controls here; every gate is
 * enforced by the API (S38-2, S38-9).
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Toast, useToast } from "@/components/toast";
import { apiErrorMessage } from "@/lib/api-error-message";
import { parseMoneyToCents } from "@/lib/money";
import type { CalculationProblemReport } from "@/lib/materials/problems";
import type { ConfigSnapshot } from "@/lib/config-snapshot";
import { renewedValidUntil, validityFrom } from "@/lib/quotation/meta";
import { buildQuotationPdf, type QuotationPdfLabels } from "@/lib/quotation/pdf-model";
import {
  chargesFormOf,
  chargesFormValid,
  chargesPatch,
  discountCapExceeded,
  editedLineCount,
  formatDate,
  formatMoney,
  isEditableLine,
  percentLabel,
  sectionsOf,
  type ChargesForm,
  type Kpis,
  type QuotationDto,
} from "@/lib/quotation/present";
import { ProblemPopup } from "../_problem-popup";
import { redirectToLogin } from "../design/login-redirect";
import {
  CreateState,
  QuotationBanners,
  QuotationHeader,
  QuotationKpis,
  QuotationLines,
  QuotationTotals,
  type LineEditCtl,
  type TotalsEdit,
} from "./_parts";

export interface QuotationPageProps {
  orgSlug: string;
  projectId: string;
  isSubdomain: boolean;
  /** Org-prefixed (path mode) or empty (subdomain mode) href base, from orgHref(). */
  base: string;
  orgName: string;
  projectName: string;
  projectNumber: number;
  projectLocation: string | null;
  company: string | null;
  endClient: string | null;
  initial: QuotationDto | null;
  /** The design is submitted and a finished calculation exists: Create is enabled. */
  canCreate: boolean;
  /** `Project.designSubmittedAt` is set (false after a design edit). */
  designSubmitted: boolean;
  kpis: Kpis | null;
  snapshot: ConfigSnapshot | null;
  canApplyDiscount: boolean;
  canExtend: boolean;
  /** An external user: the problem popup says "ask your admin" and has no Go link (Q-D33). */
  external: boolean;
}

type Action = "create" | "refresh" | "reset" | "renew" | "save" | "line";
type Dialog = "refresh" | "currency" | "reset" | "renew" | null;

interface Popup {
  report: CalculationProblemReport;
  title: string;
}

const TAILS: Record<Exclude<Action, "create" | "save" | "line">, string> = { refresh: "/refresh", reset: "/reset-prices", renew: "/renew" };

function formFrom(q: QuotationDto): ChargesForm {
  const base = chargesFormOf(q);
  return {
    transport: formatMoney(base.transport),
    otherCharges: formatMoney(base.otherCharges),
    discountType: base.discountType,
    discount: base.discountType === "PERCENT" ? percentLabel(base.discount) : formatMoney(base.discount),
    taxPercent: percentLabel(base.taxPercent),
  };
}

export function QuotationPage(props: QuotationPageProps) {
  const t = useTranslations("quotation");
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState<QuotationDto | null>(props.initial);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [form, setForm] = useState<ChargesForm | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // 38c: the line whose price popover is open, its typed price and the server message of a failed save.
  const [lineEdit, setLineEdit] = useState<{ code: string; draft: string } | null>(null);
  const [lineError, setLineError] = useState<string | null>(null);

  const url = (tail: string) => `/api/v1/orgs/${props.orgSlug}/projects/${props.projectId}/quotation${tail}`;
  const designHref = `${props.base}/projects/${props.projectId}/design`;
  const summaryHref = `${props.base}/projects/${props.projectId}/summary`;

  /** One request; returns the quotation on success, null when the outcome was shown (popup, error) or a redirect started. */
  async function send(action: Action, init: { method: string; tail: string; body?: unknown }, failure: string, popupTitle?: string, errorToStrip = false): Promise<QuotationDto | null> {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(url(init.tail), {
        method: init.method,
        ...(init.body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) } : {}),
      });
      if (res.status === 401) {
        redirectToLogin(props.orgSlug, props.isSubdomain);
        return null;
      }
      const body = (await res.json().catch(() => ({}))) as { quotation?: QuotationDto; ok?: boolean; problems?: unknown[]; error?: string };
      if (res.ok && body.quotation) return body.quotation;
      if (res.status === 422 && body.ok === false && Array.isArray(body.problems) && popupTitle) {
        setPopup({ report: body as unknown as CalculationProblemReport, title: popupTitle });
        return null;
      }
      if (res.status === 409 && action === "create") {
        // Someone created it first: show theirs.
        const again = await fetch(url(""));
        const data = (await again.json().catch(() => ({}))) as { quotation?: QuotationDto };
        if (again.ok && data.quotation) return data.quotation;
      }
      const message = apiErrorMessage(body, failure);
      if (action === "save") setSaveError(message);
      else if (action === "line" && !errorToStrip) setLineError(message);
      else setError(message);
      return null;
    } catch {
      const message = failure;
      if (action === "save") setSaveError(message);
      else if (action === "line" && !errorToStrip) setLineError(message);
      else setError(message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    const next = await send("create", { method: "POST", tail: "" }, t("errCreate"), t("popupCreateTitle"));
    if (!next) return;
    setQ(next);
    toast.show(t("toastCreated", { number: next.number }));
    router.refresh(); // the wizard breadcrumb reads hasQuotation from the project detail
  }

  async function runAction(action: "refresh" | "reset" | "renew") {
    const failure = { refresh: t("errRefresh"), reset: t("errReset"), renew: t("errRenew") }[action];
    const popupTitle = { refresh: t("popupRefreshTitle"), reset: t("popupResetTitle"), renew: undefined }[action];
    setDialog(null);
    const next = await send(action, { method: "POST", tail: TAILS[action] }, failure, popupTitle);
    if (!next) return;
    setQ(next);
    toast.show(
      { refresh: t("toastRefreshed"), reset: t("toastReset"), renew: t("toastRenewed", { validUntil: formatDate(next.validUntil) }) }[action],
    );
  }

  async function saveTotals() {
    if (!q || !form) return;
    const patch = chargesPatch(chargesFormOf(q), form);
    if (!patch) {
      setForm(null);
      return;
    }
    setSaveError(null);
    const next = await send("save", { method: "PATCH", tail: "", body: patch }, t("saveFailed"));
    if (!next) return;
    setQ(next);
    setForm(null);
    toast.show(t("toastSaved"));
  }

  /** One line, one request (Q-D33): set the typed price, or put the line back to its stored default. */
  async function saveLine(code: string, body: { unitPrice: string } | { reset: true }) {
    setLineError(null);
    // The popover shows its own error; a row-icon Reset has no popover open for that line, so its error goes to the page strip (M-2).
    const next = await send("line", { method: "PATCH", tail: "/lines", body: { code, ...body } }, t("lineSaveFailed"), undefined, lineEdit?.code !== code);
    if (!next) return;
    setQ(next);
    setLineEdit(null);
    toast.show("reset" in body ? t("toastLineReset") : t("toastLineSaved"));
  }

  async function exportPdf() {
    if (!q) return;
    setExporting(true);
    setError(null);
    try {
      const labels: QuotationPdfLabels = {
        title: t("pdfTitle"),
        preparedFor: t("pdfPreparedFor"),
        issued: (date) => t("pdfIssued", { date }),
        validUntil: (date) => t("pdfValidUntil", { date }),
        bandProject: t("pdfBandProject"),
        bandParties: t("pdfBandParties"),
        quotationNo: t("pdfQuotationNo"),
        projectName: t("pdfProjectName"),
        projectNo: t("pdfProjectNo"),
        location: t("pdfLocation"),
        preparedBy: t("pdfPreparedBy"),
        company: t("pdfCompany"),
        endClient: t("pdfEndClient"),
        item: t("pdfItem"),
        qty: t("pdfQty"),
        rate: (currency) => t("pdfRate", { currency }),
        amount: t("pdfAmount"),
        packOf: (size, unit) => t("pdfPackOf", { size, unit }),
        packs: (count) => `${count} ${count === "1" ? t("pdfPack") : t("pdfPacks")}`,
        linesTotal: t("linesTotal"),
        transport: t("transport"),
        otherCharges: t("otherCharges"),
        subtotal: t("subtotal"),
        discount: (percent) => (percent ? t("pdfDiscountPercent", { percent }) : t("pdfDiscount")),
        tax: (percent) => t("pdfTax", { percent }),
        total: t("pdfTotal"),
        footerPage: (page, total) => t("pdfFooterPage", { page, total }),
      };
      const input = buildQuotationPdf(
        q,
        {
          orgName: props.orgName,
          projectName: props.projectName,
          projectNumber: props.projectNumber,
          projectLocation: props.projectLocation,
          preparedBy: q.createdByName,
          company: props.company,
          endClient: props.endClient,
          snapshot: props.snapshot,
        },
        labels,
      );
      const { generateQuotationPdf } = await import("@/lib/quotation/pdf");
      await generateQuotationPdf(input);
    } catch {
      setError(t("errPdf"));
    } finally {
      setExporting(false);
    }
  }

  const canReset = !!q && (props.canApplyDiscount || !q.anyLineEdited);
  const refreshDisabled = !!q && q.designChanged && !props.designSubmitted;
  const openRefresh = () => setDialog(q?.currencyDiffers ? "currency" : "refresh");

  // The totals form (read-only first: no form until Edit).
  let totalsEdit: TotalsEdit | null = null;
  if (q && form) {
    const linesTotalCents = parseMoneyToCents(q.totals.linesTotal) ?? 0;
    totalsEdit = {
      form,
      setForm,
      saving: busy === "save",
      error: saveError,
      cap: discountCapExceeded(linesTotalCents, form),
      valid: chargesFormValid(form),
      changed: chargesPatch(chargesFormOf(q), form) !== null,
      onSave: () => void saveTotals(),
      onCancel: () => {
        setForm(null);
        setSaveError(null);
      },
    };
  }

  // Staff only: an external payload carries no range, so its lines are never editable (Q-D14, S38-9).
  const lineCtl: LineEditCtl | null =
    q && props.canApplyDiscount && !props.external
      ? {
          code: lineEdit?.code ?? null,
          draft: lineEdit?.draft ?? "",
          error: lineError,
          saving: busy === "line",
          busy: busy !== null,
          onOpen: (code) => {
            const line = q.lines.find((l) => l.code === code);
            if (!line || !isEditableLine(line)) return;
            setLineError(null);
            setLineEdit({ code, draft: formatMoney(line.unitPrice) });
          },
          onDraft: (draft) => {
            setLineError(null);
            setLineEdit((cur) => (cur ? { ...cur, draft } : cur));
          },
          onCancel: () => {
            setLineEdit(null);
            setLineError(null);
          },
          onSave: () => {
            if (lineEdit) void saveLine(lineEdit.code, { unitPrice: lineEdit.draft.replace(/,/g, "").trim() });
          },
          onReset: (code) => void saveLine(code, { reset: true }),
        }
      : null;

  const edited = q ? editedLineCount(q.lines) : 0;
  const now = new Date();

  let content: React.ReactNode;
  if (!q) {
    content = <CreateState canCreate={props.canCreate} creating={busy === "create"} designHref={designHref} onCreate={() => void create()} />;
  } else {
    content = (
      <>
        <QuotationHeader
          q={q}
          projectName={props.projectName}
          projectNumber={props.projectNumber}
          company={props.company}
          endClient={props.endClient}
          preparedBy={q.createdByName}
          canReset={canReset}
          canRenew={props.canExtend}
          refreshDisabled={refreshDisabled}
          busy={busy !== null}
          exporting={exporting}
          onRefresh={openRefresh}
          onReset={() => setDialog("reset")}
          onRenew={() => setDialog("renew")}
          onExport={() => void exportPdf()}
        />
        <QuotationBanners
          q={q}
          designNeedsSubmit={refreshDisabled}
          refreshDisabled={refreshDisabled}
          designHref={designHref}
          canReset={canReset}
          canRenew={props.canExtend}
          busy={busy !== null}
          onRefresh={openRefresh}
          onReset={() => setDialog("reset")}
          onRenew={() => setDialog("renew")}
          onRefreshCurrency={() => setDialog("currency")}
        />
        <QuotationKpis q={q} kpis={props.kpis} sectionCount={sectionsOf(q.lines, props.snapshot).length} />
        <QuotationLines q={q} snapshot={props.snapshot} edit={lineCtl} />
        <QuotationTotals q={q} canEdit={props.canApplyDiscount} edit={totalsEdit} onEdit={() => { setSaveError(null); setForm(formFrom(q)); }} />
      </>
    );
  }

  const validUntilText = q ? formatDate(q.validUntil) : "";
  const warnBlock = q && dialog === "currency" ? (
    <div className="mb-3 flex items-start gap-2 rounded-sm border border-status-pending-border bg-status-pending-bg px-3.5 py-2.5 text-sm font-semibold text-status-pending-text">
      <span>
        {edited > 0
          ? t("currencyWarnSome", { from: q.currency, to: q.projectCurrency, count: edited })
          : t("currencyWarnNone", { from: q.currency, to: q.projectCurrency })}
      </span>
    </div>
  ) : null;

  return (
    <div className="py-8">
      <div className="mb-6 rounded-md border border-border bg-bg-card p-5 shadow-card">
        {error ? (
          <div role="alert" data-testid="quotation-error" className="mb-4 rounded-sm border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3.5 py-2.5 text-[13px] font-semibold text-[var(--color-status-failed-text)]">
            {error}
          </div>
        ) : null}
        {content}
      </div>

      <div className="flex items-center justify-start">
        <Link
          href={summaryHref}
          className="inline-flex items-center rounded-sm border border-border bg-bg-white px-5 py-2.5 text-sm font-bold text-text-body hover:bg-primary-softer hover:text-text-heading"
        >
          ← Back
        </Link>
      </div>

      {q ? (
        <>
          <ConfirmDialog
            isOpen={dialog === "refresh"}
            title={t("refreshTitle")}
            message={t("refreshBody", { validUntil: validUntilText })}
            confirmLabel={t("actionRefresh")}
            confirmVariant="primary"
            pendingAction={busy === "refresh" ? "confirm" : null}
            onConfirm={() => void runAction("refresh")}
            onCancel={() => setDialog(null)}
          />
          <ConfirmDialog
            isOpen={dialog === "currency"}
            title={t("currencyTitle", { currency: q.projectCurrency })}
            message={
              <>
                {warnBlock}
                {t("currencyBody", { currency: q.projectCurrency })}
                {q.discountType === "FIXED" && parseMoneyToCents(q.discount) ? ` ${t("currencyFixedDiscount", { amount: formatMoney(q.discount), currency: q.currency })}` : ""}
                {` ${t("currencyValidUntil", { validUntil: validUntilText })}`}
              </>
            }
            confirmLabel={t("refreshIn", { currency: q.projectCurrency })}
            confirmVariant="primary"
            pendingAction={busy === "refresh" ? "confirm" : null}
            onConfirm={() => void runAction("refresh")}
            onCancel={() => setDialog(null)}
          />
          <ConfirmDialog
            isOpen={dialog === "reset"}
            title={t("resetTitle")}
            message={t("resetBody", { currency: q.currency, count: edited, validUntil: formatDate(validityFrom(now)) })}
            confirmLabel={t("actionResetPrices")}
            confirmVariant="primary"
            pendingAction={busy === "reset" ? "confirm" : null}
            onConfirm={() => void runAction("reset")}
            onCancel={() => setDialog(null)}
          />
          <ConfirmDialog
            isOpen={dialog === "renew"}
            title={t("renewTitle")}
            message={t("renewBody", { validUntil: formatDate(renewedValidUntil(new Date(q.validUntil), now)) })}
            confirmLabel={t("actionRenew")}
            confirmVariant="primary"
            pendingAction={busy === "renew" ? "confirm" : null}
            onConfirm={() => void runAction("renew")}
            onCancel={() => setDialog(null)}
          />
        </>
      ) : null}

      {popup ? (
        <ProblemPopup
          report={popup.report}
          title={popup.title}
          orgSlug={props.orgSlug}
          projectId={props.projectId}
          isSubdomain={props.isSubdomain}
          external={props.external}
          onClose={() => setPopup(null)}
        />
      ) : null}
      <Toast {...toast} />
    </div>
  );
}
