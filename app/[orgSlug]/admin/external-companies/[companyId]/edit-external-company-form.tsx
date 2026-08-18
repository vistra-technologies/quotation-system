"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import { updateExternalCompany, type UpdateExternalCompanyState } from "../actions";

interface EditExternalCompanyFormProps {
  orgSlug: string;
  companyId: string;
  initialName: string;
  initialType: string;
  initialCountry: string;
  initialDefaultCurrency: string;
}

const initialState: UpdateExternalCompanyState = { error: null };

/**
 * Client Component form for editing an existing external company.
 *
 * Uses useActionState (React 19) so the server action can return a user-readable
 * error rather than crashing to an error boundary.
 *
 * Mirrors CreateExternalCompanyForm with all fields editable (name, type,
 * country, defaultCurrency). The backend-generated id is not editable.
 *
 * Stage 13 Batch 2.
 */
export function EditExternalCompanyForm({
  orgSlug,
  companyId,
  initialName,
  initialType,
  initialCountry,
  initialDefaultCurrency,
}: EditExternalCompanyFormProps) {
  const t = useTranslations("externalCompanies");
  const [state, formAction, isPending] = useActionState(updateExternalCompany, initialState);

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
        <input type="hidden" name="companyId" value={companyId} />

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
            defaultValue={initialName}
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
            defaultValue={initialType}
            className="rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
          >
            <option value="DISTRIBUTOR">{t("typeDistributor")}</option>
            <option value="ARCHITECTURAL_FIRM">{t("typeArchitecturalFirm")}</option>
          </select>
        </div>

        {/* Country */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="country"
            className="text-xs font-bold uppercase tracking-wide text-text-muted"
          >
            {t("fieldCountry")}
          </label>
          <select
            id="country"
            name="country"
            required
            defaultValue={initialCountry}
            className="rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
          >
            <option value="INDIA">{t("countryIndia")}</option>
            <option value="UAE">{t("countryUAE")}</option>
          </select>
        </div>

        {/* Default Currency */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="defaultCurrency"
            className="text-xs font-bold uppercase tracking-wide text-text-muted"
          >
            {t("fieldDefaultCurrency")}
          </label>
          <select
            id="defaultCurrency"
            name="defaultCurrency"
            required
            defaultValue={initialDefaultCurrency}
            className="rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
          >
            <option value="INR">{t("currencyINR")}</option>
            <option value="AED">{t("currencyAED")}</option>
            <option value="USD">{t("currencyUSD")}</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
        >
          {t("submitEdit")}
        </button>
      </form>
    </>
  );
}
