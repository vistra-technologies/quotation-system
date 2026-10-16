"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import { SelectField } from "@/components/select-field";
import { CompanyDropdown } from "@/components/company-dropdown";
import { isSupportedCurrency, SUPPORTED_CURRENCIES, type SupportedCurrency } from "@/lib/currency";
import { formatBudget, stripGroupingSeparators } from "@/lib/format-currency";
import {
  draftToAttached,
  pricedDraftLines,
  storedToDraft,
  type AttachedEstimate,
} from "@/lib/quick-estimate/inquiry-draft";
import type { EstimateDraft } from "@/lib/quick-estimate/lines";
import { EstimateActionButton } from "../../quick-estimate/estimate-action-button";
import { EstimatePanel } from "../../quick-estimate/estimate-panel";
import { useEstimate, type InquiryMode } from "../../quick-estimate/estimate-provider";
import { evaluateEstimate } from "../../quick-estimate/estimate-summary";
import { ExportOverlay } from "../../quick-estimate/export-overlay";
import { UndoToast, useUndoToast } from "../../quick-estimate/undo-toast";
import { createInquiry, type CreateInquiryState } from "../actions";

interface CreateInquiryFormProps {
  orgSlug: string;
  /** Set when the session user is tied to exactly one ExternalCompany — locks the Client field. */
  lockedCompany: { id: string; name: string; country: "INDIA" | "UAE"; defaultCurrency: string } | null;
  /** Free-choice list for org members/admins (null lockedCompany). Empty when lockedCompany is set. */
  externalCompanies: { id: string; name: string; country: "INDIA" | "UAE"; defaultCurrency: string }[];
  /** Back-navigation href for the Cancel button. */
  backHref: string;
}

const initialState: CreateInquiryState = { error: null };

/**
 * One of the three form cards, collapsible (S33-20, v3 mockup). Folded state is owned by the form (controlled,
 * not `<details>`). The content wrapper is `inert` while folded, so Tab skips every field inside; the header
 * click and the chevron button both toggle.
 */
