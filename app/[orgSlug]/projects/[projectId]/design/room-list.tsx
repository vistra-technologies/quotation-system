"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { NewRoomForm } from "./new-room-form";
import { PartitionPreview } from "./partition-preview";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { redirectToLogin } from "./login-redirect";
import { useDraftContext } from "./design-draft-context";
import { makeDoorResolver, toPanelViewRows } from "./partition-view";
import type { PartitionRow, RoomRow, SelectionRow } from "./types";

interface RoomListProps {
  orgSlug: string;
  isSubdomain: boolean;
  floorId: string;
  rooms: RoomRow[];
  selectedRoomId: string | null;
  onSelectRoom: (room: RoomRow) => void;
  onRoomCreated: (room: RoomRow) => void;
  /**
   * Optional — called after a room is deleted so the parent can sync its state.
   * design-workspace.tsx is frozen (Track 0 contract) and does not pass this
   * prop; RoomList hides deleted rooms locally using a ref.
   */
  onRoomDeleted?: (roomId: string) => void;
  /**
   * Optional — called when the user clicks a partition row in the left rail to
   * enter Configure mode for that partition.
   *
   * A4↔B1 wiring note: Track B's B1 CTA should call `onOpenAddRoom` (see below)
   * to programmatically open the add-room form. If Track B needs to trigger
   * Configure mode from an interaction outside this component, it should use
   * this prop (once workspace.tsx is extended to pass it).
   *
   * design-workspace.tsx is frozen and does not pass this prop yet. Once it is
   * extended, it should pass `enterConfigureMode` here.
   */
  onSelectPartition?: (partitionId: string, sideIndex: number) => void;
  /**
   * The partition currently open in Configure mode. When provided, only that
   * partition row renders with the active (green left-border + softer bg) style;
   * all others render neutral.
   *
   * design-workspace.tsx is frozen and does not pass this prop yet — until it
   * does, the prop is undefined, and all partition rows default to the correct
   * *unselected* appearance (no spurious active styling).
   */
  selectedPartitionId?: string | null;
  /**
   * The partition most recently saved from Configure mode, if any. RoomList's
   * partitionsByRoom cache is otherwise only populated on first expand and
   * never invalidated — without this, a save (new panels/doors) wouldn't show
   * up in the left rail's per-partition preview until a full page reload
   * (Stage 21 QA bug #18).
   */
  lastSavedPartition?: PartitionRow | null;
  /** The project's Selections — used to normalize each fetched partition's stored v2 design
   * to the panel view (Stage 22, D-6). */
  selections: SelectionRow[];
  /**
   * A4↔B1 wiring note (for reviewers):
   * Track B's B1 empty-state CTA triggers `addingRoomForEmptyState` state in
   * design-workspace.tsx (already implemented, frozen). That shows the
   * NewRoomForm inline in the center column. The left-rail "Add Room" form
   * (this component) is a separate button that users click directly in the rail.
   * No cross-component prop needed for B1 since workspace.tsx already handles
   * its own empty-state variant of the form independently.
   */
}

/**
 * S21-A2/A3/A4: Left-rail room list — collapsible room groups, converted-side
 * count, partition rows with to-scale previews, inline add-room zone.
 *
 * Mirrors design-step-poc.html's renderRoomList + renderAddRoomZone.
 *
 * Layout (top to bottom inside left rail):
 *   1. Rooms-count summary line  ("N rooms · M partitions")
 *   2. + Add Room zone           (button ↔ inline form toggle — A4)
 *   3. Room groups               (collapsible, with delete button — A2)
 *      └ Partition rows          (to-scale preview swatch, clickable — A3)
 */
