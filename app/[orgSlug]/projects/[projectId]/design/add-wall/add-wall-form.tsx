"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import { createWall, type CreateWallState } from "./actions";

interface AddWallFormProps {
  orgSlug: string;
  projectId: string;
  /** Existing floor labels for the project — offered as datalist suggestions. */
  existingFloorLabels: string[];
}

const initialState: CreateWallState = { error: null };

/**
 * Client Component form for adding a new wall (Partition) to a project.
 *
 * Fields:
 *   - Location: free text
 *   - Floor: free text with <datalist> of existing floor labels (auto-creates if new)
 *   - Height: number + unit selector (mm / feet)
 *   - Width:  number + unit selector (mm / feet)
 *
 * Unit normalisation is performed server-side in actions.ts before the DAL call.
 * Uses useActionState (React 19) so server-side validation errors surface in the form.
 *
 * Batch 8: restyled zinc-* classes to Sage Ease tokens. No behavior changes.
 */
export function AddWallForm({
  orgSlug,
  projectId,
  existingFloorLabels,
}: AddWallFormProps) {
  const t = useTranslations("design");
  const [state, formAction, isPending] = useActionState(createWall, initialState);

  return (
    <>
      <LoadingOverlay visible={isPending} />

      {state.error && (
        <div className="rounded-sm border border-red-300 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">{state.error}</p>
        </div>
      )}

      <form action={formAction} className="mt-6 flex flex-col gap-5">
        {/* Hidden context */}
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="projectId" value={projectId} />

        {/* Location */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="location"
            className="text-xs font-bold uppercase tracking-wide text-text-muted"
          >
            {t("fieldLocation")}
          </label>
          <input
            id="location"
            name="location"
            type="text"
            required
            autoComplete="off"
            className="rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-body placeholder:text-text-placeholder focus:border-primary focus:outline-none focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
          />
        </div>

        {/* Floor label — free text with datalist suggestions */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="floorLabel"
            className="text-xs font-bold uppercase tracking-wide text-text-muted"
          >
            {t("fieldFloor")}
          </label>
          <input
            id="floorLabel"
            name="floorLabel"
            type="text"
            list="floor-suggestions"
            required
            autoComplete="off"
            placeholder={t("fieldFloorPlaceholder")}
            className="rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-body placeholder:text-text-placeholder focus:border-primary focus:outline-none focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
          />
          <datalist id="floor-suggestions">
            {existingFloorLabels.map((label) => (
              <option key={label} value={label} />
            ))}
          </datalist>
        </div>

        {/* Height + unit */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="height"
            className="text-xs font-bold uppercase tracking-wide text-text-muted"
          >
            {t("fieldHeight")}
          </label>
          <div className="flex gap-2">
            <input
              id="height"
              name="height"
              type="number"
              required
              min="0.01"
              step="any"
              className="flex-1 rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-body placeholder:text-text-placeholder focus:border-primary focus:outline-none focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
            />
            <select
              name="unit_h"
              className="rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-body focus:border-primary focus:outline-none focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
            >
              <option value="mm">{t("unitMm")}</option>
              <option value="feet">{t("unitFeet")}</option>
            </select>
          </div>
        </div>

        {/* Width + unit */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="width"
            className="text-xs font-bold uppercase tracking-wide text-text-muted"
          >
            {t("fieldWidth")}
          </label>
          <div className="flex gap-2">
            <input
              id="width"
              name="width"
              type="number"
              required
              min="0.01"
              step="any"
              className="flex-1 rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-body placeholder:text-text-placeholder focus:border-primary focus:outline-none focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
            />
            <select
              name="unit_w"
              className="rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-body focus:border-primary focus:outline-none focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
            >
              <option value="mm">{t("unitMm")}</option>
              <option value="feet">{t("unitFeet")}</option>
            </select>
          </div>
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-sm bg-primary px-4 py-2.5 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
        >
          {t("submitAddWall")}
        </button>
      </form>
    </>
  );
}
