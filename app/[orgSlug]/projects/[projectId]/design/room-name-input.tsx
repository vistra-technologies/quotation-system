"use client";

import { useState } from "react";
import { useDraftContext } from "./design-draft-context";
import type { RoomRow } from "./types";

interface RoomNameInputProps {
  // orgSlug / isSubdomain / onRenamed are kept for signature compatibility
  // with the frozen design-workspace.tsx. In the draft model the rename is
  // deferred: dispatch(SET_ROOM_NAME) marks the draft dirty; the actual PATCH
  // is issued by the workspace's save() on the Save button, which then calls
  // onRenamed() with the server-updated room via result.updatedRooms. These
  // three props are intentionally unused here.
  orgSlug: string;
  isSubdomain: boolean;
  room: RoomRow;
  onRenamed: (room: RoomRow) => void;
}

/**
 * Layout-mode's editable room-name input — deferred rename via the draft
 * context (SET_ROOM_NAME). Committing on blur/Enter marks the draft dirty but
 * does NOT PATCH the server; the actual write happens when the user clicks
 * Save (workspace's save() flushes pendingRoomNameEdits in parallel with the
 * partition PATCH and then calls onRenamed() for each updated room).
 *
 * Mirrors design-step-poc.html's wall-name-input (lines 1193-1198 of
 * design-page.html — change listener updates room.name and calls renderAll()).
 *
 * S21-B2: replaces the previous immediate-write pattern (PATCH on blur) to
 * satisfy "editing the room name marks the draft dirty and only persists on
 * Save" (track-b-layout-mode.md acceptance criteria).
 */
export function RoomNameInput({
  room,
  // orgSlug, isSubdomain, onRenamed intentionally unused here — see above
}: RoomNameInputProps) {
  const { state, dispatch } = useDraftContext();

  // Initialise from any pending edit already in the draft (e.g. the user
  // typed a name, blurred, switched away, then came back to the same room).
  const [value, setValue] = useState(
    state.pendingRoomNameEdits[room.id] ?? room.label,
  );

  // Reset local draft when a *different* room is selected — React's
  // "adjusting state when a prop changes" pattern (avoids an extra render
  // pass). Same technique as the previous implementation.
  const [prevRoomId, setPrevRoomId] = useState(room.id);
  if (prevRoomId !== room.id) {
    setPrevRoomId(room.id);
    setValue(state.pendingRoomNameEdits[room.id] ?? room.label);
  }

  function commit() {
    const trimmed = value.trim();
    const baseline = state.pendingRoomNameEdits[room.id] ?? room.label;
    if (!trimmed) {
      // Empty input: snap back to last committed name.
      setValue(baseline);
      return;
    }
    if (trimmed === baseline) return; // no-op
    dispatch({ type: "SET_ROOM_NAME", roomId: room.id, name: trimmed });
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          setValue(state.pendingRoomNameEdits[room.id] ?? room.label);
        }
      }}
      title={value}
      className="truncate rounded-[6px] border border-transparent bg-transparent px-[5px] py-[3px] text-base font-extrabold text-text-heading hover:border-border hover:bg-[#fafaf6] focus:border-border focus:bg-[#fafaf6] focus:outline-none"
    />
  );
}
