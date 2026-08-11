import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
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
 * Stage 11 (Batch 5): restyled to Sage Ease tokens — back link, heading, meta row,
 * status badge, action buttons, two-column read-only card. Dismiss form and
 * StartProjectButton behavior unchanged.
 *
 * Stage 12: switched from direct requireSession + getInquiryById DAL call to
 * internalFetch against GET /api/v1/orgs/[orgSlug]/inquiries/[inquiryId].
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
        <h1 className="mb-3 text-[27px] font-extrabold text-text-heading">
          {inquiry.companyInquiryNumber != null
            ? `INQ-${inquiry.companyInquiryNumber}`
            : `#${inquiry.inquiryNumber}`}{" "}
          — {inquiry.name}
        </h1>

        {/* Metadata row */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {/* Country + Currency as pill tags */}
          <span className="rounded-pill border border-border px-2.5 py-1 text-xs font-bold text-text-muted">
            {inquiry.destinationCountry}
          </span>
          <span className="rounded-pill border border-border px-2.5 py-1 text-xs font-bold text-text-muted">
            {inquiry.currency}
          </span>

          {/* Status badge */}
          <span
            className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-xs font-bold ${statusBadgeClass(inquiry.status)}`}
          >
            {statusLabel(inquiry.status)}
          </span>

          {/* External company */}
          {inquiry.externalCompany && (
            <span className="text-sm font-semibold text-text-body">
              {inquiry.externalCompany.name}
            </span>
          )}

          {/* Created date */}
          <span className="text-sm text-text-muted">
            {t("colDate")}: {new Date(inquiry.createdAt).toLocaleDateString()}
          </span>

          {/* Created by */}
          <span className="text-sm text-text-muted">
            {inquiry.createdBy.username}
          </span>
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

      {/* ── Two-column read-only card ────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-md border border-border bg-bg-card shadow-card">
        <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">

          {/* Left panel: Inquiry Details */}
          <div>
            <div className="bg-primary-softer px-5 py-3.5">
              <h2 className="text-base font-extrabold text-primary-dark">
                Inquiry Details
              </h2>
              <p className="mt-0.5 text-xs font-medium text-text-muted">
                Core details about this inquiry
              </p>
            </div>
            <div className="space-y-4 p-5">
              {/* Inquiry Name */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  {t("fieldName")}
                </p>
                <p className="mt-1 text-sm font-semibold text-text-heading">
                  {inquiry.name}
                </p>
              </div>

              {/* Destination Country */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  {t("fieldDestinationCountry")}
                </p>
                <p className="mt-1 text-sm text-text-body">
                  {inquiry.destinationCountry}
                </p>
              </div>

              {/* Currency */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  {t("fieldCurrency")}
                </p>
                <p className="mt-1 text-sm text-text-body">{inquiry.currency}</p>
              </div>

              {/* Project Location */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  {t("fieldProjectLocation")}
                </p>
                <p className="mt-1 text-sm text-text-body">
                  {inquiry.projectLocation ?? (
                    <span className="text-text-placeholder">—</span>
                  )}
                </p>
              </div>

              {/* Inquiry number */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  {t("colNumber")}
                </p>
                <p className="mt-1 text-sm text-text-body">
                  {inquiry.companyInquiryNumber != null
                    ? `INQ-${inquiry.companyInquiryNumber}`
                    : `#${inquiry.inquiryNumber}`}
                </p>
              </div>
            </div>
          </div>

          {/* Right panel: Client & Creator */}
          <div>
            <div className="bg-primary-softer px-5 py-3.5">
              <h2 className="text-base font-extrabold text-primary-dark">
                Client &amp; Creator
              </h2>
              <p className="mt-0.5 text-xs font-medium text-text-muted">
                Parties involved in this inquiry
              </p>
            </div>
            <div className="space-y-4 p-5">
              {/* Client (external company) */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  {t("colExternalCompany")}
                </p>
                <p className="mt-1 text-sm text-text-body">
                  {inquiry.externalCompany?.name ?? (
                    <span className="text-text-placeholder">—</span>
                  )}
                </p>
              </div>

              {/* Created by */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  Created By
                </p>
                <p className="mt-1 text-sm text-text-body">
                  {inquiry.createdBy.username}
                </p>
              </div>

              {/* Created date */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  {t("colDate")}
                </p>
                <p className="mt-1 text-sm text-text-body">
                  {new Date(inquiry.createdAt).toLocaleDateString()}
                </p>
              </div>

              {/* Status */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  {t("colStatus")}
                </p>
                <div className="mt-1">
                  <span
                    className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-xs font-bold ${statusBadgeClass(inquiry.status)}`}
                  >
                    {statusLabel(inquiry.status)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
