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
  /** Display title shown above the form — typically "{Room} {Side} Wall". */
  wallTitle: string;
  /**
   * Auto-generated partition label — shown as the editable name field's
   * default value. Bug 8a: the user can edit this before converting.
   * Derived from the room and side names by the parent (kebab-case format,
   * bug 8b) and recomputed from the room's *current* name on every render.
   */
  autoLabel: string;
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
 * `renderWallDetails` plain-side branch (lines 1262-1336). Width + height
 * inputs only; label is auto-generated from the room/side name (no user
 * input for partition name at conversion time, matching the mockup).
 *
 * Client `fetch()` (plan-item7.md flag 6), but per architect-review-item7.md's
 * binding condition on that flag: this is a full-array `sides` PATCH, so it
 * RE-READS the room's current sides fresh via GET immediately before building
 * the payload — never trusts a stale prop/cache, matching
 * lib/data/rooms.ts replaceSides()'s own "never trust the client for array
 * state" posture.
 *
 * Auth/tenancy: the PATCH /rooms/[id]/sides endpoint enforces
 * getApiSession (401/403 → redirect), organizationId row-level isolation,
 * and the InvalidSidesError guards inside replaceSides(). These checks are
 * inherited by this component via the API call — no duplicated guard needed
 * here (the retired add-wall server action also delegated to the same API
 * path for tenancy enforcement).
 */
export function ConvertSideForm({
  orgSlug,
  isSubdomain,
  floorId,
  roomId,
  wallTitle,
  autoLabel,
  sideIndex,
  onCancel,
  onConverted,
}: ConvertSideFormProps) {
  const t = useTranslations("design");
  const { unit, toDisplay, fromDisplay } = useUnit();

  // Canonical mm is the source of truth — the displayed value is derived from
  // it via toDisplay() on every render, so switching the unit toggle mid-form
  // re-interprets the *same* canonical number through the new unit instead of
  // silently reinterpreting stale digits. Mirrors the mockup's renderAll()
  // rebuilding every input from toDisplay() whenever the unit changes.
  // Bug 8a: editable label field — pre-filled with autoLabel (the kebab-case
  // default, bug 8b), but the user can change it before submitting.
  const [labelValue, setLabelValue] = useState(autoLabel);

  // Keep the label in sync if the room is renamed while this form is open
  // (autoLabel re-derives from room.label on every render in the parent;
  // only sync when the user hasn't touched the field yet — tracked via
  // a "label is still the default" check rather than a separate dirty flag).
  const [prevAutoLabel, setPrevAutoLabel] = useState(autoLabel);
  if (prevAutoLabel !== autoLabel && labelValue === prevAutoLabel) {
    // autoLabel changed AND user hasn't deviated from the default — track.
    setPrevAutoLabel(autoLabel);
    setLabelValue(autoLabel);
  } else if (prevAutoLabel !== autoLabel) {
    setPrevAutoLabel(autoLabel);
  }

  const [heightMm, setHeightMm] = useState<number | null>(null);
  const [widthMm, setWidthMm] = useState<number | null>(null);
  // Raw text mirrors — hold exactly what the user typed.
  const [heightText, setHeightText] = useState("");
  const [widthText, setWidthText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If the unit changes (dead code since Stage 20 B5 removed the toggle),
  // clear raw text mirrors so the display re-derives from canonical mm.
  const [prevUnit, setPrevUnit] = useState(unit);
  if (prevUnit !== unit) {
    setPrevUnit(unit);
    setHeightText("");
    setWidthText("");
  }

  const heightDisplay = heightText !== "" ? heightText : heightMm !== null ? String(toDisplay(heightMm)) : "";
  const widthDisplay = widthText !== "" ? widthText : widthMm !== null ? String(toDisplay(widthMm)) : "";

  function handleHeightChange(text: string) {
    setHeightText(text);
    const parsed = Number(text);
    setHeightMm(text !== "" && !isNaN(parsed) ? fromDisplay(parsed) : null);
  }
  function handleWidthChange(text: string) {
    setWidthText(text);
    const parsed = Number(text);
    setWidthMm(text !== "" && !isNaN(parsed) ? fromDisplay(parsed) : null);
  }

  async function submit() {
    const finalLabel = labelValue.trim() || autoLabel;
    if (heightMm === null || heightMm <= 0) {
      setError("Height must be a positive number.");
      return;
    }
    if (widthMm === null || widthMm <= 0) {
      setError("Width must be a positive number.");
      return;
    }
    const finalHeightMm = Math.round(heightMm);
    const finalWidthMm = Math.round(widthMm);

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
            label: finalLabel,
            heightMm: finalHeightMm,
            widthMm: finalWidthMm,
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
    <div className="relative mt-4 border-t border-border pt-3.5">
      <LoadingOverlay visible={submitting} />
      {/* Title — mirrors mockup's wall-details-title (room + side name) */}
      <p className="mb-0.5 text-sm font-bold text-text-heading">{wallTitle}</p>
      <p className="mb-4 text-[11.5px] text-text-muted">{t("notYetPartition")}</p>
      {error && <p className="mb-2 text-xs text-red-700 dark:text-red-400">{error}</p>}

      {/* Bug 8a: editable partition name field — pre-filled with the kebab-case
          auto-label (bug 8b), derived from the room's *current* name, editable
          before converting so the user isn't locked into the auto-generated value. */}
      <div className="mb-4">
        <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-[.03em] text-text-muted">
          Partition Name
        </label>
        <input
          type="text"
          value={labelValue}
          onChange={(e) => setLabelValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          placeholder={autoLabel}
          className="block w-full border-0 border-b border-b-border bg-transparent px-0.5 py-1 text-sm font-bold text-text-heading focus:border-b-primary focus:outline-none"
        />
      </div>

      {/* convert-row: width + height side by side */}
      <div className="mb-4 flex gap-[22px]">
        <label className="flex flex-col gap-1.5">
          <span className="text-[10.5px] font-bold uppercase tracking-[.03em] text-text-muted">
            {t("fieldWidth")} ({unit})
          </span>
          <input
            type="number"
            step="any"
            value={widthDisplay}
            onChange={(e) => handleWidthChange(e.target.value)}
            className="w-[72px] border-0 border-b border-b-border bg-transparent px-0.5 py-0.5 text-[13.5px] font-bold text-text-heading focus:border-b-primary focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[10.5px] font-bold uppercase tracking-[.03em] text-text-muted">
            {t("fieldHeight")} ({unit})
          </span>
          <input
            type="number"
            step="any"
            value={heightDisplay}
            onChange={(e) => handleHeightChange(e.target.value)}
            className="w-[72px] border-0 border-b border-b-border bg-transparent px-0.5 py-0.5 text-[13.5px] font-bold text-text-heading focus:border-b-primary focus:outline-none"
          />
        </label>
      </div>
      {/* convert-actions: primary + muted cancel */}
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting}
          className="rounded-full bg-primary px-[18px] py-2 text-xs font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
        >
          {t("convertToPartition")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-bold text-text-muted hover:text-text-heading hover:underline"
        >
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
