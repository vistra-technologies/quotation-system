import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { formatBudget } from "@/lib/format-currency";
import { dismissInquiry } from "../actions";
import { StartProjectButton } from "./start-project-button";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

interface InquiryDetail {
  id: string;
  inquiryNumber: number;
  companyInquiryNumber: number | null;
  name: string;
  destinationCountry: string;
  currency: string;
  projectLocation: string | null;
  status: string;
  createdAt: string;
  externalCompany: { id: string; name: string } | null;
  createdBy: { id: string; username: string };
  // Stage 14 Batch B — extended intake fields
  submissionDate: string | null;
  projectDeadline: string | null;
  projectBudget: string | null;
  mainContractorName: string | null;
  interiorContractorName: string | null;
  mainConsultantName: string | null;
  interiorConsultantName: string | null;
  endClientName: string | null;
  endClientPhone: string | null;
  endClientEmail: string | null;
  endClientAddressLine1: string | null;
  endClientAddressLine2: string | null;
  endClientCity: string | null;
  endClientState: string | null;
  endClientGstNumber: string | null;
}

/** Shared read-only field renderer for the 3-card detail layout. */
function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">{label}</p>
      <p className="mt-1 text-sm text-text-body">
        {value ?? <span className="text-text-placeholder">—</span>}
      </p>
    </div>
  );
}

/**
 * Inquiry detail page (Server Component).
 *
 * Auth gate: any authenticated org member — no special permission required.
 * Renders inquiry metadata, a Dismiss form (RSC form, no client component needed),
 * and the "Start Project" button (client component, uses useActionState for
 * inline SEQUENCE_CONFLICT error surfacing).
 *
 * Tenancy guard: the API route's getApiSession() enforces cross-org isolation,
 * and getInquiryById() returns null for wrong-org inquiries → 404.
 *
 * Stage 14 Batch B: card section restructured from 2-col to 3 stacked cards
 * per finalized mockup (Project Information / Contractor Details / End Client Details).
 * All 15 new fields displayed. Existing header unchanged.
 */