function FoldCard({
  title,
  subtitle,
  folded,
  onToggle,
  children,
}: {
  title: string;
  subtitle: string;
  folded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const qe = useTranslations("quickEstimate");
  const label = folded ? qe("foldExpand") : qe("foldCollapse");
  return (
    <div className="mb-6 overflow-hidden rounded-md border border-border bg-bg-card shadow-card" data-folded={folded}>
      <div className="flex cursor-pointer select-none items-center gap-3 bg-primary-softer px-5 py-3.5" onClick={onToggle}>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-extrabold text-primary-dark">{title}</h2>
          <p className="mt-0.5 text-xs font-medium text-text-muted">{subtitle}</p>
        </div>
        <button
          type="button"
          aria-expanded={!folded}
          aria-label={`${label}: ${title}`}
          title={label}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-transparent text-primary-dark hover:border-primary-soft hover:bg-bg-white"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform duration-200 ${folded ? "-rotate-90" : ""}`}
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>
      <div
        inert={folded}
        className={`grid transition-[grid-template-rows] duration-200 ${folded ? "grid-rows-[0fr]" : "grid-rows-[1fr]"}`}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

/**
 * Client Component form for creating a new inquiry.
 *
 * Stage 14 Batch B: restructured to 3-card layout per finalized mockup:
 *   Card 1 — Project Information (company field full-width, 2-col grid for core fields)
 *   Card 2 — Contractor & Consultant Details
 *   Card 3 — End Client Details (footer inside this card)
 *
 * destinationCountry is now derived server-side from the company's country — no
 * country control appears on this form (D19). GST required-ness is driven by
 * isIndia state keyed off the selected company's country (D20). When no company
 * is selected, GST is optional (D21).
 *
 * Stage 15 Batch F:
 *   C5 — Project Budget formats on blur using formatBudget() helper (decision 7).
 *   C6 — Currency select defaults to company's defaultCurrency, else INR (decision 6).
 *   C9 — HTML5 pattern restrictions: budget (digits/commas/dots), name fields
 *         (alphanumeric + space + hyphen). Client-side only (decision 8).
 *
 * The `inquiries` namespace is forwarded in the ancestor layout's clientMessages —
 * verified in app/[orgSlug]/inquiries/layout.tsx.
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

  // C6: currency defaults to company's defaultCurrency, else INR (decision 6).
  const [selectedCurrency, setSelectedCurrency] = useState<string>(
    lockedCompany?.defaultCurrency ?? "INR",
  );

  // C5: budget display value — controlled input, formatted on blur (decision 7).
  const [budgetValue, setBudgetValue] = useState("");

  // Local today in YYYY-MM-DD format (browser-side, avoids UTC offset from new Date().toISOString())
  const todayLocal = (() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  })();

  // Shared input className
  const inputCls =
    "rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-heading placeholder:text-text-placeholder focus:outline-none focus:ring-2 focus:ring-primary/40";
  const selectCls =
    "rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-heading focus:outline-none focus:ring-2 focus:ring-primary/40";
  const labelCls = "text-[10px] font-bold uppercase tracking-wider text-text-muted";

  // C5: reformat the budget field using the given currency (defaults to the
  // currently selected one). Called on blur (decision 7) and immediately when
  // currency changes (B2 fix, Stage 20 — safe for a cross-field change event).
  function reformatBudget(currency: string = selectedCurrency) {
    const raw = stripGroupingSeparators(budgetValue.trim());
    const formatted = formatBudget(raw, currency);
    setBudgetValue(formatted === "—" ? "" : formatted);
  }

  // ── Quick Estimate (Stage 33, S33-19 / S33-20) ────────────────────────────────────────────────────
  const qe = useTranslations("quickEstimate");
  const est = useEstimate();
  const formRef = useRef<HTMLFormElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const { toast, show: showToast, hide: hideToast } = useUndoToast();
  // The estimate attached to this form, held in memory until Create Inquiry posts it with the form.
  const [attached, setAttached] = useState<AttachedEstimate | null>(null);
  const [folded, setFolded] = useState<boolean[]>([false, false, false]);
  // Set while the export overlay is open: the live End client / project name, read when it was opened.
  const [exporting, setExporting] = useState<{ preparedFor: string; projectName: string } | null>(null);
  const formCurrency: SupportedCurrency = isSupportedCurrency(selectedCurrency) ? selectedCurrency : "INR";
  const hasDraft = est.draft.hasDraft;

  function toggleFold(i: number) {
    setFolded((f) => f.map((v, j) => (j === i ? !v : v)));
  }

  function readExportMeta() {
    const fd = formRef.current ? new FormData(formRef.current) : null;
    const text = (k: string) => String(fd?.get(k) ?? "").trim();
    return { preparedFor: text("endClientName"), projectName: text("name") };
  }

  /** The popup's primary button (Attach / Update): keep the snapshot, write it back to the draft (D-23), fold. */
  function handleAttach(snapshot: EstimateDraft) {
    const wasAttached = attached !== null;
    setAttached(draftToAttached(snapshot));
    est.draft.reset({ ...snapshot, lines: pricedDraftLines(snapshot).map((l) => ({ ...l, flag: false })) });
    setFolded([true, true, true]);
    // The section mounts on this render; scroll to it and flash it once it exists (v3 mockup).
    setTimeout(() => {
      const el = sectionRef.current;
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      el.classList.remove("qe-est-flash");
      void el.offsetWidth;
      el.classList.add("qe-est-flash");
    }, 240);
    showToast(wasAttached ? qe("toastUpdated") : qe("toastAttached"));
  }

  /** Add / Continue / Edit estimate, and the top-bar calculator icon while this form is mounted. */
  function openEstimate(trigger: HTMLElement | null) {
    if (!est.enabled) return;
    const mode: InquiryMode = {
      currency: formCurrency,
      isUpdate: attached !== null,
      onAttach: handleAttach,
      getExportMeta: readExportMeta,
    };
    if (attached) {
      // Editing: a storage-free copy seeded from the attached values, so the shared draft is untouched until Update.
      let seq = 0;
      est.session.reset(storedToDraft({ ...attached.input, currency: attached.currency }, est.types, formCurrency, () => `s${++seq}`));
      est.open({ kind: "inquiry", source: "session", mode, returnFocus: trigger });
    } else {
      // A fresh estimate uses the shared draft, switched to the form's currency (flags priced rates, D-28).
      if (est.draft.draft.currency !== formCurrency) est.draft.setCurrency(formCurrency);
      est.open({ kind: "inquiry", source: "draft", mode, returnFocus: trigger });
    }
  }

  /** Remove clears the attached estimate and the draft lines, reopens the sections; Undo restores both (D-23). */
  function removeEstimate() {
    if (!attached) return;
    const prevAttached = attached;
    const prevDraft = est.draft.draft;
    setAttached(null);
    est.draft.clearLines();
    setFolded([false, false, false]);
    addBtnRef.current?.focus();
    showToast(qe("toastRemoved"), () => {
      setAttached(prevAttached);
      est.draft.reset(prevDraft);
    });
  }

  // The top-bar icon opens this form's inquiry-mode popup while the form is mounted (S33-19).
  const openRef = useRef(openEstimate);
  useEffect(() => {
    openRef.current = openEstimate;
  });
  const { registerInquiryOpener } = est;
  useEffect(() => {
    registerInquiryOpener((trigger) => openRef.current(trigger));
    return () => registerInquiryOpener(null);
  }, [registerInquiryOpener]);

  // A successful Create clears the draft lines (D-23). createInquiry ends in a redirect, so there is no return
  // value to read: a submit that never produced a new action state, followed by this form unmounting, is a
  // success (a failure returns state and keeps the form mounted). Only when an estimate was attached.
  const submitted = useRef(false);
  useEffect(() => {
    submitted.current = false;
  }, [state]);
  const clearDraftLines = est.draft.clearLines;
  useEffect(
    () => () => {
      if (submitted.current) clearDraftLines();
    },
    [clearDraftLines],
  );

  // A folded (inert) section can't show the browser's validation bubble: unfold everything first, then re-report.
  function unfoldIfInvalid(e: ReactMouseEvent<HTMLButtonElement>) {
    const form = formRef.current;
    if (!form || !folded.some(Boolean) || form.checkValidity()) return;
    e.preventDefault();
    setFolded([false, false, false]);
    requestAnimationFrame(() => form.reportValidity());
  }

  return (
    <>
      <LoadingOverlay visible={isPending} />

      {/* Error banner */}
      {state.error && (
        <div className="mb-5 rounded-sm border border-status-failed-text/20 bg-status-failed-bg px-4 py-3">
          <p className="text-sm font-semibold text-status-failed-text">{state.error}</p>
        </div>
      )}

      <form
        ref={formRef}
        action={formAction}
        onSubmit={() => {
          submitted.current = attached !== null;
        }}
      >
        <input type="hidden" name="orgSlug" value={orgSlug} />

        {/* ═══════════════════════════════════════════════════════════════════
            Card 1 — Project Information
        ═══════════════════════════════════════════════════════════════════ */}
        <FoldCard
          title={t("sectionProjectInfo")}
          subtitle="Core details about this inquiry and its project"
          folded={folded[0]}
          onToggle={() => toggleFold(0)}
        >
          <div className="p-5">
            {/* 2-col grid — C2: Inquiry Id left, Company right in Row 1 */}
            <div className="grid grid-cols-1 gap-x-5 gap-y-0 sm:grid-cols-2">
              {/* Row 1 left — Inquiry Id (disabled, autogenerated — C2, C3) */}
              <div className="flex flex-col gap-1 mb-[14px]">
                <label className={labelCls}>{t("fieldId")}</label>
                <input
                  type="text"
                  disabled
                  value="—"
                  title="Inquiry Id will be autogenerated"
                  className={`${inputCls} cursor-not-allowed opacity-60`}
                />
              </div>

              {/* Row 1 right — Company (C1, C2) */}
              <div className="flex flex-col gap-1 mb-[14px]">
                <label
                  htmlFor={lockedCompany ? undefined : "externalCompanyId"}
                  className={labelCls}
                >
                  {t("fieldExternalCompany")}
                </label>
                {lockedCompany ? (
                  <>
                    <input type="hidden" name="externalCompanyId" value={lockedCompany.id} />
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

              {/* Row 2 left — Project Name * (C4) */}
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
                  placeholder={t("fieldProjectLocationPlaceholder")}
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
                  onBlur={() => reformatBudget()}
                  className={inputCls}
                />
              </div>

              {/* Row 3 right — Currency * (C6: controlled, defaults to company currency) */}
              <div className="flex flex-col gap-1 mb-[14px]">
                <label htmlFor="currency" className={labelCls}>
                  {t("fieldCurrency")}{" "}
                  <span className="text-status-failed-text font-normal">*</span>
                </label>
                <SelectField
                  id="currency"
                  name="currency"
                  required
                  value={selectedCurrency}
                  onChange={(e) => {
                    const newCurrency = e.target.value;
                    setSelectedCurrency(newCurrency);
                    reformatBudget(newCurrency);
                  }}
                  className={selectCls}
                  placeholder="Select currency"
                >
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </SelectField>
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
                  defaultValue={todayLocal}
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
                  className={inputCls}
                />
              </div>
            </div>
          </div>
        </FoldCard>

        {/* ═══════════════════════════════════════════════════════════════════
            Card 2 — Contractor & Consultant Details
        ═══════════════════════════════════════════════════════════════════ */}
        <FoldCard
          title={t("sectionContractorDetails")}
          subtitle="Contractors and consultants tied to this project"
          folded={folded[1]}
          onToggle={() => toggleFold(1)}
        >
          <div className="p-5 grid grid-cols-1 gap-x-5 gap-y-0 sm:grid-cols-2">
            <div className="flex flex-col gap-1 mb-[14px]">
              <label htmlFor="mainContractorName" className={labelCls}>
                {t("fieldMainContractorName")}{" "}
                <span className="text-status-failed-text font-normal">*</span>
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
                className={inputCls}
              />
            </div>
          </div>
        </FoldCard>

        {/* ═══════════════════════════════════════════════════════════════════
            Card 3 — End Client Details
        ═══════════════════════════════════════════════════════════════════ */}
        <FoldCard
          title={t("sectionEndClientDetails")}
          subtitle="Contact and billing details for the end client"
          folded={folded[2]}
          onToggle={() => toggleFold(2)}
        >
          <div className="p-5 grid grid-cols-1 gap-x-5 gap-y-0 sm:grid-cols-2">
            {/* End Client Name */}
            <div className="flex flex-col gap-1 mb-[14px]">
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
            <div className="flex flex-col gap-1 mb-[14px]">
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
            <div className="flex flex-col gap-1 mb-[14px]">
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

            {/* GST Number — optional (D20) */}
            <div className="flex flex-col gap-1 mb-[14px]">
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
            <div className="flex flex-col gap-1 mb-[14px]">
              <label htmlFor="endClientAddressLine1" className={labelCls}>
                {t("fieldEndClientAddressLine1")}
              </label>
              <input
                id="endClientAddressLine1"
                name="endClientAddressLine1"
                type="text"
                autoComplete="off"
                placeholder={t("fieldEndClientAddressLine1Placeholder")}
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
                placeholder={t("fieldEndClientAddressLine2Placeholder")}
                className={inputCls}
              />
            </div>

            {/* City */}
            <div className="flex flex-col gap-1 mb-[14px]">
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

            {/* State */}
            <div className="flex flex-col gap-1 mb-[14px]">
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

        </FoldCard>

        {/* ═══════════════════════════════════════════════════════════════════
            Estimate (Stage 33, S33-20) — appears once an estimate is attached
        ═══════════════════════════════════════════════════════════════════ */}
        {attached && (
          <>
            <EstimatePanel
              sectionRef={sectionRef}
              view={{ currency: attached.currency, ...attached.input }}
              inquiryCurrency={selectedCurrency}
              canEdit
              guardOn={est.enabled}
              onEdit={openEstimate}
              onExport={() => setExporting(readExportMeta())}
              onRemove={removeEstimate}
            />
            {/* The estimate rides the form post as JSON; the server validates it (S33-17). */}
            <input type="hidden" name="quickEstimate" value={JSON.stringify(attached.input)} />
          </>
        )}

        {/* Actions: Add / Continue / Edit estimate on the left, Cancel / Create on the right (v3 mockup) */}
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-bg-white px-5 py-3 shadow-card">
          <EstimateActionButton
            enabled={est.enabled}
            buttonRef={addBtnRef}
            onClick={openEstimate}
            data-testid="qe-add-estimate"
            className="relative inline-flex items-center gap-2 rounded-sm border border-border bg-bg-white px-4 py-2.5 text-sm font-bold text-primary-dark hover:border-primary-soft hover:bg-primary-softer"
          >
            {attached ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="5" y="2.5" width="14" height="19" rx="2" />
                <rect x="8" y="5.5" width="8" height="4" rx=".5" />
                <path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01" />
              </svg>
            )}
            {attached ? qe("editEstimate") : hasDraft ? qe("continueEstimate") : qe("addEstimate")}
            {!attached && hasDraft && est.enabled && (
              <span
                data-testid="qe-add-dot"
                className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-bg-white bg-primary"
                aria-hidden="true"
              />
            )}
          </EstimateActionButton>
          <span className="flex-1" />
          <Link
            href={backHref}
            className="inline-flex items-center rounded-sm border border-border bg-bg-white px-5 py-2.5 text-sm font-bold text-text-body hover:bg-primary-softer hover:text-text-heading"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isPending}
            onClick={unfoldIfInvalid}
            className="inline-flex items-center rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("submitCreate")}
          </button>
        </div>
      </form>

      {exporting && attached && (
        <ExportOverlay
          orgName={est.orgName}
          currency={attached.currency}
          lines={attached.input.lines}
          result={evaluateEstimate({ currency: attached.currency, ...attached.input })}
          initialPreparedFor={exporting.preparedFor}
          projectName={exporting.projectName}
          onClose={() => setExporting(null)}
        />
      )}
      <UndoToast toast={toast} onDone={hideToast} />
    </>
  );
}
