"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
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
 * Inline "New Room" form — mirrors design-step-poc.html's inline
 * add-room form (no `window.prompt()`). Client `fetch()` instead of
 * `useActionState` + `redirect()` (plan-item7.md flag 6 / architect
 * conditional approval): view/selection state stays purely client-side, no
 * page nav, so the newly created room appears instantly.
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
    if (!trimmed) return;
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
    <div className="relative mt-1 rounded-sm border border-dashed border-border bg-bg-white p-3">
      <LoadingOverlay visible={submitting} />
      {error && <p className="mb-2 text-xs text-red-700 dark:text-red-400">{error}</p>}
      <div className="flex flex-col gap-2">
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
          className="rounded-sm border border-border bg-bg-white px-2.5 py-1.5 text-xs text-text-body placeholder:text-text-placeholder focus:border-primary focus:outline-none"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
            className="flex-1 rounded-sm bg-primary px-2.5 py-1.5 text-xs font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
          >
            {t("createRoom")}
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
