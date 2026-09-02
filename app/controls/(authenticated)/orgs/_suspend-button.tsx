"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SuspendOrgButtonProps {
  orgId: string;
  orgName: string;
  isSuspended: boolean;
}

/**
 * Suspend / reactivate button for a single org row on the /controls/orgs page.
 *
 * Shows a window.confirm dialog before executing (wireframe-stage confirm UX).
 * POSTs to POST /api/v1/superadmin/orgs/[orgId]/suspend with { suspend: boolean }.
 * On success, calls router.refresh() so the Server Component re-fetches the updated list.
 *
 * Stage 16 Batch E — F5.
 */
export function SuspendOrgButton({
  orgId,
  orgName,
  isSuspended,
}: SuspendOrgButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    const action = isSuspended ? "reactivate" : "suspend";
    const confirmed = window.confirm(
      isSuspended
        ? `Reactivate "${orgName}"? Users of this organization will regain access.`
        : `Suspend "${orgName}"? Users of this organization will be blocked on their next request.`,
    );
    if (!confirmed) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/v1/superadmin/orgs/${orgId}/suspend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suspend: !isSuspended }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        alert(
          `Failed to ${action} organization: ${data.error ?? `HTTP ${res.status}`}`,
        );
        return;
      }

      // Refresh Server Component data to reflect the updated status.
      router.refresh();
    } catch {
      alert(`Network error while trying to ${action} organization.`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={
        isSuspended
          ? "rounded-sm bg-status-paid-bg px-3 py-1 text-xs font-bold text-status-paid-text hover:opacity-80 disabled:opacity-50"
          : "rounded-sm bg-status-failed-bg px-3 py-1 text-xs font-bold text-status-failed-text hover:opacity-80 disabled:opacity-50"
      }
    >
      {loading ? "..." : isSuspended ? "Reactivate" : "Suspend"}
    </button>
  );
}
