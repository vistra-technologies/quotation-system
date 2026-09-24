"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface NewVersionButtonProps {
  setId: string;
  currentVersion: number;
}

/**
 * "Create new version" button for a locked FormulaSet (Client Component).
 *
 * Calls POST /api/v1/superadmin/formula-sets/[setId]/version, then redirects
 * to the newly created set's detail page. Shown on locked sets only —
 * unlocked sets use the edit form instead.
 *
 * Stage 25 Batch 4 — Formula Sets SuperAdmin screens.
 */
export function NewVersionButton({ setId, currentVersion }: NewVersionButtonProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setIsPending(true);
    setError(null);

    try {
      const res = await fetch(`/api/v1/superadmin/formula-sets/${encodeURIComponent(setId)}/version`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (res.status === 401) {
        router.push("/controls/login");
        return;
      }

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? "Failed to create new version");
        return;
      }

      const { formulaSet } = (await res.json()) as { formulaSet: { id: string; version: number } };
      // Navigate to the new version's detail page.
      router.push(`/controls/formula-sets/${encodeURIComponent(formulaSet.id)}`);
    } catch {
      setError("Network error — please try again");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={`Create new version (v${currentVersion + 1})`}
      >
        {isPending ? "Creating…" : `+ Create new version (v${currentVersion + 1})`}
      </button>
      {error && (
        <p className="text-xs font-semibold text-status-failed-text">{error}</p>
      )}
    </div>
  );
}