export default async function InquiryDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; inquiryId: string }>;
}) {
  const { orgSlug, inquiryId } = await params;
  const base = await orgHref(orgSlug, "");

  const [res, t] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/inquiries/${inquiryId}`),
    getTranslations("inquiries"),
  ]);

  if (res.status === 401 || res.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  if (!res.ok) {
    notFound();
  }

  const { inquiry } = (await res.json()) as { inquiry: InquiryDetail };

  const isClosed =
    inquiry.status === "DISMISSED" || inquiry.status === "CONVERTED";

  /** Status badge classes for the detail header */
  function statusBadgeClass(status: string): string {
    if (status === "NEW") return "bg-status-pending-bg text-status-pending-text";
    if (status === "DISMISSED") return "bg-status-refunded-bg text-status-refunded-text";
    return "bg-status-paid-bg text-status-paid-text";
  }

  function statusLabel(status: string): string {
    if (status === "NEW") return t("statusNew");
    if (status === "DISMISSED") return t("statusDismissed");
    return t("statusConverted");
  }

  /** Format an ISO date string to locale date, or return "—" for null/empty */
  function formatDate(iso: string | null | undefined): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString();
  }

  const formattedInquiryNumber =
    inquiry.companyInquiryNumber != null
      ? `INQ-${inquiry.companyInquiryNumber}`
      : `#${inquiry.inquiryNumber}`;

  return (
    <div>
      {/* ── Back link ───────────────────────────────────────────────────────── */}
      <Link
        href={`${base}/inquiries`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-text-heading"
      >
        {t("backToList")}
      </Link>

      {/* ── Detail header ────────────────────────────────────────────────────── */}
      <div className="mb-6">
        {/* Title row: inquiry number + name on the left; username + date on the right (V2) */}
        <div className="mb-3 flex items-start justify-between gap-4">
          <h1 className="text-[27px] font-extrabold text-text-heading">
            {formattedInquiryNumber} — {inquiry.name}
          </h1>
          {/* V2 — right-side metadata: username + created date */}
          <div className="shrink-0 text-right text-sm text-text-muted">
            <p className="font-semibold">{inquiry.createdBy.username}</p>
            <p>{t("colDate")}: {new Date(inquiry.createdAt).toLocaleDateString()}</p>
          </div>
        </div>

        {/* V1 — Metadata strip: Company name + Status only */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {/* Status badge */}
          <span
            className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-xs font-bold ${statusBadgeClass(inquiry.status)}`}
          >
            {statusLabel(inquiry.status)}
          </span>

          {/* External company name */}
          {inquiry.externalCompany && (
            <span className="text-sm font-semibold text-text-body">
              {inquiry.externalCompany.name}
            </span>
          )}
        </div>

        {/* ── Action buttons ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Edit — only shown while status is NEW */}
          {!isClosed && (
            <Link
              href={`${base}/inquiries/${inquiryId}/edit`}
              className="inline-flex items-center rounded-sm border border-border bg-bg-white px-4 py-2.5 text-sm font-bold text-text-body hover:bg-primary-softer hover:text-text-heading"
            >
              {t("editAction")}
            </Link>
          )}

          {/* Dismiss — RSC form, no client component needed; behavior unchanged */}
          <form action={dismissInquiry}>
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <input type="hidden" name="inquiryId" value={inquiryId} />
            <button
              type="submit"
              disabled={isClosed}
              className="inline-flex items-center rounded-sm border border-border bg-bg-white px-4 py-2.5 text-sm font-bold text-text-body hover:bg-primary-softer hover:text-text-heading disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("dismissAction")}
            </button>
          </form>

          {/* Start Project — client component; behavior unchanged */}
          <StartProjectButton
            orgSlug={orgSlug}
            inquiryId={inquiryId}
            disabled={isClosed}
          />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          Card 1 — Project Information
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="mb-6 overflow-hidden rounded-md border border-border bg-bg-card shadow-card">
        <div className="bg-primary-softer px-5 py-3.5">
          <h2 className="text-base font-extrabold text-primary-dark">
            {t("sectionProjectInfo")}
          </h2>
          <p className="mt-0.5 text-xs font-medium text-text-muted">
            Core details about this inquiry and its project
          </p>
        </div>
        <div className="p-5 grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
          <Field label={t("colNumber")} value={formattedInquiryNumber} />
          <Field label={t("fieldName")} value={inquiry.name} />
          {/* V5 — format raw budget string (e.g. "1000000" → "10,00,000" for INR) */}
          <Field label={t("fieldProjectBudget")} value={formatBudget(inquiry.projectBudget, inquiry.currency)} />
          <Field label={t("fieldCurrency")} value={inquiry.currency} />
          <Field label={t("fieldProjectLocation")} value={inquiry.projectLocation} />
          <Field label={t("fieldSubmissionDate")} value={formatDate(inquiry.submissionDate)} />
          <Field label={t("fieldProjectDeadline")} value={formatDate(inquiry.projectDeadline)} />
          {/* V3 — destinationCountry removed: it is derived from the company (Stage 14), never user-entered */}
          {/* Client (external company) */}
          <Field
            label={t("colExternalCompany")}
            value={inquiry.externalCompany?.name}
          />
          {/* Created by + date */}
          <Field label="Created By" value={inquiry.createdBy.username} />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          Card 2 — Contractor & Consultant Details
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="mb-6 overflow-hidden rounded-md border border-border bg-bg-card shadow-card">
        <div className="bg-primary-softer px-5 py-3.5">
          <h2 className="text-base font-extrabold text-primary-dark">
            {t("sectionContractorDetails")}
          </h2>
          <p className="mt-0.5 text-xs font-medium text-text-muted">
            Contractors and consultants tied to this project
          </p>
        </div>
        <div className="p-5 grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
          <Field label={t("fieldMainContractorName")} value={inquiry.mainContractorName} />
          <Field label={t("fieldInteriorContractorName")} value={inquiry.interiorContractorName} />
          <Field label={t("fieldMainConsultantName")} value={inquiry.mainConsultantName} />
          <Field label={t("fieldInteriorConsultantName")} value={inquiry.interiorConsultantName} />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          Card 3 — End Client Details
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="overflow-hidden rounded-md border border-border bg-bg-card shadow-card">
        <div className="bg-primary-softer px-5 py-3.5">
          <h2 className="text-base font-extrabold text-primary-dark">
            {t("sectionEndClientDetails")}
          </h2>
          <p className="mt-0.5 text-xs font-medium text-text-muted">
            Contact and billing details for the end client
          </p>
        </div>
        <div className="p-5 grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
          <Field label={t("fieldEndClientName")} value={inquiry.endClientName} />
          <Field label={t("fieldEndClientPhone")} value={inquiry.endClientPhone} />
          <Field label={t("fieldEndClientEmail")} value={inquiry.endClientEmail} />
          <Field label={t("fieldEndClientGstNumber")} value={inquiry.endClientGstNumber} />
          <Field label={t("fieldEndClientAddressLine1")} value={inquiry.endClientAddressLine1} />
          <Field label={t("fieldEndClientAddressLine2")} value={inquiry.endClientAddressLine2} />
          <Field label={t("fieldEndClientCity")} value={inquiry.endClientCity} />
          <Field label={t("fieldEndClientState")} value={inquiry.endClientState} />
        </div>
      </div>
    </div>
  );
}
