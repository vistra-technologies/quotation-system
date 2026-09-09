"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { redirectToLogin } from "./login-redirect";
import type { FloorRow } from "./types";

interface FloorBarProps {
  orgSlug: string;
  projectId: string;
  isSubdomain: boolean;
  floors: FloorRow[];
  selectedFloorId: string | null;
  onSelectFloor: (floorId: string) => void;
  onFloorCreated: (floor: FloorRow) => void;
}

/**
 * Floor `<select>` + inline "+ Floor" add form — mirrors
 * design-step-poc.html's `renderFloorBar`. No `window.prompt()` (the mockup
 * itself avoids it — inline input instead).
 */
export function FloorBar({
  orgSlug,
  projectId,
  isSubdomain,
  floors,
  selectedFloorId,
  onSelectFloor,
  onFloorCreated,
}: FloorBarProps) {
  const t = useTranslations("design");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const label = name.trim();
    if (!label) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/orgs/${orgSlug}/floors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, label }),
      });
      if (res.status === 401 || res.status === 403) {
        redirectToLogin(orgSlug, isSubdomain);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Failed to add floor — please try again.");
        return;
      }
      const { floor } = (await res.json()) as { floor: FloorRow };
      onFloorCreated(floor);
      setAdding(false);
      setName("");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (adding) {
    return (
      <div className="mb-4 flex flex-1 items-center gap-1.5">
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("fieldFloorPlaceholder")}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            else if (e.key === "Escape") {
              setAdding(false);
              setName("");
            }
          }}
          className="min-w-0 flex-1 rounded-sm border border-primary-soft bg-bg-white px-2.5 py-1.5 text-xs text-text-heading focus:border-primary focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting}
          className="shrink-0 rounded-sm bg-primary px-2.5 py-1.5 text-xs font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
        >
          {t("addFloorSubmit")}
        </button>
        <button
          type="button"
          onClick={() => {
            setAdding(false);
            setName("");
          }}
          className="shrink-0 rounded-sm border border-border bg-bg-white px-2.5 py-1.5 text-xs text-text-body hover:border-[#b9c2ae]"
        >
          ✕
        </button>
        {error && <p className="w-full text-[11px] text-red-700 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mb-4 flex items-center gap-2">
      <select
        value={selectedFloorId ?? ""}
        onChange={(e) => onSelectFloor(e.target.value)}
        className="min-w-0 flex-1 rounded-sm border border-border bg-bg-white px-2 py-1.5 text-xs font-bold text-text-heading focus:border-primary focus:outline-none"
      >
        {floors.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          setAdding(true);
          setName(`Floor ${floors.length + 1}`);
        }}
        className="shrink-0 rounded-sm border border-primary-soft bg-primary-softer px-2.5 py-1.5 text-[11.5px] font-bold text-primary-dark hover:border-primary"
      >
        {t("addFloor")}
      </button>
    </div>
  );
}
