"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import { CompanyDropdown } from "@/components/company-dropdown";
import { formatBudget, stripGroupingSeparators } from "@/lib/format-currency";
import { createProject, type CreateProjectState } from "../actions";

interface CreateProjectFormProps {
  orgSlug: string;
  /** Href for the Cancel button (projects list). */
  backHref: string;
  /** Set when the session user is tied to exactly one ExternalCompany — locks the Client field. */
  lockedCompany: { id: string; name: string; country: "INDIA" | "UAE"; defaultCurrency: string } | null;
  /** Free-choice list for org members/admins (null lockedCompany). Empty when lockedCompany is set. */
  externalCompanies: { id: string; name: string; country: "INDIA" | "UAE"; defaultCurrency: string }[];
}

const initialState: CreateProjectState = { error: null };

/**
 * Client Component form for creating a new project — Stage 14 Batch C.
 *
 * 3-card layout per the finalized mockup (project-details-page.html):
 *   Card 1: Project Information — project no., inquiry no., name, budget,
 *           currency (select), project location, submission date, deadline.
 *   Card 2: Contractor & Consultant Details — 4 contractor/consultant name fields.
 *   Card 3: End Client Details — 8 end-client fields with GST conditional.
 *
 * GST conditional (D19/D20): `isIndia` is derived from the linked company's
 * `country` enum. Locked (external) users have a static initial value;
 * internal users' `isIndia` updates when the dropdown selection changes.
 * When no company is selected, `isIndia` is false and GST is optional.
 *
 * `destinationCountry` is not on the form — it is derived server-side from
 * the company's country at create time (D19).
 *
 * `submissionDate` is pre-filled to today's local date on mount.
 *
 * namespace: "projects" — wired in app/[orgSlug]/projects/layout.tsx clientMessages.
 */
