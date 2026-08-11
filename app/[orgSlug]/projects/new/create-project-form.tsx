"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import { CompanyDropdown } from "@/components/company-dropdown";
import { createProject, type CreateProjectState } from "../actions";

interface CreateProjectFormProps {
  orgSlug: string;
  /** Set when the session user is tied to exactly one ExternalCompany — locks the Client field. */
  lockedCompany: { id: string; name: string } | null;
  /** Free-choice list for org members/admins (null lockedCompany). Empty when lockedCompany is set. */
  externalCompanies: { id: string; name: string }[];
}

const initialState: CreateProjectState = { error: null };

/**
 * Client Component form for creating a new project.
 *
 * Uses useActionState (React 19) so the server action can return a
 * user-readable error (e.g. concurrent project number collision) rather
 * than crashing to an error boundary.
 *
 * When lockedCompany is set (session user belongs to a fixed ExternalCompany),
 * the Client field is rendered as read-only text — no dropdown is offered.
 * The company id is submitted via a hidden input; the DAL also enforces this
 * server-side regardless of what the form sends.
 *
 * Stage 11 (Batch 6): restyled to Sage Ease tokens — labels, inputs, select,
 * read-only display, error banner, submit button. No behavior changes.
 *
 * namespace: "projects" — wired in app/[orgSlug]/projects/layout.tsx clientMessages.
 */
export function CreateProjectForm({ orgSlug, lockedCompany, externalCompanies }: CreateProjectFormProps) {
  const t = useTranslations("projects");
  const [state, formAction, isPending] = useActionState(createProject, initialState);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");

  return (
    <>
      <LoadingOverlay visible={isPending} />

      {state.error && (
        <div className="mb-4 rounded-sm border border-red-300 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">{state.error}</p>
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-5">
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="status" value="DRAFT" />

        {/* Project name */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="name"
            className="text-xs font-bold uppercase tracking-wide text-text-muted"
          >
            {t("fieldName")}
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            autoComplete="off"
            className="rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-body placeholder:text-text-placeholder transition-[border-color,box-shadow] duration-150 focus:border-primary focus:outline-none focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
          />
        </div>

        {/* Destination country */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="destinationCountry"
            className="text-xs font-bold uppercase tracking-wide text-text-muted"
          >
            {t("fieldDestinationCountry")}
          </label>
          <input
            id="destinationCountry"
            name="destinationCountry"
            type="text"
            required
            autoComplete="off"
            className="rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-body placeholder:text-text-placeholder transition-[border-color,box-shadow] duration-150 focus:border-primary focus:outline-none focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
          />
        </div>

        {/* Currency */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="currency"
            className="text-xs font-bold uppercase tracking-wide text-text-muted"
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
            className="rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-body placeholder:text-text-placeholder transition-[border-color,box-shadow] duration-150 focus:border-primary focus:outline-none focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
          />
        </div>

        {/* Project Location (optional) */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="projectLocation"
            className="text-xs font-bold uppercase tracking-wide text-text-muted"
          >
            {t("fieldProjectLocation")}
            <span className="ml-1 font-normal normal-case text-text-placeholder">(optional)</span>
          </label>
          <input
            id="projectLocation"
            name="projectLocation"
            type="text"
            autoComplete="off"
            className="rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-body placeholder:text-text-placeholder transition-[border-color,box-shadow] duration-150 focus:border-primary focus:outline-none focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
          />
        </div>

        {/* External company — locked (external user) or free-choice dropdown (member/admin) */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={lockedCompany ? undefined : "externalCompanyId"}
            className="text-xs font-bold uppercase tracking-wide text-text-muted"
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
              onChange={setSelectedCompanyId}
              noneLabel={t("fieldExternalCompanyNone")}
              ariaLabel={t("fieldExternalCompany")}
            />
          )}
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="mt-1 rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-text-on-primary transition-colors hover:bg-primary-dark disabled:opacity-50"
        >
          {t("submitCreate")}
        </button>
      </form>
    </>
  );
}
