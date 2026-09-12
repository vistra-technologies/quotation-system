"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface DeleteComponentTypeButtonProps {
  orgId: string;
  typeId: string;
  typeCode: string;
  typeName: string;
}

/**
 * Hard-delete button for a component type row on the /controls/component-types page.
 *
 * Shows a themed ConfirmDialog naming the type before executing, so a misclick
 * cannot delete the wrong type. On success, calls router.refresh() so the
 * Server Component re-fetches the updated list.
 *
 * Calls DELETE /api/v1/superadmin/component-types/[typeId]?orgId=xxx.
 * Returns a user-visible error message on 409 (type is in use by existing Selections).
 *
 * /controls is translation-free (English only, SuperAdmin-only console).
 *
 * Stage 19 bugs-3 M1 — delete affordance for SuperAdmin Component Types.
 * Mirrors: app/controls/(authenticated)/orgs/_delete-button.tsx (Stage 17 item 6a).
 */
export function DeleteComponentTypeButton({
  orgId,
  typeId,
  typeCode,
  typeName,
}: DeleteComponentTypeButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleConfirm() {
    setIsConfirmOpen(false);
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/v1/superadmin/component-types/${encodeURIComponent(typeId)}?orgId=${encodeURIComponent(orgId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(
          `Delete failed: ${data.error ?? `HTTP ${res.status}`}`,
        );
        return;
      }
      // Refresh Server Component data to reflect the deleted type.
      router.refresh();
    } catch {
      setErrorMessage("Delete failed: network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {errorMessage && (
        <p className="mt-1 text-xs text-red-600">{errorMessage}</p>
      )}
      <ConfirmDialog
        isOpen={isConfirmOpen}
        title="Delete component type"
        message={`Permanently delete "${typeName}" (${typeCode})? Any configurations using this type in projects will lose their component-type reference. This cannot be undone.`}
        confirmLabel="Delete permanently"
        cancelLabel="Cancel"
        onConfirm={handleConfirm}
        onCancel={() => setIsConfirmOpen(false)}
      />
      <button
        type="button"
        disabled={loading}
        onClick={() => setIsConfirmOpen(true)}
        className="text-sm font-semibold text-red-600 hover:text-red-800 disabled:opacity-50"
      >
        {loading ? "..." : "Delete"}
      </button>
    </>
  );
}
