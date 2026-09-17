"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import { ConvertSideForm } from "./convert-side-form";
import { redirectToLogin } from "./login-redirect";
import { useUnit } from "./unit-context";
import type { PartitionRow, RoomRow } from "./types";

interface LayoutModePanelProps {
  orgSlug: string;
  isSubdomain: boolean;
  floorId: string;
  room: RoomRow;
  sideIndex: number;
  partitions: PartitionRow[];
  onCancel: () => void;
  onConverted: (room: RoomRow) => void;
  onConfigure: (partitionId: string, sideIndex: number) => void;
}

/**
 * Right-rail content when a side is selected on the floor-plan diagram —
 * mirrors design-step-poc.html's `renderWallDetails` (lines 1262-1408):
 *   - PLAIN side: inline convert form (width + height → Convert / Cancel)
 *   - PARTITION side: spec summary (name, Width / Height / Panels) +
 *     Configure / Remove / Cancel actions
 *
 * The `/design/add-wall` route is retired (S21-C1). All conversion happens
 * inline here — no page navigation.
 */
export function LayoutModePanel({
  orgSlug,
  isSubdomain,
  floorId,
  room,
  sideIndex,
  partitions,
  onCancel,
  onConverted,
  onConfigure,
}: LayoutModePanelProps) {
  const side = room.sides[sideIndex];

  if (side.kind === "PLAIN") {
    // Auto-generate the partition label from room name + side label (matches
    // mockup: room.name + ' ' + cap(side) + ' Wall Partition').
    const wallTitle = side.label
      ? `${room.label} ${side.label} Wall`
      : room.label;
    const autoLabel = side.label
      ? `${room.label} ${side.label} Wall Partition`
      : `${room.label} Partition`;

    return (
      <ConvertSideForm
        orgSlug={orgSlug}
        isSubdomain={isSubdomain}
        floorId={floorId}
        roomId={room.id}
        wallTitle={wallTitle}
        autoLabel={autoLabel}
        sideIndex={sideIndex}
        onCancel={onCancel}
        onConverted={onConverted}
      />
    );
  }

  const partition = partitions.find((p) => p.id === side.partitionId);

  return (
    <PartitionSummaryPanel
      orgSlug={orgSlug}
      isSubdomain={isSubdomain}
      floorId={floorId}
      roomId={room.id}
      sideIndex={sideIndex}
      partitionId={side.partitionId}
      partition={partition ?? null}
      onCancel={onCancel}
      onConverted={onConverted}
      onConfigure={onConfigure}
    />
  );
}

// ─── Partition summary (PARTITION side branch) ────────────────────────────────

interface PartitionSummaryPanelProps {
  orgSlug: string;
  isSubdomain: boolean;
  floorId: string;
  roomId: string;
  sideIndex: number;
  partitionId: string;
  partition: PartitionRow | null;
  onCancel: () => void;
  onConverted: (room: RoomRow) => void;
  onConfigure: (partitionId: string, sideIndex: number) => void;
}

/**
 * Shows the existing partition's name (editable), spec row (Width / Height /
 * Panels), and actions (Configure / Remove / Cancel). Mirrors the PARTITION
 * branch of renderWallDetails (lines 1337-1405 of design-step-poc.html).
 *
 * Name edits are persisted immediately via PATCH /partitions/[id] on blur —
 * they live outside the Configure-mode draft context (which isn't loaded
 * during Layout mode).
 *
 * Remove re-fetches the current sides, replaces the PARTITION entry with a
 * PLAIN entry, then PATCHes /rooms/[id]/sides — which CASCADE-deletes the
 * Partition row inside replaceSides()'s transaction (lib/data/rooms.ts).
 */
