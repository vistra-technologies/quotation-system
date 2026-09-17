"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { redirectToLogin } from "./login-redirect";
import type { RoomRow } from "./types";

interface NewRoomFormProps {
  orgSlug: string;
  isSubdomain: boolean;
  floorId: string;
  onCancel: () => void;
  /** Called with the created room (default 4-side PLAIN rectangle) on success. */
  onCreated: (room: RoomRow) => void;
}

/**
 * S21-A4: Inline "+ Add Room" form.
 *
 * Matches design-step-poc.html's renderAddRoomZone inline-add-form pattern:
 * one flex row — input + Add button + ✕ cancel button. Enter submits,
 * Escape cancels. An empty name is rejected inline (no submit).
 *
 * Used in two places:
 *   1. Left-rail add-room zone (room-list.tsx) — shown in place of the
 *      "+ Add Room" button when the user clicks it.
 *   2. Center-panel empty state (design-workspace.tsx) — same component,
 *      same props, same behaviour.
 *
 * Track B / A4↔B1 wiring note: the prop name used by callers that want to
 * programmatically open the left-rail form is `onOpenAddRoom: () => void` on
 * RoomList (see room-list.tsx). Track B's B1 CTA should call that prop.
 * The design-workspace.tsx empty state already manages its own `addingRoomForEmptyState`
 * state independently (frozen workspace — not changed here).
 */
export function NewRoomForm({
  orgSlug,
  isSubdomain,
  floorId,
  onCancel,
  onCreated,
}: NewRoomFormProps) {
  const t = useTranslations("design");
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Room name cannot be empty.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/orgs/${orgSlug}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ floorId, label: trimmed }),
      });
      if (res.status === 401 || res.status === 403) {
        redirectToLogin(orgSlug, isSubdomain);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Failed to create room — please try again.");
        return;
      }
      const { room } = (await res.json()) as { room: RoomRow };
      onCreated(room);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mb-3">
      {error && <p className="mb-1 text-[11px] text-red-700">{error}</p>}
      {/* inline-add-form: one row — input + Add + cancel (mirrors mockup) */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            else if (e.key === "Escape") onCancel();
          }}
          placeholder={t("fieldRoomPlaceholder")}
          className="min-w-0 flex-1 rounded-sm border border-primary-soft bg-bg-white px-2.5 py-1.5 text-[12.5px] text-text-heading placeholder:text-text-placeholder focus:border-primary focus:outline-none"
        />
        {/* Bug 4: submit button is icon-only (same width as the × cancel button)
            so the text input gets maximum available width. */}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting}
          title={t("createRoom")}
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-sm bg-primary text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
        >
          ✓
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-sm border border-border bg-bg-white text-[11.5px] text-text-body hover:border-[#b9c2ae]"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
