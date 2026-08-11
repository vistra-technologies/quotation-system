"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import { CompanyDropdown } from "@/components/company-dropdown";
import { createInquiry, type CreateInquiryState } from "../actions";

interface CreateInquiryFormProps {
  orgSlug: string;
  /** Set when the session user is tied to exactly one ExternalCompany — locks the Client field. */
  lockedCompany: { id: string; name: string } | null;
  /** Free-choice list for org members/admins (null lockedCompany). Empty when lockedCompany is set. */
  externalCompanies: { id: string; name: string }[];
  /** Back-navigation href for the Cancel button. */
  backHref: string;
}

const initialState: CreateInquiryState = { error: null };

/**
 * Client Component form for creating a new inquiry.
 *
 * Uses useActionState (React 19) so the server action can return a
 * user-readable error (e.g. concurrent inquiry number collision) rather
 * than crashing to an error boundary. Mirrors CreateProjectForm exactly.
 *
 * When lockedCompany is set (session user belongs to a fixed ExternalCompany),
 * the Client field is rendered as read-only text — no dropdown is offered.
 * The company id is submitted via a hidden input; the DAL also enforces this
 * server-side regardless of what the form sends.
 *
 * The `inquiries` namespace is forwarded in the ancestor layout's clientMessages —
 * verified in app/[orgSlug]/inquiries/layout.tsx.
 *
 * Stage 11 (Batch 5): restyled to Sage Ease tokens — two-column card layout
 * (Inquiry Details / Client Info panels), Sage Ease form fields, Cancel link,
 * Sage Ease primary submit button. No logic changes.
 */
export function CreateInquiryForm({
  orgSlug,
  lockedCompany,
  externalCompanies,
  backHref,
}: CreateInquiryFormProps) {
  const t = useTranslations("inquiries");
  const [state, formAction, isPending] = useActionState(createInquiry, initialState);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");

  return (
    <>
      <LoadingOverlay visible={isPending} />

      {/* Error banner */}
      {state.error && (
        <div className="mb-5 rounded-sm border border-status-failed-text/20 bg-status-failed-bg px-4 py-3">
          <p className="text-sm font-semibold text-status-failed-text">{state.error}</p>
        </div>
      )}

      <form action={formAction}>
        <input type="hidden" name="orgSlug" value={orgSlug} />

        {/* Two-column card */}
        <div className="overflow-hidden rounded-md border border-border bg-bg-card shadow-card">
          <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">

            {/* ── Left panel: Inquiry Details ──────────────────────────────── */}
            <div>
              {/* Panel title */}
              <div className="bg-primary-softer px-5 py-3.5">
                <h2 className="text-base font-extrabold text-primary-dark">
                  Inquiry Details
                </h2>
                <p className="mt-0.5 text-xs font-medium text-text-muted">
                  Core details about this inquiry
                </p>
              </div>

              {/* Panel body */}
              <div className="space-y-4 p-5">
                {/* Inquiry Name */}
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="name"
                    className="text-[10px] font-bold uppercase tracking-wider text-text-muted"
                  >
                    {t("fieldName")}
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    required
                    autoComplete="off"
                    className="rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-heading placeholder:text-text-placeholder focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>

                {/* Destination Country */}
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="destinationCountry"
                    className="text-[10px] font-bold uppercase tracking-wider text-text-muted"
                  >
                    {t("fieldDestinationCountry")}
                  </label>
                  <input
                    id="destinationCountry"
                    name="destinationCountry"
                    type="text"
                    required
                    autoComplete="off"
                    className="rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-heading placeholder:text-text-placeholder focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>

                {/* Currency */}
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="currency"
                    className="text-[10px] font-bold uppercase tracking-wider text-text-muted"
                  >
                    {t("fieldCurrency")}
                  </label>
                  <input
                    id="currency"
                    name="currency"
                    type="text"
                    required
                    maxLength={10}
                    placeholder="e.g. USD, AED"
                    autoComplete="off"
                    className="rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-heading placeholder:text-text-placeholder focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              </div>
            </div>

            {/* ── Right panel: Client Information ──────────────────────────── */}
            <div>
              {/* Panel title */}
              <div className="bg-primary-softer px-5 py-3.5">
                <h2 className="text-base font-extrabold text-primary-dark">
                  Client Information
                </h2>
                <p className="mt-0.5 text-xs font-medium text-text-muted">
                  The client company tied to this inquiry
                </p>
              </div>

              {/* Panel body */}
              <div className="space-y-4 p-5">
                {/* External company — locked or free-choice */}
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={lockedCompany ? undefined : "externalCompanyId"}
                    className="text-[10px] font-bold uppercase tracking-wider text-text-muted"
                  >
                    {t("fieldExternalCompany")}
                  </label>
                  {lockedCompany ? (
                    <>
                      <input
                        type="hidden"
                        name="externalCompanyId"
                        value={lockedCompany.id}
                      />
                      <p className="rounded-sm border border-border bg-primary-softer/60 px-3 py-2.5 text-sm font-semibold text-text-body">
                        {lockedCompany.name}
                      </p>
                    </>
                  ) : (
                    <CompanyDropdown
                      id="externalCompanyId"
                      name="externalCompanyId"
                      options={externalCompanies}
                      value={selectedCompanyId}
                      onChange={setSelectedCompanyId}
                      noneLabel={t("fieldExternalCompanyNone")}
                      ariaLabel={t("fieldExternalCompany")}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Card footer */}
          <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
            <Link
              href={backHref}
              className="inline-flex items-center rounded-sm border border-border bg-bg-white px-5 py-2.5 text-sm font-bold text-text-body hover:bg-primary-softer hover:text-text-heading"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("submitCreate")}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
