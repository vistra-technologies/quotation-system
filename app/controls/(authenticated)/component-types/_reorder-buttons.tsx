"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ReorderButtonsProps {
  orgId: string;
  typeId: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

/**
 * Up/down reorder controls for a component type row on the /controls/component-types
 * list. Swaps `sortOrder` with the adjacent row via
 * POST /api/v1/superadmin/component-types/[typeId]/reorder, then refreshes the Server
 * Component so the reordered list re-renders.
 *
 * No drag-and-drop — a solo dev reordering ~3-15 rows per org doesn't need one.
 *
 * /controls is translation-free (English only, SuperAdmin-only console).
 *
 * Stage 20 Batch 7.
 */
export function ReorderButtons({
  orgId,
  typeId,
  canMoveUp,
  canMoveDown,
}: ReorderButtonsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<"up" | "down" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function move(direction: "up" | "down") {
    setLoading(direction);
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/v1/superadmin/component-types/${encodeURIComponent(typeId)}/reorder`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId, direction }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(data.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch {
      setErrorMessage("Reorder failed: network error");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => move("up")}
          disabled={!canMoveUp || loading !== null}
          aria-label="Move up"
          title="Move up"
          className="rounded-sm border border-border px-1.5 py-1 text-xs font-bold text-text-muted hover:border-primary-soft hover:text-text-heading disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => move("down")}
          disabled={!canMoveDown || loading !== null}
          aria-label="Move down"
          title="Move down"
          className="rounded-sm border border-border px-1.5 py-1 text-xs font-bold text-text-muted hover:border-primary-soft hover:text-text-heading disabled:opacity-30"
        >
          ↓
        </button>
      </div>
      {errorMessage && (
        <p className="text-xs text-red-600">{errorMessage}</p>
      )}
    </div>
  );
}
