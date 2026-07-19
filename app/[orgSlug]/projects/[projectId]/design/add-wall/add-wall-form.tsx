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
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 dark:border-red-700 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">{state.error}</p>
        </div>
      )}

      <form action={formAction} className="mt-6 flex flex-col gap-5">
        {/* Hidden context */}
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="projectId" value={projectId} />

        {/* Location */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="location"
            className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
          >
            {t("fieldLocation")}
          </label>
          <input
            id="location"
            name="location"
            type="text"
            required
            autoComplete="off"
            className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-50"
          />
        </div>

        {/* Floor label — free text with datalist suggestions */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="floorLabel"
            className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
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
            className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-50"
          />
          <datalist id="floor-suggestions">
            {existingFloorLabels.map((label) => (
              <option key={label} value={label} />
            ))}
          </datalist>
        </div>

        {/* Height + unit */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="height"
            className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
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
              className="flex-1 rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-50"
            />
            <select
              name="unit_h"
              className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:focus:ring-zinc-50"
            >
              <option value="mm">{t("unitMm")}</option>
              <option value="feet">{t("unitFeet")}</option>
            </select>
          </div>
        </div>

        {/* Width + unit */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="width"
            className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
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
              className="flex-1 rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-50"
            />
            <select
              name="unit_w"
              className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-50"
            >
              <option value="mm">{t("unitMm")}</option>
              <option value="feet">{t("unitFeet")}</option>
            </select>
          </div>
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {t("submitAddWall")}
        </button>
      </form>
    </>
  );
}
