"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import { convertSideAction, type ConvertSideState } from "./actions";

interface ConvertSideFormProps {
  orgSlug: string;
  projectId: string;
  floorId: string;
  roomId: string;
  /** Array index of the PLAIN side being converted (see actions.ts doc comment
   * — identity is by array index, not side.id, per review-item2-round2.md
   * finding 9: PLAIN side ids are not stable across reorders). */
  sideIndex: number;
  onCancel: () => void;
}

const initialState: ConvertSideState = { error: null };

/**
 * "Convert to Partition" form (Stage 18 scope item 4-3) — adapted from the
 * pre-Stage-18 add-wall/add-wall-form.tsx (same label + height/width + unit
 * fields), but targets a specific side of an existing Room instead of
 * creating a standalone Partition directly. Submits to convertSideAction,
 * which PATCHes the room's sides array (full-replace contract).
 */
export function ConvertSideForm({
  orgSlug,
  projectId,
  floorId,
  roomId,
  sideIndex,
  onCancel,
}: ConvertSideFormProps) {
  const t = useTranslations("design");
  const [state, formAction, isPending] = useActionState(
    convertSideAction,
    initialState,
  );

  return (
    <div className="mt-1 rounded-sm border border-border bg-bg-white p-3">
      <LoadingOverlay visible={isPending} />
      {state.error && (
        <p className="mb-2 text-xs text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
      <form action={formAction} className="flex flex-col gap-2.5">
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="floorId" value={floorId} />
        <input type="hidden" name="roomId" value={roomId} />
        <input type="hidden" name="sideIndex" value={sideIndex} />

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
            {t("fieldLocation")}
          </label>
          <input
            name="label"
            type="text"
            required
            autoComplete="off"
            className="rounded-sm border border-border bg-bg-white px-2.5 py-1.5 text-xs text-text-body placeholder:text-text-placeholder focus:border-primary focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
            {t("fieldHeight")}
          </label>
          <div className="flex gap-1.5">
            <input
              name="height"
              type="number"
              required
              min="0.01"
              step="any"
              className="flex-1 rounded-sm border border-border bg-bg-white px-2.5 py-1.5 text-xs text-text-body focus:border-primary focus:outline-none"
            />
            <select
              name="unit_h"
              className="rounded-sm border border-border bg-bg-white px-1.5 py-1.5 text-xs text-text-body focus:border-primary focus:outline-none"
            >
              <option value="mm">{t("unitMm")}</option>
              <option value="feet">{t("unitFeet")}</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
            {t("fieldWidth")}
          </label>
          <div className="flex gap-1.5">
            <input
              name="width"
              type="number"
              required
              min="0.01"
              step="any"
              className="flex-1 rounded-sm border border-border bg-bg-white px-2.5 py-1.5 text-xs text-text-body focus:border-primary focus:outline-none"
            />
            <select
              name="unit_w"
              className="rounded-sm border border-border bg-bg-white px-1.5 py-1.5 text-xs text-text-body focus:border-primary focus:outline-none"
            >
              <option value="mm">{t("unitMm")}</option>
              <option value="feet">{t("unitFeet")}</option>
            </select>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isPending}
            className="flex-1 rounded-sm bg-primary px-2.5 py-1.5 text-xs font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
          >
            {t("convertToPartition")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-sm border border-border px-2.5 py-1.5 text-xs text-text-body hover:bg-primary-softer"
          >
            {t("cancel")}
          </button>
        </div>
      </form>
    </div>
  );
}
