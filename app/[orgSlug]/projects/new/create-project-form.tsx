"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
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
 */
export function CreateProjectForm({ orgSlug, lockedCompany, externalCompanies }: CreateProjectFormProps) {
  const t = useTranslations("projects");
  const [state, formAction, isPending] = useActionState(createProject, initialState);

  return (
    <>
      <LoadingOverlay visible={isPending} />

      {state.error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 dark:border-red-700 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">{state.error}</p>
        </div>
      )}

      <form action={formAction} className="mt-6 flex flex-col gap-5">
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="status" value="DRAFT" />

        {/* Project name */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="name"
            className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
          >
            {t("fieldName")}
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            autoComplete="off"
            className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-50"
          />
        </div>

        {/* Destination country */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="destinationCountry"
            className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
          >
            {t("fieldDestinationCountry")}
          </label>
          <input
            id="destinationCountry"
            name="destinationCountry"
            type="text"
            required
            autoComplete="off"
            className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-50"
          />
        </div>

        {/* Currency */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="currency"
            className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
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
            className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-50"
          />
        </div>

        {/* External company — locked (external user) or free-choice dropdown (member/admin) */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor={lockedCompany ? undefined : "externalCompanyId"}
            className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
          >
            {t("fieldExternalCompany")}
          </label>
          {lockedCompany ? (
            <>
              <input type="hidden" name="externalCompanyId" value={lockedCompany.id} />
              <p className="rounded-md border border-zinc-200 bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
                {lockedCompany.name}
              </p>
            </>
          ) : (
            <select
              id="externalCompanyId"
              name="externalCompanyId"
              className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:focus:ring-zinc-50"
            >
              <option value="">{t("fieldExternalCompanyNone")}</option>
              {externalCompanies.map((ec) => (
                <option key={ec.id} value={ec.id}>
                  {ec.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {t("submitCreate")}
        </button>
      </form>
    </>
  );
}
