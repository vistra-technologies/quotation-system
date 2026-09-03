"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface DeleteOrgButtonProps {
  orgId: string;
  orgName: string;
  orgSlug: string;
}

/**
 * Hard-delete button for a suspended org row on the /controls/orgs page.
 *
 * Only rendered for suspended orgs (caller guards with isSuspended check).
 * Shows a themed ConfirmDialog naming the org before executing, so a misclick
 * cannot wipe the wrong tenant.
 *
 * DELETEs /api/v1/superadmin/orgs/[orgId] and calls router.refresh() on
 * success so the Server Component re-fetches the updated list.
 *
 * NOTE: Does NOT use @/components/loading-overlay — that component calls
 * useTranslations() and requires a NextIntlClientProvider ancestor. The
 * /controls console has no such provider (see AGENTS.md). A local loading
 * state (button disabled + "..." label) is used instead.
 *
 * Stage 17 item 6a.
 */
export function DeleteOrgButton({ orgId, orgName, orgSlug }: DeleteOrgButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleConfirm() {
    setIsConfirmOpen(false);
    setErrorMessage(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/superadmin/orgs/${orgId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(
          `Delete failed: ${data.error ?? `HTTP ${res.status}`}`,
        );
        return;
      }

      // Refresh Server Component data to reflect the deleted org.
      router.refresh();
    } catch {
      setErrorMessage("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <ConfirmDialog
        isOpen={isConfirmOpen}
        title="Delete organization"
        message={`Permanently delete "${orgName}" (${orgSlug})? This will remove all users, projects, inquiries, catalog items, and every other record belonging to this org. This cannot be undone.`}
        confirmLabel="Delete permanently"
        cancelLabel="Cancel"
        onConfirm={handleConfirm}
        onCancel={() => setIsConfirmOpen(false)}
      />
      {errorMessage && (
        <span className="block text-xs text-red-600">{errorMessage}</span>
      )}
      <button
        type="button"
        onClick={() => setIsConfirmOpen(true)}
        disabled={loading}
        className="rounded-sm bg-red-100 px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-200 disabled:opacity-50"
      >
        {loading ? "..." : "Delete"}
      </button>
    </>
  );
}
