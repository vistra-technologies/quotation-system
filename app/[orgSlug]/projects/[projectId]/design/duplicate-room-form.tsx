"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { redirectToLogin } from "./login-redirect";
import type { RoomRow } from "./types";
import { apiErrorMessage } from "@/lib/api-error-message";

interface DuplicateRoomFormProps {
  orgSlug: string;
  isSubdomain: boolean;
  /** The room being copied (its name is shown in the prefilled "<name> copy"). */
  room: RoomRow;
  /** The name the rail currently shows for the room (a pending rename wins over the saved label). */
  displayName: string;
  onCancel: () => void;
  /**
   * The workspace's unsaved-changes guard. The duplicate request runs inside it: Save saves first (so the copy
   * includes the edits), Discard drops them, Cancel runs nothing and the prompt stays as it was (D-32).
   */
  runWithUnsavedGuard: (resume: () => void) => void;
  /** Called with the created copy on success. */
  onDuplicated: (room: RoomRow) => void;
}

/**
 * Stage 34 S34-5 / D-28: the inline "Duplicate room" name prompt under the room row (mockup v7 s6a/s6b).
 * Enter submits, Escape cancels. A blank name is refused without a request; a 409 DUPLICATE_ROOM_LABEL
 * shows the name-taken error and keeps the prompt open (D-29: the server is the only name check).
 */
export function DuplicateRoomForm({
  orgSlug,
  isSubdomain,
  room,
  displayName,
  onCancel,
  runWithUnsavedGuard,
  onDuplicated,
}: DuplicateRoomFormProps) {
  const t = useTranslations("design");
  const [label, setLabel] = useState(() => t("duplicateRoomCopyName", { name: displayName }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const trimmed = label.trim();
    if (!trimmed) {
      setError(t("duplicateRoomNameRequired"));
      return;
    }
    if (submitting) return;
    runWithUnsavedGuard(() => void send(trimmed));
  }

  async function send(trimmed: string) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/orgs/${orgSlug}/rooms/${room.id}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed }),
      });
      if (res.status === 401 || res.status === 403) {
        redirectToLogin(orgSlug, isSubdomain);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        setError(
          res.status === 409 && body.code === "DUPLICATE_ROOM_LABEL"
            ? t("duplicateRoomNameTaken")
            : apiErrorMessage(body, t("duplicateRoomFailed")),
        );
        return;
      }
      const { room: copy } = (await res.json()) as { room: RoomRow };
      onDuplicated(copy);
    } catch {
      setError(t("duplicateRoomFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-1 px-1 pb-1.5 pt-1">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          value={label}
          aria-label={t("duplicateRoomNameLabel")}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            else if (e.key === "Escape") {
              e.stopPropagation();
              onCancel();
            }
          }}
          className={[
            "min-w-0 flex-1 rounded-sm border bg-bg-white px-2.5 py-1.5 text-[12.5px] text-text-heading placeholder:text-text-placeholder focus:outline-none",
            error
              ? "border-[var(--color-status-failed-text)] bg-[var(--color-danger-bg)]"
              : "border-primary-soft focus:border-primary",
          ].join(" ")}
        />
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="shrink-0 rounded-sm bg-primary px-2.5 py-1.5 text-[12px] font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
        >
          {t("duplicateRoomSubmit")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-label={t("cancel")}
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-sm border border-border bg-bg-white text-[11.5px] text-text-body hover:border-[#b9c2ae]"
        >
          ✕
        </button>
      </div>
      {error && <p className="text-[11px] text-red-700">{error}</p>}
    </div>
  );
}
