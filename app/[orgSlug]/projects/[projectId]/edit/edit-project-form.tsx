"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import { updateProject, type UpdateProjectState } from "../../actions";

interface EditProjectFormProps {
  orgSlug: string;
  projectId: string;
  /** Current field values — pre-populated into the form. */
  initialName: string;
  initialDestinationCountry: string;
  initialCurrency: string;
  initialProjectLocation: string | null;
  /**
   * The locked External Company linked to this project.
   * Always shown read-only — externalCompanyId is never editable after creation.
   * Null when no company is linked.
   */
  lockedCompany: { id: string; name: string } | null;
}

const initialState: UpdateProjectState = { error: null };

/**
 * Client Component form for editing an existing DRAFT project.
 *
 * Uses useActionState (React 19) so the server action can return a
 * user-readable error rather than crashing to an error boundary.
 *
 * External Company is always shown read-only — the field is locked for the
 * life of the record so the per-company sequence number never needs recomputing.
 *
 * namespace: "projects" — wired in app/[orgSlug]/projects/layout.tsx clientMessages.
 */
export function EditProjectForm({
  orgSlug,
  projectId,
  initialName,
  initialDestinationCountry,
  initialCurrency,
  initialProjectLocation,
  lockedCompany,
}: EditProjectFormProps) {
  const t = useTranslations("projects");
  const [state, formAction, isPending] = useActionState(updateProject, initialState);

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
        <input type="hidden" name="projectId" value={projectId} />

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
            defaultValue={initialName}
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
            defaultValue={initialDestinationCountry}
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
            defaultValue={initialCurrency}
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
            defaultValue={initialProjectLocation ?? ""}
            autoComplete="off"
            className="rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-body placeholder:text-text-placeholder transition-[border-color,box-shadow] duration-150 focus:border-primary focus:outline-none focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
          />
        </div>

        {/* External company — always read-only on the edit form */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wide text-text-muted">
            {t("fieldExternalCompany")}
          </span>
          <p className="rounded-sm border border-border bg-primary-softer/40 px-3 py-2.5 text-sm text-text-body">
            {lockedCompany ? lockedCompany.name : <span className="text-text-placeholder">—</span>}
          </p>
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="mt-1 rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-text-on-primary transition-colors hover:bg-primary-dark disabled:opacity-50"
        >
          {t("submitEdit")}
        </button>
      </form>
    </>
  );
}
