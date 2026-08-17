"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import { formatBudget, stripGroupingSeparators } from "@/lib/format-currency";
import { updateInquiry, type UpdateInquiryState } from "../../actions";

interface EditInquiryFormProps {
  orgSlug: string;
  inquiryId: string;
  /** Pre-filled values from the existing inquiry. */
  initialName: string;
  // initialDestinationCountry removed — destinationCountry is locked at create time (D19)
  initialCurrency: string;
  initialProjectLocation: string | null;
  /** Stage 14 Batch B — extended intake fields */
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
  /** External company — always read-only on the edit form (locked for life of record). */
  externalCompany: { id: string; name: string } | null;
  /**
   * Country of the linked company — drives GST required-ness (D20).
   * null when no company is linked; GST becomes optional.
   */
  companyCountry: "INDIA" | "UAE" | null;
  /** Formatted inquiry number for display (e.g. "INQ-42" or "#7"). */
  inquiryNumberDisplay: string;
  /** Back-navigation href for the Cancel button. */
  backHref: string;
}

const initialState: UpdateInquiryState = { error: null };

/**
 * Client Component form for editing an existing inquiry.
 *
 * Stage 14 Batch B: restructured to 3-card layout per finalized mockup.
 * destinationCountry is removed from this form — locked at create time (D19).
 * GST required-ness is a static boolean derived from companyCountry prop (D20).
 * currency → <select> (D13). projectLocation required (D22).
 *
 * The `inquiries` namespace is forwarded in the ancestor layout's clientMessages —
 * verified in app/[orgSlug]/inquiries/layout.tsx.
 */