export function RoomList({
  orgSlug,
  isSubdomain,
  floorId,
  rooms,
  selectedRoomId,
  onSelectRoom,
  onRoomCreated,
  onRoomDeleted,
  onSelectPartition,
  selectedPartitionId,
  lastSavedPartition,
  selections,
}: RoomListProps) {
  const t = useTranslations("design");

  // R-8c: read pending room renames from the draft context so the left rail
  // shows the in-progress name immediately (before the user hits Save).
  const { state: draftState } = useDraftContext();

  // ── Local state ────────────────────────────────────────────────────────────

  // Track locally-deleted room IDs (work around frozen workspace.tsx which
  // can't be notified of room deletions without touching the frozen file).
  const [deletedRoomIds, setDeletedRoomIds] = useState<Set<string>>(new Set());

  const [expandedRoomIds, setExpandedRoomIds] = useState<Set<string>>(new Set());
  const [addingRoom, setAddingRoom] = useState(false);

  // Room-confirm-delete state.
  const [confirmDeleteRoom, setConfirmDeleteRoom] = useState<RoomRow | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Partitions fetched lazily per expanded room. The collection route returns
  // the full Prisma row (including design JSONB), so PartitionPreview can render
  // per-panel proportions.
  const [partitionsByRoom, setPartitionsByRoom] = useState<
    Record<string, PartitionRow[]>
  >({});

  // Coverage-checked refetch — only fetch when a room is expanded and its
  // partition IDs aren't all cached yet (handles newly-converted sides).
  useEffect(() => {
    for (const room of rooms) {
      if (!expandedRoomIds.has(room.id)) continue;
      const partitionSideIds = room.sides
        .filter((s): s is Extract<RoomRow["sides"][number], { kind: "PARTITION" }> => s.kind === "PARTITION")
        .map((s) => s.partitionId);
      if (partitionSideIds.length === 0) continue;

      const cached = partitionsByRoom[room.id];
      const fullyCovered =
        cached !== undefined &&
        partitionSideIds.every((id) => cached.some((p) => p.id === id));
      if (fullyCovered) continue;

      fetch(`/api/v1/orgs/${orgSlug}/partitions?roomId=${room.id}`)
        .then((res) => {
          if (res.status === 401 || res.status === 403) {
            redirectToLogin(orgSlug, isSubdomain);
            return { partitions: [] };
          }
          return res.ok ? res.json() : { partitions: [] };
        })
        .then((data: { partitions: PartitionRow[] }) => {
          setPartitionsByRoom((prev) => ({
            ...prev,
            [room.id]: toPanelViewRows(data.partitions, makeDoorResolver(selections)),
          }));
        })
        .catch(() => {
          setPartitionsByRoom((prev) => ({ ...prev, [room.id]: [] }));
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rooms changes per render; re-running on rooms/expandedRoomIds/partitionsByRoom changes is intentional.
  }, [rooms, expandedRoomIds, orgSlug, isSubdomain]);

  // Patch the cache in place whenever a Configure-mode save reports a fresh
  // partition (bug #18) — replaces the stale cached row wherever it appears,
  // instead of waiting for the "not fully covered" refetch check above (which
  // never re-fires for a partition it already has, however stale). Compared
  // by reference during render (matches this file's prevPartitionId pattern
  // elsewhere) rather than in a useEffect, since design-workspace.tsx hands
  // down a new PartitionRow object on every successful save.
  const [appliedSavedPartition, setAppliedSavedPartition] = useState<PartitionRow | null>(null);
  if (lastSavedPartition && lastSavedPartition !== appliedSavedPartition) {
    setAppliedSavedPartition(lastSavedPartition);
    setPartitionsByRoom((prev) => {
      let changed = false;
      const next: typeof prev = {};
      for (const [roomId, partitions] of Object.entries(prev)) {
        const idx = partitions.findIndex((p) => p.id === lastSavedPartition.id);
        if (idx === -1) {
          next[roomId] = partitions;
          continue;
        }
        changed = true;
        next[roomId] = [
          ...partitions.slice(0, idx),
          lastSavedPartition,
          ...partitions.slice(idx + 1),
        ];
      }
      return changed ? next : prev;
    });
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  function toggleRoom(room: RoomRow) {
    setExpandedRoomIds((prev) => {
      const next = new Set(prev);
      if (next.has(room.id)) next.delete(room.id);
      else next.add(room.id);
      return next;
    });
    onSelectRoom(room);
  }

  async function handleDeleteRoom(room: RoomRow) {
    setDeleteSubmitting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/v1/orgs/${orgSlug}/rooms/${room.id}`, {
        method: "DELETE",
      });
      if (res.status === 401 || res.status === 403) { redirectToLogin(orgSlug, isSubdomain); return; }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setDeleteError(body.error ?? "Failed to delete room — please try again.");
        return;
      }

      // Hide the deleted room locally.
      setDeletedRoomIds((prev) => new Set([...prev, room.id]));
      onRoomDeleted?.(room.id);
      setConfirmDeleteRoom(null);

      // If this was the selected room, select another.
      if (selectedRoomId === room.id) {
        const remaining = visibleRooms.filter((r) => r.id !== room.id);
        if (remaining.length > 0) onSelectRoom(remaining[0]);
      }
    } finally {
      setDeleteSubmitting(false);
    }
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const visibleRooms = rooms.filter((r) => !deletedRoomIds.has(r.id));

  const totalPartitions = visibleRooms.reduce(
    (sum, r) => sum + r.sides.filter((s) => s.kind === "PARTITION").length,
    0,
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Bug 3: "Add Room" zone moved ABOVE the "Rooms" section label — the
          user's explicit request (bugs-3.md Bug 3). The h2 label previously
          lived in design-workspace.tsx above <RoomList>; it now lives here
          so both elements are ordered correctly within the same component. */}

      {/* S21-A4: Add-room zone — above the Rooms section label */}
      {addingRoom ? (
        <NewRoomForm
          orgSlug={orgSlug}
          isSubdomain={isSubdomain}
          floorId={floorId}
          onCancel={() => setAddingRoom(false)}
          onCreated={(room) => {
            setAddingRoom(false);
            setExpandedRoomIds((prev) => new Set(prev).add(room.id));
            onRoomCreated(room);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAddingRoom(true)}
          className="mb-3 flex w-full shrink-0 items-center justify-center gap-1.5 rounded-sm border border-dashed border-primary-soft px-3 py-2 text-center text-[12px] font-bold text-primary-dark hover:bg-primary-softer"
        >
          {t("newRoom")}
        </button>
      )}

      {/* "Rooms" section label — below Add Room zone, above count + list */}
      <h2 className="mb-1 shrink-0 text-xs font-bold text-text-heading">
        {t("wallsTitle")}
      </h2>

      {/* Rooms-count summary (mockup: #roomsCount) */}
      <p className="mb-3 shrink-0 text-[11.5px] text-text-muted">
        {t("roomsSummary", { rooms: visibleRooms.length, partitions: totalPartitions })}
      </p>

      {/* Room list with vertical scroll */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {visibleRooms.length === 0 ? (
          <p className="text-[11.5px] text-text-muted">{t("noRoomsYet")}</p>
        ) : (
          <ul className="flex flex-col">
            {visibleRooms.map((room) => {
              const expanded = expandedRoomIds.has(room.id);
              const isActiveRoom = selectedRoomId === room.id;
              const partitionCount = room.sides.filter((s) => s.kind === "PARTITION").length;
              const totalSides = room.sides.length;

              return (
                <li
                  key={room.id}
                  className="border-t border-border first:border-t-0"
                >
                  {/* Room group header row — S21-A2 */}
                  <div
                    className={[
                      "flex items-center gap-0.5 rounded-sm",
                      isActiveRoom ? "bg-primary-softer" : "hover:bg-bg-hover",
                    ].join(" ")}
                  >
                    {/* Chevron + name + count — clicking selects room + toggles expand */}
                    <button
                      type="button"
                      onClick={() => toggleRoom(room)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 py-1.5 text-left font-inherit"
                    >
                      <span
                        className={[
                          "inline-block shrink-0 text-[11px] text-text-muted transition-transform",
                          expanded ? "rotate-90" : "",
                        ].join(" ")}
                        aria-hidden="true"
                      >
                        ›
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-text-heading">
                        {/* R-8c: show pending rename if present, else saved label */}
                        {draftState.pendingRoomNameEdits[room.id] ?? room.label}
                      </span>
                      <span className="shrink-0 text-[11px] text-text-muted">
                        {t("convertedWalls", { converted: partitionCount, total: totalSides })}
                      </span>
                    </button>

                    {/* Delete room button */}
                    <button
                      type="button"
                      title={t("deleteRoom")}
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteRoom(room); }}
                      className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[13px] text-text-muted hover:bg-[var(--color-danger-bg)] hover:text-[var(--color-status-failed-text)]"
                    >
                      🗑
                    </button>
                  </div>

                  {/* Expanded body: partition rows */}
                  {expanded && (
                    <div className="ml-3 border-l border-border py-1 pl-3">
                      {room.sides.filter((s) => s.kind === "PARTITION").length === 0 ? (
                        <p className="px-1 py-1 text-[11px] text-text-muted">
                          {t("noPartitionsYet")}
                        </p>
                      ) : (
                        room.sides.map((side, sideIndex) => {
                          if (side.kind === "PLAIN") return null;
                          const partition = partitionsByRoom[room.id]?.find(
                            (p) => p.id === side.partitionId,
                          );
                          if (!partition) {
                            return (
                              <div key={sideIndex} className="py-1 text-[11px] text-text-muted">
                                {t("loadingPartitions")}
                              </div>
                            );
                          }
                          return (
                            /* S21-A3: Clickable partition row with to-scale preview */
                            <div
                              key={sideIndex}
                              role="button"
                              tabIndex={0}
                              onClick={() => onSelectPartition?.(partition.id, sideIndex)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  onSelectPartition?.(partition.id, sideIndex);
                                }
                              }}
                              className={[
                                "mb-0.5 flex cursor-pointer flex-col gap-0.5 rounded-sm border-l-2 px-2.5 py-1.5 text-xs transition-colors",
                                selectedPartitionId === partition.id
                                  ? "border-primary bg-primary-softer"
                                  : "border-transparent hover:border-primary-soft hover:bg-bg-hover",
                                !onSelectPartition && "cursor-default",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            >
                              <div className="flex items-baseline justify-between gap-1.5">
                                <span className="min-w-0 truncate text-[12px] font-bold text-text-heading">
                                  {partition.label}
                                </span>
                                <span className="shrink-0 text-[10.5px] text-text-muted">
                                  {(partition.design?.panels?.length ?? 0)}{" "}
                                  {(partition.design?.panels?.length ?? 0) === 1 ? "panel" : "panels"}
                                </span>
                              </div>
                              <PartitionPreview partition={partition} />
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Delete-room confirm dialog */}
      {confirmDeleteRoom && (
        <>
          {deleteError && (
            <p className="mt-1 text-[11px] text-red-700">{deleteError}</p>
          )}
          <ConfirmDialog
            isOpen={true}
            title={t("deleteRoomConfirmTitle")}
            message={t("deleteRoomConfirmMsg", { name: confirmDeleteRoom.label })}
            confirmLabel={t("confirmDelete")}
            confirmVariant="danger"
            cancelLabel={t("cancel")}
            onConfirm={() => void handleDeleteRoom(confirmDeleteRoom)}
            onCancel={() => {
              if (!deleteSubmitting) {
                setConfirmDeleteRoom(null);
                setDeleteError(null);
              }
            }}
          />
        </>
      )}
    </div>
  );
}