function PartitionSummaryPanel({
  orgSlug,
  isSubdomain,
  floorId,
  roomId,
  sideIndex,
  partitionId,
  partition,
  onCancel,
  onConverted,
  onConfigure,
}: PartitionSummaryPanelProps) {
  const t = useTranslations("design");
  const { formatLen } = useUnit();

  const [nameValue, setNameValue] = useState(partition?.label ?? "");
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Keep nameValue in sync if partition prop changes (e.g. parent reloads).
  // React reconciles this during render — not a useEffect.
  //
  // Stage 21 QA bug #12: on a freshly-converted wall, `partition` starts out
  // null here (the parent's partitions list hasn't finished re-fetching yet)
  // while `partitionId` is already set and never changes again for this side
  // — so the old guard (keyed only on partitionId) synced nameValue to ""
  // once and then never again, leaving the label permanently blank even
  // after the real partition data arrived. Track whether we've synced a
  // *loaded* partition's label separately, so the very first time `partition`
  // stops being null for this id, we sync once — without re-fighting the
  // user's own in-progress edits on every subsequent render.
  const [prevPartitionId, setPrevPartitionId] = useState(partitionId);
  const [hasSyncedLabel, setHasSyncedLabel] = useState(partition !== null);
  if (prevPartitionId !== partitionId) {
    setPrevPartitionId(partitionId);
    setNameValue(partition?.label ?? "");
    setHasSyncedLabel(partition !== null);
    setConfirmingRemove(false);
    setRemoveError(null);
  } else if (!hasSyncedLabel && partition) {
    setHasSyncedLabel(true);
    setNameValue(partition.label);
  }

  async function handleNameBlur() {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === partition?.label) return;
    try {
      const res = await fetch(
        `/api/v1/orgs/${orgSlug}/partitions/${partitionId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: trimmed }),
        },
      );
      if (res.status === 401 || res.status === 403) {
        redirectToLogin(orgSlug, isSubdomain);
        return;
      }
      // On error: silently revert to server value.
      if (!res.ok) setNameValue(partition?.label ?? "");
    } catch {
      setNameValue(partition?.label ?? "");
    }
  }

  async function handleRemove() {
    setRemoving(true);
    setRemoveError(null);
    try {
      // Re-read current server state before building the payload (same
      // "never trust stale client state" posture as ConvertSideForm).
      const roomsRes = await fetch(
        `/api/v1/orgs/${orgSlug}/rooms?floorId=${floorId}`,
      );
      if (roomsRes.status === 401 || roomsRes.status === 403) {
        redirectToLogin(orgSlug, isSubdomain);
        return;
      }
      if (!roomsRes.ok) {
        setRemoveError("Could not load the room — please try again.");
        return;
      }
      const { rooms } = (await roomsRes.json()) as { rooms: RoomRow[] };
      const room = rooms.find((r) => r.id === roomId);
      if (!room) {
        setRemoveError("Room not found — please reload and try again.");
        return;
      }
      if (sideIndex < 0 || sideIndex >= room.sides.length) {
        setRemoveError("Side no longer exists — please reload and try again.");
        return;
      }
      const targetSide = room.sides[sideIndex];
      if (targetSide.kind !== "PARTITION") {
        // Already removed on server — propagate the update.
        onConverted(room);
        return;
      }

      // Replace the PARTITION side with a PLAIN side; replaceSides() will
      // cascade-delete the now-orphaned Partition row.
      const newSides = room.sides.map((side, i) => {
        if (i === sideIndex) {
          return {
            kind: "PLAIN" as const,
            turnDegrees: side.turnDegrees,
            lengthMm: null as number | null,
            label: null as string | null,
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
        const body = (await patchRes.json().catch(() => ({}))) as { error?: string };
        setRemoveError(body.error ?? "An unexpected error occurred — please try again.");
        return;
      }
      const { room: updatedRoom } = (await patchRes.json()) as { room: RoomRow };
      onConverted(updatedRoom);
    } catch {
      setRemoveError("Network error — please try again.");
    } finally {
      setRemoving(false);
    }
  }

  const panels = partition?.design?.panels ?? [];

  return (
    <div className="relative mt-4 border-t border-border pt-3.5">
      <LoadingOverlay visible={removing} />

      {/* Editable partition name — mirrors mockup's partition-name-input */}
      <div className="mb-2">
        <input
          type="text"
          value={nameValue}
          onChange={(e) => setNameValue(e.target.value)}
          onBlur={() => void handleNameBlur()}
          className="block w-full border-0 border-b border-b-border bg-transparent px-0.5 py-1 text-sm font-bold text-text-heading focus:border-b-primary focus:outline-none"
        />
      </div>

      {partition ? (
        /* spec-row: Width / Height / Panels */
        <div className="mb-4 flex flex-wrap gap-[22px]">
          <div className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-bold uppercase tracking-[.03em] text-text-muted">
              Width
            </span>
            <span className="text-[13.5px] font-bold text-text-heading">
              {formatLen(partition.widthMm)}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-bold uppercase tracking-[.03em] text-text-muted">
              Height
            </span>
            <span className="text-[13.5px] font-bold text-text-heading">
              {formatLen(partition.heightMm)}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-bold uppercase tracking-[.03em] text-text-muted">
              Panels
            </span>
            <span className="text-[13.5px] font-bold text-text-heading">
              {t("panelsCount", { count: panels.length })}
            </span>
          </div>
        </div>
      ) : (
        <p className="mb-4 text-xs text-text-muted">{t("loadingPartition")}</p>
      )}

      {removeError && (
        <p className="mb-2 text-xs text-red-700 dark:text-red-400">{removeError}</p>
      )}

      {/* convert-actions: Configure (primary) + Remove (danger) + Cancel */}
      {confirmingRemove ? (
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-xs text-text-muted">{t("confirmRemovePartition")}</span>
          <button
            type="button"
            onClick={() => void handleRemove()}
            disabled={removing}
            className="text-xs font-bold text-red-600 hover:underline disabled:opacity-50"
          >
            {t("removePartition")}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingRemove(false)}
            className="text-xs font-bold text-text-muted hover:text-text-heading hover:underline"
          >
            {t("cancel")}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => onConfigure(partitionId, sideIndex)}
            className="rounded-full bg-primary px-[18px] py-2 text-xs font-bold text-text-on-primary hover:bg-primary-dark"
          >
            {t("configurePartition")}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingRemove(true)}
            className="text-xs font-bold text-red-600 hover:underline"
          >
            {t("removePartition")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-bold text-text-muted hover:text-text-heading hover:underline"
          >
            {t("cancel")}
          </button>
        </div>
      )}
    </div>
  );
}