export function EditInquiryForm({
  orgSlug,
  inquiryId,
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
  externalCompany,
  companyCountry,
  inquiryNumberDisplay,
  backHref,
}: EditInquiryFormProps) {
  const t = useTranslations("inquiries");
  const [state, formAction, isPending] = useActionState(updateInquiry, initialState);

  const isIndia = companyCountry === "INDIA";

  // C6: track selected currency to drive the blur formatter (decision 7).
  // On edit the currency is already set from the saved record; we still need
  // state so the blur handler picks up the user's current select value.
  const [selectedCurrency, setSelectedCurrency] = useState<string>(initialCurrency);

  // C5: controlled budget value — pre-formatted from the saved raw string (decision 7).
  const [budgetValue, setBudgetValue] = useState<string>(() => {
    const f = formatBudget(initialProjectBudget, initialCurrency);
    return f === "—" ? "" : f;
  });

  // C5: format on blur using current currency selection.
  function handleBudgetBlur() {
    const raw = stripGroupingSeparators(budgetValue.trim());
    const formatted = formatBudget(raw, selectedCurrency);
    setBudgetValue(formatted === "—" ? "" : formatted);
  }

  // Shared input/select classNames
  const inputCls =
    "rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-heading placeholder:text-text-placeholder focus:outline-none focus:ring-2 focus:ring-primary/40";
  const selectCls =
    "rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-heading focus:outline-none focus:ring-2 focus:ring-primary/40";
  const labelCls = "text-[10px] font-bold uppercase tracking-wider text-text-muted";

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

          <div className="p-5">
            {/* 2-col grid — C2: Inquiry Id left, Company right in Row 1 */}
            <div className="grid grid-cols-1 gap-x-5 gap-y-0 sm:grid-cols-2">
              {/* Row 1 left — Inquiry Id (disabled, real number on edit — C2) */}
              <div className="flex flex-col gap-1 mb-[14px]">
                <label className={labelCls}>{t("fieldId")}</label>
                <input
                  type="text"
                  disabled
                  value={inquiryNumberDisplay}
                  className={`${inputCls} cursor-not-allowed opacity-60`}
                />
              </div>

              {/* Row 1 right — Company read-only (C1, C2) */}
              <div className="flex flex-col gap-1 mb-[14px]">
                <p className={labelCls}>{t("fieldExternalCompanyReadOnly")}</p>
                <p className="rounded-sm border border-border bg-primary-softer/60 px-3 py-2.5 text-sm font-semibold text-text-body">
                  {externalCompany?.name ?? (
                    <span className="font-normal text-text-placeholder">—</span>
                  )}
                </p>
              </div>

              {/* Row 2 left — Project Name * (C4, C9) */}
              <div className="flex flex-col gap-1 mb-[14px]">
                <label htmlFor="name" className={labelCls}>
                  {t("fieldName")}{" "}
                  <span className="text-status-failed-text font-normal">*</span>
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  autoComplete="off"
                  pattern="[A-Za-z0-9 \-]*"
                  defaultValue={initialName}
                  className={inputCls}
                />
              </div>

              {/* Row 2 right — Project Location * (C4) */}
              <div className="flex flex-col gap-1 mb-[14px]">
                <label htmlFor="projectLocation" className={labelCls}>
                  {t("fieldProjectLocation")}{" "}
                  <span className="text-status-failed-text font-normal">*</span>
                </label>
                <input
                  id="projectLocation"
                  name="projectLocation"
                  type="text"
                  required
                  autoComplete="off"
                  defaultValue={initialProjectLocation ?? ""}
                  placeholder="e.g. Dubai, UAE"
                  className={inputCls}
                />
              </div>

              {/* Row 3 left — Project Budget (C5, C9) */}
              <div className="flex flex-col gap-1 mb-[14px]">
                <label htmlFor="projectBudget" className={labelCls}>
                  {t("fieldProjectBudget")}
                </label>
                <input
                  id="projectBudget"
                  name="projectBudget"
                  type="text"
                  autoComplete="off"
                  inputMode="decimal"
                  pattern="[\d,\.]*"
                  value={budgetValue}
                  onChange={(e) => setBudgetValue(e.target.value)}
                  onBlur={handleBudgetBlur}
                  className={inputCls}
                />
              </div>

              {/* Row 3 right — Currency * (C6: controlled, tracks for blur formatter) */}
              <div className="flex flex-col gap-1 mb-[14px]">
                <label htmlFor="currency" className={labelCls}>
                  {t("fieldCurrency")}{" "}
                  <span className="text-status-failed-text font-normal">*</span>
                </label>
                <select
                  id="currency"
                  name="currency"
                  required
                  value={selectedCurrency}
                  onChange={(e) => setSelectedCurrency(e.target.value)}
                  className={selectCls}
                >
                  <option value="" disabled>Select currency…</option>
                  <option value="INR">INR</option>
                  <option value="AED">AED</option>
                  <option value="USD">USD</option>
                </select>
              </div>

              {/* Row 4 left — Submission Date * (C7) */}
              <div className="flex flex-col gap-1 mb-[14px]">
                <label htmlFor="submissionDate" className={labelCls}>
                  {t("fieldSubmissionDate")}{" "}
                  <span className="text-status-failed-text font-normal">*</span>
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
              <div className="flex flex-col gap-1 mb-[14px]">
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

          <div className="p-5 grid grid-cols-1 gap-x-5 gap-y-0 sm:grid-cols-2">
            <div className="flex flex-col gap-1 mb-[14px]">
              <label htmlFor="mainContractorName" className={labelCls}>
                {t("fieldMainContractorName")}
              </label>
              <input
                id="mainContractorName"
                name="mainContractorName"
                type="text"
                autoComplete="off"
                pattern="[A-Za-z0-9 \-]*"
                defaultValue={initialMainContractorName ?? ""}
                className={inputCls}
              />
            </div>

            <div className="flex flex-col gap-1 mb-[14px]">
              <label htmlFor="interiorContractorName" className={labelCls}>
                {t("fieldInteriorContractorName")}
              </label>
              <input
                id="interiorContractorName"
                name="interiorContractorName"
                type="text"
                autoComplete="off"
                pattern="[A-Za-z0-9 \-]*"
                defaultValue={initialInteriorContractorName ?? ""}
                className={inputCls}
              />
            </div>

            <div className="flex flex-col gap-1 mb-[14px]">
              <label htmlFor="mainConsultantName" className={labelCls}>
                {t("fieldMainConsultantName")}
              </label>
              <input
                id="mainConsultantName"
                name="mainConsultantName"
                type="text"
                autoComplete="off"
                pattern="[A-Za-z0-9 \-]*"
                defaultValue={initialMainConsultantName ?? ""}
                className={inputCls}
              />
            </div>

            <div className="flex flex-col gap-1 mb-[14px]">
              <label htmlFor="interiorConsultantName" className={labelCls}>
                {t("fieldInteriorConsultantName")}
              </label>
              <input
                id="interiorConsultantName"
                name="interiorConsultantName"
                type="text"
                autoComplete="off"
                pattern="[A-Za-z0-9 \-]*"
                defaultValue={initialInteriorConsultantName ?? ""}
                className={inputCls}
              />
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            Card 3 — End Client Details (footer inside this card — D16)
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

          <div className="p-5 grid grid-cols-1 gap-x-5 gap-y-0 sm:grid-cols-2">
            {/* End Client Name * (C9) */}
            <div className="flex flex-col gap-1 mb-[14px]">
              <label htmlFor="endClientName" className={labelCls}>
                {t("fieldEndClientName")}{" "}
                <span className="text-status-failed-text font-normal">*</span>
              </label>
              <input
                id="endClientName"
                name="endClientName"
                type="text"
                required
                autoComplete="off"
                pattern="[A-Za-z0-9 \-]*"
                defaultValue={initialEndClientName ?? ""}
                className={inputCls}
              />
            </div>

            {/* End Client Phone * */}
            <div className="flex flex-col gap-1 mb-[14px]">
              <label htmlFor="endClientPhone" className={labelCls}>
                {t("fieldEndClientPhone")}{" "}
                <span className="text-status-failed-text font-normal">*</span>
              </label>
              <input
                id="endClientPhone"
                name="endClientPhone"
                type="tel"
                required
                autoComplete="off"
                defaultValue={initialEndClientPhone ?? ""}
                className={inputCls}
              />
            </div>

            {/* End Client Email * */}
            <div className="flex flex-col gap-1 mb-[14px]">
              <label htmlFor="endClientEmail" className={labelCls}>
                {t("fieldEndClientEmail")}{" "}
                <span className="text-status-failed-text font-normal">*</span>
              </label>
              <input
                id="endClientEmail"
                name="endClientEmail"
                type="email"
                required
                autoComplete="off"
                defaultValue={initialEndClientEmail ?? ""}
                className={inputCls}
              />
            </div>

            {/* GST Number — required only for India (D20, static on edit) */}
            <div className="flex flex-col gap-1 mb-[14px]">
              <label htmlFor="endClientGstNumber" className={labelCls}>
                {t("fieldEndClientGstNumber")}
                {isIndia && (
                  <span className="text-status-failed-text font-normal"> *</span>
                )}
              </label>
              <input
                id="endClientGstNumber"
                name="endClientGstNumber"
                type="text"
                required={isIndia}
                autoComplete="off"
                defaultValue={initialEndClientGstNumber ?? ""}
                className={inputCls}
              />
              {isIndia && (
                <span className="text-[10px] text-text-muted">{t("gstRequiredHint")}</span>
              )}
            </div>

            {/* Address Line 1 * */}
            <div className="flex flex-col gap-1 mb-[14px]">
              <label htmlFor="endClientAddressLine1" className={labelCls}>
                {t("fieldEndClientAddressLine1")}{" "}
                <span className="text-status-failed-text font-normal">*</span>
              </label>
              <input
                id="endClientAddressLine1"
                name="endClientAddressLine1"
                type="text"
                required
                autoComplete="off"
                placeholder="Street address, building"
                defaultValue={initialEndClientAddressLine1 ?? ""}
                className={inputCls}
              />
            </div>

            {/* Address Line 2 — optional (C10) */}
            <div className="flex flex-col gap-1 mb-[14px]">
              <label htmlFor="endClientAddressLine2" className={labelCls}>
                {t("fieldEndClientAddressLine2")}
              </label>
              <input
                id="endClientAddressLine2"
                name="endClientAddressLine2"
                type="text"
                autoComplete="off"
                placeholder="Area, landmark"
                defaultValue={initialEndClientAddressLine2 ?? ""}
                className={inputCls}
              />
            </div>

            {/* City * (C9) */}
            <div className="flex flex-col gap-1 mb-[14px]">
              <label htmlFor="endClientCity" className={labelCls}>
                {t("fieldEndClientCity")}{" "}
                <span className="text-status-failed-text font-normal">*</span>
              </label>
              <input
                id="endClientCity"
                name="endClientCity"
                type="text"
                required
                autoComplete="off"
                pattern="[A-Za-z0-9 \-]*"
                defaultValue={initialEndClientCity ?? ""}
                className={inputCls}
              />
            </div>

            {/* State * (C9) */}
            <div className="flex flex-col gap-1 mb-[14px]">
              <label htmlFor="endClientState" className={labelCls}>
                {t("fieldEndClientState")}{" "}
                <span className="text-status-failed-text font-normal">*</span>
              </label>
              <input
                id="endClientState"
                name="endClientState"
                type="text"
                required
                autoComplete="off"
                pattern="[A-Za-z0-9 \-]*"
                defaultValue={initialEndClientState ?? ""}
                className={inputCls}
              />
            </div>
          </div>

          {/* Card footer — inside Card 3 (D16) */}
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
