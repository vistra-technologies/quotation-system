"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import { createExternalCompany, type CreateExternalCompanyState } from "../actions";

interface CreateExternalCompanyFormProps {
  orgSlug: string;
}

const initialState: CreateExternalCompanyState = { error: null };

/**
 * Client Component form for creating a new external company.
 *
 * Uses useActionState (React 19) so the server action can return a user-readable
 * error rather than crashing to an error boundary.
 *
 * Stage 11 Batch 8: restyled to Sage Ease tokens. No logic changes.
 */
export function CreateExternalCompanyForm({ orgSlug }: CreateExternalCompanyFormProps) {
  const t = useTranslations("externalCompanies");
  const [state, formAction, isPending] = useActionState(createExternalCompany, initialState);

  return (
    <>
      <LoadingOverlay visible={isPending} />

      {state.error && (
        <div className="mb-4 rounded-sm border border-status-failed-bg bg-status-failed-bg px-4 py-3">
          <p className="text-sm text-status-failed-text">{state.error}</p>
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-5">
        <input type="hidden" name="orgSlug" value={orgSlug} />

        {/* Name */}
        <div className="flex flex-col gap-1">
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
            className="rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body placeholder:text-text-placeholder focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
          />
        </div>

        {/* Type */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="type"
            className="text-xs font-bold uppercase tracking-wide text-text-muted"
          >
            {t("fieldType")}
          </label>
          <select
            id="type"
            name="type"
            required
            className="rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
          >
            <option value="DISTRIBUTOR">{t("typeDistributor")}</option>
            <option value="ARCHITECTURAL_FIRM">{t("typeArchitecturalFirm")}</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
        >
          {t("submitCreate")}
        </button>
      </form>
    </>
  );
}