export function CreateProjectForm({
  orgSlug,
  backHref,
  lockedCompany,
  externalCompanies,
}: CreateProjectFormProps) {
  const t = useTranslations("projects");
  const [state, formAction, isPending] = useActionState(createProject, initialState);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");

  // C6: currency defaults to company's defaultCurrency, else INR (decision 6).
  const [selectedCurrency, setSelectedCurrency] = useState<string>(
    lockedCompany?.defaultCurrency ?? "INR",
  );

  // C5: budget display value — controlled input, formatted on blur (decision 7).
  const [budgetValue, setBudgetValue] = useState("");

  // Pre-fill submission date to today (local calendar date, not UTC).
  const todayLocal = (() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  })();

  // C5: format the budget field on blur using current selected currency.
  function handleBudgetBlur() {
    const raw = stripGroupingSeparators(budgetValue.trim());
    const formatted = formatBudget(raw, selectedCurrency);
    setBudgetValue(formatted === "—" ? "" : formatted);
  }

  // Shared class strings to keep the markup DRY.
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
        <input type="hidden" name="status" value="DRAFT" />

        {/* ── Card 1: Project Information ─────────────────────────────── */}
        <div className="mb-5 rounded-md border border-border bg-bg-card shadow-card overflow-hidden">
          {/* Panel title */}
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
              {/* Row 1 left — Project Id (disabled, autogenerated — PC2, C3) */}
              <div className={fieldCls}>
                <label className={labelCls}>{t("fieldId")}</label>
                <input
                  type="text"
                  disabled
                  value="—"
                  title="Project Id will be autogenerated"
                  className={inputCls}
                />
              </div>

              {/* Row 1 right — Company (PC1/C1, C2) */}
              <div className={fieldCls}>
                <label
                  htmlFor={lockedCompany ? undefined : "externalCompanyId"}
                  className={labelCls}
                >
                  {t("fieldExternalCompany")}
                </label>
                {lockedCompany ? (
                  <>
                    <input type="hidden" name="externalCompanyId" value={lockedCompany.id} />
                    <p className="rounded-sm border border-border bg-primary-softer/40 px-3 py-2.5 text-sm text-text-body">
                      {lockedCompany.name}
                    </p>
                  </>
                ) : (
                  <CompanyDropdown
                    id="externalCompanyId"
                    name="externalCompanyId"
                    options={externalCompanies}
                    value={selectedCompanyId}
                    onChange={(id) => {
                      setSelectedCompanyId(id);
                      const co = externalCompanies.find((c) => c.id === id);
                      // C6: update currency default when company selection changes.
                      setSelectedCurrency(co?.defaultCurrency ?? "INR");
                    }}
                    noneLabel={t("fieldExternalCompanyNone")}
                    ariaLabel={t("fieldExternalCompany")}
                  />
                )}
              </div>

              {/* Row 2 left — Project Name * (C4, C9) */}
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
                  autoComplete="off"
                  pattern="[A-Za-z0-9 \-]*"
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
                  autoComplete="off"
                  placeholder="e.g. Dubai, UAE"
                  className={inputCls}
                />
              </div>

              {/* Row 3 left — Project Budget (optional, C5, C9) */}
              <div className={fieldCls}>
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

              {/* Row 3 right — Currency * (C6: controlled, defaults to company currency — D13) */}
              <div className={fieldCls}>
                <label htmlFor="currency" className={labelCls}>
                  {t("fieldCurrency")}
                  {reqMark}
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

              {/* Row 4 left — Submission Date * (pre-filled today — D17, C7) */}
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
                  defaultValue={todayLocal}
                  className={inputCls}
                />
              </div>

              {/* Row 4 right — Project Deadline (optional, C7) */}
              <div className={fieldCls}>
                <label htmlFor="projectDeadline" className={labelCls}>
                  {t("fieldProjectDeadline")}
                </label>
                <input
                  id="projectDeadline"
                  name="projectDeadline"
                  type="date"
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
                  {reqMark}
                </label>
                <input
                  id="mainContractorName"
                  name="mainContractorName"
                  type="text"
                  required
                  autoComplete="off"
                  pattern="[A-Za-z0-9 \-]*"
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
                  autoComplete="off"
                  pattern="[A-Za-z0-9 \-]*"
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
                  autoComplete="off"
                  pattern="[A-Za-z0-9 \-]*"
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
                  autoComplete="off"
                  pattern="[A-Za-z0-9 \-]*"
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
              {/* End Client Name (C9) */}
              <div className={fieldCls}>
                <label htmlFor="endClientName" className={labelCls}>
                  {t("fieldEndClientName")}
                </label>
                <input
                  id="endClientName"
                  name="endClientName"
                  type="text"
                  autoComplete="off"
                  pattern="[A-Za-z0-9 \-]*"
                  className={inputCls}
                />
              </div>

              {/* End Client Phone */}
              <div className={fieldCls}>
                <label htmlFor="endClientPhone" className={labelCls}>
                  {t("fieldEndClientPhone")}
                </label>
                <input
                  id="endClientPhone"
                  name="endClientPhone"
                  type="tel"
                  autoComplete="off"
                  className={inputCls}
                />
              </div>

              {/* End Client Email */}
              <div className={fieldCls}>
                <label htmlFor="endClientEmail" className={labelCls}>
                  {t("fieldEndClientEmail")}
                </label>
                <input
                  id="endClientEmail"
                  name="endClientEmail"
                  type="email"
                  autoComplete="off"
                  className={inputCls}
                />
              </div>

              {/* GST Number — optional (D19/D20) */}
              <div className={fieldCls}>
                <label htmlFor="endClientGstNumber" className={labelCls}>
                  {t("fieldEndClientGstNumber")}
                </label>
                <input
                  id="endClientGstNumber"
                  name="endClientGstNumber"
                  type="text"
                  autoComplete="off"
                  className={inputCls}
                />
              </div>

              {/* Address Line 1 */}
              <div className={fieldCls}>
                <label htmlFor="endClientAddressLine1" className={labelCls}>
                  {t("fieldEndClientAddressLine1")}
                </label>
                <input
                  id="endClientAddressLine1"
                  name="endClientAddressLine1"
                  type="text"
                  autoComplete="off"
                  placeholder="Street address, building"
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
                  autoComplete="off"
                  placeholder="Area, landmark"
                  className={inputCls}
                />
              </div>

              {/* City (C9) */}
              <div className={fieldCls}>
                <label htmlFor="endClientCity" className={labelCls}>
                  {t("fieldEndClientCity")}
                </label>
                <input
                  id="endClientCity"
                  name="endClientCity"
                  type="text"
                  autoComplete="off"
                  pattern="[A-Za-z0-9 \-]*"
                  className={inputCls}
                />
              </div>

              {/* State (C9) */}
              <div className={fieldCls}>
                <label htmlFor="endClientState" className={labelCls}>
                  {t("fieldEndClientState")}
                </label>
                <input
                  id="endClientState"
                  name="endClientState"
                  type="text"
                  autoComplete="off"
                  pattern="[A-Za-z0-9 \-]*"
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
              {t("submitConfigure")}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
