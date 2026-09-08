"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import { createRoomAction, type CreateRoomState } from "./actions";

interface NewRoomFormProps {
  orgSlug: string;
  projectId: string;
  floorId: string;
  onCancel: () => void;
}

const initialState: CreateRoomState = { error: null };

/**
 * Inline "New Room" form (Stage 18 scope item 4-2) — appears under a floor's
 * room list in DesignLeftRail. Calls createRoomAction, which POSTs
 * /api/v1/orgs/[orgSlug]/rooms (defaults to a 4-side PLAIN rectangle,
 * lib/data/rooms.ts createRoom()) and redirects back to the design page with
 * the new room auto-expanded.
 */
export function NewRoomForm({
  orgSlug,
  projectId,
  floorId,
  onCancel,
}: NewRoomFormProps) {
  const t = useTranslations("design");
  const [state, formAction, isPending] = useActionState(
    createRoomAction,
    initialState,
  );

  return (
    <div className="mt-1 rounded-sm border border-dashed border-border bg-bg-white p-3">
      <LoadingOverlay visible={isPending} />
      {state.error && (
        <p className="mb-2 text-xs text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="floorId" value={floorId} />
        <input
          name="label"
          type="text"
          required
          autoFocus
          placeholder={t("fieldRoomPlaceholder")}
          className="rounded-sm border border-border bg-bg-white px-2.5 py-1.5 text-xs text-text-body placeholder:text-text-placeholder focus:border-primary focus:outline-none"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isPending}
            className="flex-1 rounded-sm bg-primary px-2.5 py-1.5 text-xs font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
          >
            {t("createRoom")}
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
