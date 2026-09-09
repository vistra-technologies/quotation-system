"use client";

import { useState } from "react";
import { redirectToLogin } from "./login-redirect";
import type { RoomRow } from "./types";

interface RoomNameInputProps {
  orgSlug: string;
  isSubdomain: boolean;
  room: RoomRow;
  /** Called with the freshly PATCHed room on success, so the parent can
   * update the room list / left-rail label without a full reload. */
  onRenamed: (room: RoomRow) => void;
}

/**
 * Layout-mode's editable room-name input — mirrors design-step-poc.html's
 * `renderLayoutMode` `nameInput` (a `wall-name-input` with a `change`
 * listener that renames the room). Client `fetch()` following
 * new-room-form.tsx's pattern; the rename PATCH route
 * (`/api/v1/orgs/[orgSlug]/rooms/[id]`) was built and reviewed under Item 2
 * but had zero callers until this piece's review fix — see
 * review-item7-piece1.md IMPORTANT 2.
 */
export function RoomNameInput({ orgSlug, isSubdomain, room, onRenamed }: RoomNameInputProps) {
  const [value, setValue] = useState(room.label);
  // Reset the local draft whenever a *different* room is selected (not on
  // every parent re-render, which would clobber an in-progress edit) —
  // done during render (React's "adjusting state when a prop changes"
  // pattern) rather than a useEffect, to avoid an extra render pass.
  const [prevRoomId, setPrevRoomId] = useState(room.id);
  if (prevRoomId !== room.id) {
    setPrevRoomId(room.id);
    setValue(room.label);
  }

  async function commit() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === room.label) {
      // Nothing to save — snap back to the server's label (covers an
      // emptied-out input).
      setValue(room.label);
      return;
    }
    try {
      const res = await fetch(`/api/v1/orgs/${orgSlug}/rooms/${room.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed }),
      });
      if (res.status === 401 || res.status === 403) {
        redirectToLogin(orgSlug, isSubdomain);
        return;
      }
      if (!res.ok) {
        setValue(room.label);
        return;
      }
      const { room: updatedRoom } = (await res.json()) as { room: RoomRow };
      onRenamed(updatedRoom);
    } catch {
      setValue(room.label);
    }
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") setValue(room.label);
      }}
      className="rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-base font-extrabold text-text-heading hover:border-border focus:border-primary focus:bg-bg-white focus:outline-none"
    />
  );
}
