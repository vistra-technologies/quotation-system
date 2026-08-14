"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import { updateProject, type UpdateProjectState } from "../../actions";

interface EditProjectFormProps {
  orgSlug: string;
  projectId: string;
  /** Href for the Cancel button (project detail page). */
  backHref: string;
  /** Current field values — pre-populated into the form. */
  initialName: string;
  // initialDestinationCountry removed (D19 — derived at create, never edited).
  initialCurrency: string;
  initialProjectLocation: string | null;
  initialSubmissionDate: string | null;
  initialProjectDeadline: string | null;
  initialProjectBudget: string | null;
  initialMainContractorName: string | null;
  initialInteriorContractorName: string | null;
  initialMainConsultantName: string | null;
  initialInteriorConsultantName: string | null;
  initialEndClientName: string | null;
  initialEndClientPhone: string | null;
  initialEndClientEmail: string | null;
  initialEndClientAddressLine1: string | null;
  initialEndClientAddressLine2: string | null;
  initialEndClientCity: string | null;
  initialEndClientState: string | null;
  initialEndClientGstNumber: string | null;
  /**
   * X1 — project display number for the read-only header field.
   * org-scoped sequence number (always present).
   */
  projectNumber: number;
  /**
   * X1 — company-scoped project number when assigned.
   * Formatted as "JOB-{n}" when present, "#n" fallback using projectNumber.
   */
  companyProjectNumber: number | null;
  /**
   * Formatted inquiry display number for the linked inquiry, if any.
   * "INQ-42" (company-scoped) or "#7" (org-scoped fallback).
   * Null when the project was created directly (not converted from an inquiry).
   */
  inquiryNumber: string | null;
  /**
   * The locked External Company linked to this project.
   * Always shown read-only — externalCompanyId is never editable after creation.
   * Null when no company is linked.
   */
  lockedCompany: { id: string; name: string; country: "INDIA" | "UAE" } | null;
  /**
   * Country of the linked company — drives the GST conditional.
   * "INDIA" → GST required; "UAE" or null → GST optional (D20).
   * Static on edit form (company is locked for the life of the record).
   */
  companyCountry: "INDIA" | "UAE" | null;
}

const initialState: UpdateProjectState = { error: null };

/**
 * Client Component form for editing an existing DRAFT project — Stage 14 Batch C.
 *
 * 3-card layout per the finalized mockup (project-details-page.html).
 * Company is always read-only (locked for life of record — Stage 13 decision).
 * `isIndia` is a static derived boolean — no state needed (company is locked).
 *
 * namespace: "projects" — wired in app/[orgSlug]/projects/layout.tsx clientMessages.
 */
