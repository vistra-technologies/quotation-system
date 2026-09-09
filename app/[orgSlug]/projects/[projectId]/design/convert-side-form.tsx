"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import { redirectToLogin } from "./login-redirect";
import { useUnit } from "./unit-context";
import type { RoomRow } from "./types";

interface ConvertSideFormProps {
  orgSlug: string;
  isSubdomain: boolean;
  floorId: string;
  roomId: string;
  /** Array index of the PLAIN side being converted — identity is by array
   * index, not side.id (PLAIN side ids are not stable across reorders, per
   * review-item2-round2.md finding 9). */
  sideIndex: number;
  onCancel: () => void;
  /** Called with the freshly PATCHed room on success. */
  onConverted: (room: RoomRow) => void;
}

/**
 * "Convert to Partition" form — mirrors design-step-poc.html's
 * `renderWallDetails` plain-side branch. Client `fetch()`
 * (plan-item7.md flag 6), but per architect-review-item7.md's binding
 * condition on that flag: this is a full-array `sides` PATCH, so it
 * RE-READS the room's current sides fresh via GET immediately before
 * building the payload — never trusts a stale prop/cache, matching
 * lib/data/rooms.ts replaceSides()'s own "never trust the client for array
 * state" posture (same rule the now-removed convertSideAction followed).
 */
export function ConvertSideForm({
  orgSlug,
  isSubdomain,
  floorId,
  roomId,
  sideIndex,
  onCancel,
  onConverted,
}: ConvertSideFormProps) {
  const t = useTranslations("design");
  const { unit, fromDisplay } = useUnit();
  const [label, setLabel] = useState("");
  const [heightInput, setHeightInput] = useState("");
  const [widthInput, setWidthInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setError("Label is required.");
      return;
    }
    const heightValue = Number(heightInput);
    const widthValue = Number(widthInput);
    if (!heightInput || isNaN(heightValue) || heightValue <= 0) {
      setError("Height must be a positive number.");
      return;
    }
    if (!widthInput || isNaN(widthValue) || widthValue <= 0) {
      setError("Width must be a positive number.");
      return;
    }
    const heightMm = Math.round(fromDisplay(heightValue));
    const widthMm = Math.round(fromDisplay(widthValue));

    setSubmitting(true);
    setError(null);
    try {
      // Re-read current server state before building the payload — see doc
      // comment above.
      const roomsRes = await fetch(
        `/api/v1/orgs/${orgSlug}/rooms?floorId=${floorId}`,
      );
      if (roomsRes.status === 401 || roomsRes.status === 403) {
        redirectToLogin(orgSlug, isSubdomain);
        return;
      }
      if (!roomsRes.ok) {
        setError("Could not load the room — please try again.");
        return;
      }
      const { rooms } = (await roomsRes.json()) as { rooms: RoomRow[] };
      const room = rooms.find((r) => r.id === roomId);
      if (!room) {
        setError("Room not found — please reload and try again.");
        return;
      }
      if (sideIndex < 0 || sideIndex >= room.sides.length) {
        setError("Side no longer exists — please reload and try again.");
        return;
      }
      const targetSide = room.sides[sideIndex];
      if (targetSide.kind !== "PLAIN") {
        setError("This side has already been converted — please reload.");
        return;
      }

      const newSides = room.sides.map((side, i) => {
        if (i === sideIndex) {
          return {
            kind: "PARTITION" as const,
            turnDegrees: side.turnDegrees,
            label: trimmedLabel,
            heightMm,
            widthMm,
          };
        }
        if (side.kind === "PARTITION") {
          return {
            kind: "PARTITION" as const,
            turnDegrees: side.turnDegrees,
            partitionId: side.partitionId,
          };
        }
        return {
          kind: "PLAIN" as const,
          turnDegrees: side.turnDegrees,
          lengthMm: side.lengthMm,
          label: side.label,
        };
      });

      const patchRes = await fetch(
        `/api/v1/orgs/${orgSlug}/rooms/${roomId}/sides`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sides: newSides }),
        },
      );
      if (patchRes.status === 401 || patchRes.status === 403) {
        redirectToLogin(orgSlug, isSubdomain);
        return;
      }
      if (!patchRes.ok) {
        const body = (await patchRes.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "An unexpected error occurred — please try again.");
        return;
      }

      const { room: updatedRoom } = (await patchRes.json()) as { room: RoomRow };
      onConverted(updatedRoom);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative rounded-md border border-border bg-bg-card p-3.5">
      <LoadingOverlay visible={submitting} />
      <h4 className="mb-2.5 text-xs font-bold text-text-heading">
        {t("convertPanelTitle")}
      </h4>
      {error && <p className="mb-2 text-xs text-red-700 dark:text-red-400">{error}</p>}
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
            {t("fieldLocation")}
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoComplete="off"
            className="rounded-sm border border-border bg-bg-white px-2.5 py-1.5 text-xs text-text-body placeholder:text-text-placeholder focus:border-primary focus:outline-none"
          />
        </div>
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
              {t("fieldWidth")} ({unit})
            </span>
            <input
              type="number"
              step="any"
              value={widthInput}
              onChange={(e) => setWidthInput(e.target.value)}
              className="rounded-sm border border-border bg-bg-white px-2.5 py-1.5 text-xs text-text-body focus:border-primary focus:outline-none"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
              {t("fieldHeight")} ({unit})
            </span>
            <input
              type="number"
              step="any"
              value={heightInput}
              onChange={(e) => setHeightInput(e.target.value)}
              className="rounded-sm border border-border bg-bg-white px-2.5 py-1.5 text-xs text-text-body focus:border-primary focus:outline-none"
            />
          </label>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
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
      </div>
    </div>
  );
}
