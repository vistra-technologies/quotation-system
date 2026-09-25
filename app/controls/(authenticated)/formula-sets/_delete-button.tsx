"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface DeleteFormulaSetButtonProps {
  setId: string;
  name: string;
  version: number;
  /** "link" = compact text action for list rows; "button" = outlined button for the detail header. */
  variant: "link" | "button";
  /** Where to go after a successful delete. Omit to just refresh the current page (list). */
  redirectTo?: string;
}

/**
 * Hard-delete button for an unused FormulaSet (hotfix 2026-09-25, H-1).
 *
 * Callers render it only for unlocked sets. The API re-checks in-use inside
 * its transaction; a 409 (the set became in use after the page loaded) is
 * shown inline in the dialog and disables the confirm button.
 *
 * /controls has no i18n provider — plain English strings, no shared LoadingOverlay.
 *
 * Mirrors: app/controls/(authenticated)/component-types/_delete-button.tsx.
 */
export function DeleteFormulaSetButton({
  setId,
  name,
  version,
  variant,
  redirectTo,
}: DeleteFormulaSetButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function close() {
    setIsConfirmOpen(false);
    setErrorMessage(null);
  }

  async function handleConfirm() {
    if (loading) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/v1/superadmin/formula-sets/${encodeURIComponent(setId)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (res.status === 401) {
        router.push("/controls/login");
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(
          res.status === 409
            ? "This set is now in use and can't be deleted."
            : `Delete failed: ${data.error ?? `HTTP ${res.status}`}`,
        );
        return;
      }
      setIsConfirmOpen(false);
      if (redirectTo) {
        router.push(redirectTo);
      }
      router.refresh();
    } catch {
      setErrorMessage("Delete failed: network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <ConfirmDialog
        isOpen={isConfirmOpen}
        title="Delete formula set?"
        message={`${name} v${version} is not used by any organisation, project or calculation. It will be permanently deleted.`}
        errorMessage={errorMessage}
        confirmLabel={loading ? "Deleting…" : "Delete"}
        onConfirm={handleConfirm}
        onCancel={close}
      />
      <button
        type="button"
        disabled={loading}
        onClick={() => setIsConfirmOpen(true)}
        aria-label={`Delete ${name} v${version}`}
        className={
          variant === "link"
            ? "text-sm font-bold text-status-failed-text hover:underline disabled:opacity-50"
            : "inline-flex items-center rounded-sm border border-[var(--color-danger-border)] bg-bg-white px-4 py-2.5 text-sm font-bold text-status-failed-text hover:bg-[var(--color-danger-bg)] disabled:opacity-50"
        }
      >
        Delete
      </button>
    </>
  );
}
