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
  const [error, setError] = useState<string | null>(null);
  // Reset the local draft whenever a *different* room is selected (not on
  // every parent re-render, which would clobber an in-progress edit) —
  // done during render (React's "adjusting state when a prop changes"
  // pattern) rather than a useEffect, to avoid an extra render pass.
  const [prevRoomId, setPrevRoomId] = useState(room.id);
  if (prevRoomId !== room.id) {
    setPrevRoomId(room.id);
    setValue(room.label);
    setError(null);
  }

  async function commit() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === room.label) {
      // Nothing to save — snap back to the server's label (covers an
      // emptied-out input).
      setValue(room.label);
      return;
    }
    setError(null);
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
        // review-item7-piece1-round2.md MINOR 1: this used to snap back
        // silently (e.g. on a duplicate-label 400) with no indication the
        // edit was lost. Surface the server's message, same as
        // new-room-form.tsx/convert-side-form.tsx.
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Failed to rename room — please try again.");
        setValue(room.label);
        return;
      }
      const { room: updatedRoom } = (await res.json()) as { room: RoomRow };
      // Reflect the server's (trimmed) label immediately rather than
      // waiting for the next blur to self-heal (review-item7-piece1-
      // round2.md MINOR 3).
      setValue(updatedRoom.label);
      onRenamed(updatedRoom);
    } catch {
      setError("Network error — please try again.");
      setValue(room.label);
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            setValue(room.label);
            setError(null);
          }
        }}
        title={value}
        className="max-w-[220px] truncate rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-base font-extrabold text-text-heading hover:border-border focus:border-primary focus:bg-bg-white focus:outline-none"
      />
      {error && <p className="px-1 text-[10.5px] text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}