export function EditProjectForm({
  orgSlug,
  projectId,
  backHref,
  initialName,
  initialCurrency,
  initialProjectLocation,
  initialSubmissionDate,
  initialProjectDeadline,
  initialProjectBudget,
  initialMainContractorName,
  initialInteriorContractorName,
  initialMainConsultantName,
  initialInteriorConsultantName,
  initialEndClientName,
  initialEndClientPhone,
  initialEndClientEmail,
  initialEndClientAddressLine1,
  initialEndClientAddressLine2,
  initialEndClientCity,
  initialEndClientState,
  initialEndClientGstNumber,
  projectNumber,
  companyProjectNumber,
  lockedCompany,
  companyCountry,
}: EditProjectFormProps) {
  const t = useTranslations("projects");
  const [state, formAction, isPending] = useActionState(updateProject, initialState);

  // GST conditional — static on edit (company can't change).
  const isIndia = companyCountry === "INDIA";

  // X1 — format project number identically to the detail page (projects/[projectId]/page.tsx:60–62).
  const formattedProjectNumber =
    companyProjectNumber != null
      ? `JOB-${companyProjectNumber}`
      : `#${projectNumber}`;

  // Shared class strings.
  const inputCls =
    "w-full rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-body placeholder:text-text-placeholder transition-[border-color,box-shadow] duration-150 focus:border-primary focus:outline-none focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)] disabled:bg-primary-softer/30 disabled:text-text-muted";
  const selectCls =
    "w-full rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-body focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]";
  const labelCls = "block text-[10px] font-bold uppercase tracking-wider text-text-muted";
  const fieldCls = "flex flex-col gap-1 mb-[14px]";
  const reqMark = <span className="ml-0.5 text-red-600">*</span>;

  return (
    <>
      <LoadingOverlay visible={isPending} />

      <form action={formAction} className="flex flex-col">
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="projectId" value={projectId} />

        {/* ── Card 1: Project Information ─────────────────────────────── */}
        <div className="mb-5 rounded-md border border-border bg-bg-card shadow-card overflow-hidden">
          <div className="bg-primary-softer px-5 py-3.5">
            <p className="text-base font-extrabold text-primary-dark">
              {t("sectionProjectInfo")}
            </p>
            <p className="mt-0.5 text-xs font-medium text-text-muted">
              Core details about this project
            </p>
          </div>

          <div className="p-5">
            {/* Error banner */}
            {state.error && (
              <div className="mb-4 rounded-sm border border-red-300 bg-red-50 px-4 py-3">
                <p className="text-sm text-red-700">{state.error}</p>
              </div>
            )}

            {/* 2-column grid — PC2/C2: Project Id left, Company right in Row 1 */}
            <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">
              {/* Row 1 left — Project Id (disabled, real number on edit — PC2) */}
              <div className={fieldCls}>
                <label className={labelCls}>{t("fieldId")}</label>
                <input
                  type="text"
                  disabled
                  value={formattedProjectNumber}
                  className={inputCls}
                />
              </div>

              {/* Row 1 right — Company read-only (PC1/C1, C2) */}
              <div className={fieldCls}>
                <span className={labelCls}>{t("fieldExternalCompany")}</span>
                <p className="rounded-sm border border-border bg-primary-softer/40 px-3 py-2.5 text-sm text-text-body">
                  {lockedCompany ? lockedCompany.name : <span className="text-text-placeholder">—</span>}
                </p>
              </div>

              {/* Row 2 left — Project Name * (C4) */}
              <div className={fieldCls}>
                <label htmlFor="name" className={labelCls}>
                  {t("fieldName")}
                  {reqMark}
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  defaultValue={initialName}
                  autoComplete="off"
                  className={inputCls}
                />
              </div>

              {/* Row 2 right — Project Location * (C4, D22) */}
              <div className={fieldCls}>
                <label htmlFor="projectLocation" className={labelCls}>
                  {t("fieldProjectLocation")}
                  {reqMark}
                </label>
                <input
                  id="projectLocation"
                  name="projectLocation"
                  type="text"
                  required
                  defaultValue={initialProjectLocation ?? ""}
                  autoComplete="off"
                  placeholder="e.g. Dubai, UAE"
                  className={inputCls}
                />
              </div>

              {/* Row 3 left — Project Budget */}
              <div className={fieldCls}>
                <label htmlFor="projectBudget" className={labelCls}>
                  {t("fieldProjectBudget")}
                </label>
                <input
                  id="projectBudget"
                  name="projectBudget"
                  type="text"
                  defaultValue={initialProjectBudget ?? ""}
                  autoComplete="off"
                  className={inputCls}
                />
              </div>

              {/* Row 3 right — Currency * (constrained select — D13) */}
              <div className={fieldCls}>
                <label htmlFor="currency" className={labelCls}>
                  {t("fieldCurrency")}
                  {reqMark}
                </label>
                <select
                  id="currency"
                  name="currency"
                  required
                  defaultValue={initialCurrency}
                  className={selectCls}
                >
                  <option value="" disabled>Select currency…</option>
                  <option value="INR">INR</option>
                  <option value="AED">AED</option>
                  <option value="USD">USD</option>
                </select>
              </div>

              {/* Row 4 left — Submission Date * (D17, C7) */}
              <div className={fieldCls}>
                <label htmlFor="submissionDate" className={labelCls}>
                  {t("fieldSubmissionDate")}
                  {reqMark}
                </label>
                <input
                  id="submissionDate"
                  name="submissionDate"
                  type="date"
                  required
                  defaultValue={initialSubmissionDate ?? ""}
                  className={inputCls}
                />
              </div>

              {/* Row 4 right — Project Deadline (C7) */}
              <div className={fieldCls}>
                <label htmlFor="projectDeadline" className={labelCls}>
                  {t("fieldProjectDeadline")}
                </label>
                <input
                  id="projectDeadline"
                  name="projectDeadline"
                  type="date"
                  defaultValue={initialProjectDeadline ?? ""}
                  className={inputCls}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Card 2: Contractor & Consultant Details ──────────────────── */}
        <div className="mb-5 rounded-md border border-border bg-bg-card shadow-card overflow-hidden">
          <div className="bg-primary-softer px-5 py-3.5">
            <p className="text-base font-extrabold text-primary-dark">
              {t("sectionContractorDetails")}
            </p>
            <p className="mt-0.5 text-xs font-medium text-text-muted">
              Contractors and consultants tied to this project
            </p>
          </div>

          <div className="p-5">
            <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">
              <div className={fieldCls}>
                <label htmlFor="mainContractorName" className={labelCls}>
                  {t("fieldMainContractorName")}
                </label>
                <input
                  id="mainContractorName"
                  name="mainContractorName"
                  type="text"
                  defaultValue={initialMainContractorName ?? ""}
                  autoComplete="off"
                  className={inputCls}
                />
              </div>

              <div className={fieldCls}>
                <label htmlFor="interiorContractorName" className={labelCls}>
                  {t("fieldInteriorContractorName")}
                </label>
                <input
                  id="interiorContractorName"
                  name="interiorContractorName"
                  type="text"
                  defaultValue={initialInteriorContractorName ?? ""}
                  autoComplete="off"
                  className={inputCls}
                />
              </div>

              <div className={fieldCls}>
                <label htmlFor="mainConsultantName" className={labelCls}>
                  {t("fieldMainConsultantName")}
                </label>
                <input
                  id="mainConsultantName"
                  name="mainConsultantName"
                  type="text"
                  defaultValue={initialMainConsultantName ?? ""}
                  autoComplete="off"
                  className={inputCls}
                />
              </div>

              <div className={fieldCls}>
                <label htmlFor="interiorConsultantName" className={labelCls}>
                  {t("fieldInteriorConsultantName")}
                </label>
                <input
                  id="interiorConsultantName"
                  name="interiorConsultantName"
                  type="text"
                  defaultValue={initialInteriorConsultantName ?? ""}
                  autoComplete="off"
                  className={inputCls}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Card 3: End Client Details + footer ─────────────────────── */}
        <div className="mb-5 rounded-md border border-border bg-bg-card shadow-card overflow-hidden">
          <div className="bg-primary-softer px-5 py-3.5">
            <p className="text-base font-extrabold text-primary-dark">
              {t("sectionEndClientDetails")}
            </p>
            <p className="mt-0.5 text-xs font-medium text-text-muted">
              Contact and billing details for the end client
            </p>
          </div>

          <div className="p-5">
            <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">
              <div className={fieldCls}>
                <label htmlFor="endClientName" className={labelCls}>
                  {t("fieldEndClientName")}
                  {reqMark}
                </label>
                <input
                  id="endClientName"
                  name="endClientName"
                  type="text"
                  required
                  defaultValue={initialEndClientName ?? ""}
                  autoComplete="off"
                  className={inputCls}
                />
              </div>

              <div className={fieldCls}>
                <label htmlFor="endClientPhone" className={labelCls}>
                  {t("fieldEndClientPhone")}
                  {reqMark}
                </label>
                <input
                  id="endClientPhone"
                  name="endClientPhone"
                  type="tel"
                  required
                  defaultValue={initialEndClientPhone ?? ""}
                  autoComplete="off"
                  className={inputCls}
                />
              </div>

              <div className={fieldCls}>
                <label htmlFor="endClientEmail" className={labelCls}>
                  {t("fieldEndClientEmail")}
                  {reqMark}
                </label>
                <input
                  id="endClientEmail"
                  name="endClientEmail"
                  type="email"
                  required
                  defaultValue={initialEndClientEmail ?? ""}
                  autoComplete="off"
                  className={inputCls}
                />
              </div>

              {/* GST Number — conditionally required for India (D20) */}
              <div className={fieldCls}>
                <label htmlFor="endClientGstNumber" className={labelCls}>
                  {t("fieldEndClientGstNumber")}
                  {isIndia && reqMark}
                </label>
                <input
                  id="endClientGstNumber"
                  name="endClientGstNumber"
                  type="text"
                  required={isIndia}
                  defaultValue={initialEndClientGstNumber ?? ""}
                  autoComplete="off"
                  className={inputCls}
                />
                {isIndia && (
                  <span className="text-[10px] text-text-muted">
                    {t("gstRequiredHint")}
                  </span>
                )}
              </div>

              <div className={fieldCls}>
                <label htmlFor="endClientAddressLine1" className={labelCls}>
                  {t("fieldEndClientAddressLine1")}
                  {reqMark}
                </label>
                <input
                  id="endClientAddressLine1"
                  name="endClientAddressLine1"
                  type="text"
                  required
                  defaultValue={initialEndClientAddressLine1 ?? ""}
                  autoComplete="off"
                  className={inputCls}
                />
              </div>

              {/* Address Line 2 — optional (C10) */}
              <div className={fieldCls}>
                <label htmlFor="endClientAddressLine2" className={labelCls}>
                  {t("fieldEndClientAddressLine2")}
                </label>
                <input
                  id="endClientAddressLine2"
                  name="endClientAddressLine2"
                  type="text"
                  defaultValue={initialEndClientAddressLine2 ?? ""}
                  autoComplete="off"
                  className={inputCls}
                />
              </div>

              <div className={fieldCls}>
                <label htmlFor="endClientCity" className={labelCls}>
                  {t("fieldEndClientCity")}
                  {reqMark}
                </label>
                <input
                  id="endClientCity"
                  name="endClientCity"
                  type="text"
                  required
                  defaultValue={initialEndClientCity ?? ""}
                  autoComplete="off"
                  className={inputCls}
                />
              </div>

              <div className={fieldCls}>
                <label htmlFor="endClientState" className={labelCls}>
                  {t("fieldEndClientState")}
                  {reqMark}
                </label>
                <input
                  id="endClientState"
                  name="endClientState"
                  type="text"
                  required
                  defaultValue={initialEndClientState ?? ""}
                  autoComplete="off"
                  className={inputCls}
                />
              </div>
            </div>
          </div>

          {/* Card footer inside Card 3 — D16 */}
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
              className="rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-text-on-primary transition-colors hover:bg-primary-dark disabled:opacity-50"
            >
              {t("submitEdit")}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
