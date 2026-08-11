"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import { updateInquiry, type UpdateInquiryState } from "../../actions";

interface EditInquiryFormProps {
  orgSlug: string;
  inquiryId: string;
  /** Pre-filled values from the existing inquiry. */
  initialName: string;
  initialDestinationCountry: string;
  initialCurrency: string;
  initialProjectLocation: string | null;
  /** External company — always read-only on the edit form (locked for life of record). */
  externalCompany: { id: string; name: string } | null;
  /** Back-navigation href for the Cancel button. */
  backHref: string;
}

const initialState: UpdateInquiryState = { error: null };

/**
 * Client Component form for editing an existing inquiry.
 *
 * Editable fields: name, destinationCountry, currency, projectLocation.
 * externalCompanyId is shown read-only (locked — never editable post-creation).
 *
 * Uses useActionState (React 19) so the server action can return a user-readable
 * error rather than crashing to an error boundary. Mirrors CreateInquiryForm's
 * two-column card layout.
 *
 * Stage 13 Batch 6.
 */
export function EditInquiryForm({
  orgSlug,
  inquiryId,
  initialName,
  initialDestinationCountry,
  initialCurrency,
  initialProjectLocation,
  externalCompany,
  backHref,
}: EditInquiryFormProps) {
  const t = useTranslations("inquiries");
  const [state, formAction, isPending] = useActionState(updateInquiry, initialState);

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
        <input type="hidden" name="inquiryId" value={inquiryId} />

        {/* Two-column card — mirrors create form layout */}
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
                    defaultValue={initialName}
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
                    defaultValue={initialDestinationCountry}
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
                    defaultValue={initialCurrency}
                    className="rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-heading placeholder:text-text-placeholder focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>

                {/* Project Location (optional) */}
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="projectLocation"
                    className="text-[10px] font-bold uppercase tracking-wider text-text-muted"
                  >
                    {t("fieldProjectLocation")}
                    <span className="ml-1 font-normal normal-case text-text-placeholder">(optional)</span>
                  </label>
                  <input
                    id="projectLocation"
                    name="projectLocation"
                    type="text"
                    autoComplete="off"
                    defaultValue={initialProjectLocation ?? ""}
                    className="rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-heading placeholder:text-text-placeholder focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              </div>
            </div>

            {/* ── Right panel: Client Information (read-only) ───────────────── */}
            <div>
              {/* Panel title */}
              <div className="bg-primary-softer px-5 py-3.5">
                <h2 className="text-base font-extrabold text-primary-dark">
                  Client Information
                </h2>
                <p className="mt-0.5 text-xs font-medium text-text-muted">
                  The client company tied to this inquiry (read-only)
                </p>
              </div>

              {/* Panel body */}
              <div className="space-y-4 p-5">
                {/* External company — always read-only on edit; locked for life of record. */}
                <div className="flex flex-col gap-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                    {t("fieldExternalCompanyReadOnly")}
                  </p>
                  <p className="rounded-sm border border-border bg-primary-softer/60 px-3 py-2.5 text-sm font-semibold text-text-body">
                    {externalCompany?.name ?? (
                      <span className="font-normal text-text-placeholder">—</span>
                    )}
                  </p>
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
              {t("submitEdit")}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
