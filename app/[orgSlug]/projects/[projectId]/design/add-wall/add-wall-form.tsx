"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import {
  resolveFloorAndRoom,
  type ResolveFloorAndRoomState,
} from "./actions";

interface AddWallFormProps {
  orgSlug: string;
  projectId: string;
  /** Existing floor labels for the project — offered as datalist suggestions. */
  existingFloorLabels: string[];
}

interface FloorRow {
  id: string;
  label: string;
}

interface RoomRow {
  id: string;
  label: string;
}

const initialState: ResolveFloorAndRoomState = { error: null };

/**
 * "Add Wall" entry point form (Stage 18 rework of scope item 4).
 *
 * Superseded from the pre-Stage-18 free-text "floor label, auto-create wall
 * inline" flow to a floor-select-or-create + room-select-or-create step
 * ("the flow gains a room step" per the stage doc). Submitting resolves both
 * (creating either if the typed label doesn't already exist) and redirects
 * into the design page with the resolved room auto-expanded — actual wall
 * (Partition) creation happens there via "Convert to Partition" on one of
 * the room's PLAIN sides (design/convert-side-form.tsx), reused rather than
 * duplicated here (see add-wall/actions.ts's doc comment).
 *
 * Room suggestions are fetched client-side once the typed floor label
 * resolves to an existing floor id (a brand-new floor has no rooms yet, so
 * the room field is naturally create-only in that case). Plain browser
 * fetch() to the API route — precedent:
 * app/controls/(authenticated)/orgs/_suspend-button.tsx.
 */
export function AddWallForm({
  orgSlug,
  projectId,
  existingFloorLabels,
}: AddWallFormProps) {
  const t = useTranslations("design");
  const [state, formAction, isPending] = useActionState(
    resolveFloorAndRoom,
    initialState,
  );

  const [floorLabel, setFloorLabel] = useState("");
  const [roomLabels, setRoomLabels] = useState<string[]>([]);

  // When the typed floor label matches an existing floor, fetch its rooms
  // for the room datalist suggestions. A new (unmatched) floor label has no
  // rooms yet — the room field stays create-only.
  useEffect(() => {
    let cancelled = false;

    async function loadRooms() {
      if (!floorLabel.trim()) {
        setRoomLabels([]);
        return;
      }
      const floorsRes = await fetch(
        `/api/v1/orgs/${orgSlug}/floors?projectId=${projectId}`,
      );
      if (!floorsRes.ok) return;
      const { floors } = (await floorsRes.json()) as { floors: FloorRow[] };
      const matched = floors.find((f) => f.label === floorLabel);
      if (!matched) {
        if (!cancelled) setRoomLabels([]);
        return;
      }
      const roomsRes = await fetch(
        `/api/v1/orgs/${orgSlug}/rooms?floorId=${matched.id}`,
      );
      if (!roomsRes.ok) return;
      const { rooms } = (await roomsRes.json()) as { rooms: RoomRow[] };
      if (!cancelled) setRoomLabels(rooms.map((r) => r.label));
    }

    void loadRooms();

    return () => {
      cancelled = true;
    };
  }, [floorLabel, orgSlug, projectId]);

  return (
    <>
      <LoadingOverlay visible={isPending} />

      {state.error && (
        <div className="rounded-sm border border-red-300 bg-red-50 px-4 py-3 dark:border-red-700/50 dark:bg-red-950/30">
          <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
        </div>
      )}

      <form action={formAction} className="mt-6 flex flex-col gap-5">
        {/* Hidden context */}
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="projectId" value={projectId} />

        {/* Floor — free text with datalist suggestions, create-if-new */}
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
            value={floorLabel}
            onChange={(e) => setFloorLabel(e.target.value)}
            className="rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-body placeholder:text-text-placeholder focus:border-primary focus:outline-none focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
          />
          <datalist id="floor-suggestions">
            {existingFloorLabels.map((label) => (
              <option key={label} value={label} />
            ))}
          </datalist>
        </div>

        {/* Room — free text with datalist suggestions scoped to the typed floor */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="roomLabel"
            className="text-xs font-bold uppercase tracking-wide text-text-muted"
          >
            {t("fieldRoom")}
          </label>
          <input
            id="roomLabel"
            name="roomLabel"
            type="text"
            list="room-suggestions"
            required
            autoComplete="off"
            placeholder={t("fieldRoomPlaceholder")}
            className="rounded-sm border border-border bg-bg-white px-3 py-2.5 text-sm text-text-body placeholder:text-text-placeholder focus:border-primary focus:outline-none focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
          />
          <datalist id="room-suggestions">
            {roomLabels.map((label) => (
              <option key={label} value={label} />
            ))}
          </datalist>
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-sm bg-primary px-4 py-2.5 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
        >
          {t("continueButton")}
        </button>
      </form>
    </>
  );
}
