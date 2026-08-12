"use client";

import { useState, useTransition } from "react";
import { LoadingOverlay } from "@/components/loading-overlay";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { deleteExternalCompany } from "./actions";

interface DeleteCompanyButtonProps {
  orgSlug: string;
  companyId: string;
  companyName: string;
  /** Confirm message resolved by the parent server component. */
  confirmMessage: string;
}

/**
 * Delete row action for the external companies list.
 *
 * Renders an icon-only trash button. On click, opens a themed ConfirmDialog
 * (no window.confirm). On confirmation, calls the deleteExternalCompany server
 * action which DELETEs via the API route and revalidates the companies list.
 *
 * The confirm message is passed as a prop from the parent server component so
 * this component has no i18n dependency (avoids clientMessages coupling).
 *
 * FK behavior (verified Stage 13 Batch 2): User/Project/Inquiry.externalCompanyId
 * all use ON DELETE SET NULL — clean cascade, no blocker.
 *
 * Mirrors the DeleteUserButton pattern (Stage 12 Batch 7g, updated Stage 14 Batch D).
 */
export function DeleteCompanyButton({
  orgSlug,
  companyId,
  companyName,
  confirmMessage,
}: DeleteCompanyButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleDeleteConfirm() {
    setIsConfirmOpen(false);
    setErrorMessage(null);
    const formData = new FormData();
    formData.set("orgSlug", orgSlug);
    formData.set("companyId", companyId);
    startTransition(async () => {
      try {
        await deleteExternalCompany(formData);
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : "Delete failed — please try again.",
        );
      }
    });
  }

  return (
    <>
      <LoadingOverlay visible={isPending} />
      <ConfirmDialog
        isOpen={isConfirmOpen}
        title={`Delete ${companyName}`}
        message={confirmMessage}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setIsConfirmOpen(false)}
      />
      {errorMessage && (
        <span className="text-xs text-red-600">{errorMessage}</span>
      )}
      <button
        type="button"
        onClick={() => setIsConfirmOpen(true)}
        disabled={isPending}
        aria-label={`Delete company ${companyName}`}
        title={`Delete company ${companyName}`}
        className="flex items-center justify-center text-red-600 hover:text-red-700 disabled:opacity-50"
      >
        {/* Trash icon 16×16 */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M6 2h4a1 1 0 0 1 1 1H5a1 1 0 0 1 1-1Z"
            fill="currentColor"
          />
          <path
            d="M2 4.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1H13l-.8 7.2A1.5 1.5 0 0 1 10.71 13H5.29A1.5 1.5 0 0 1 3.8 12.2L3 5H2.5a.5.5 0 0 1-.5-.5ZM4.02 5l.76 6.83a.5.5 0 0 0 .5.17h5.44a.5.5 0 0 0 .5-.17L11.98 5H4.02Z"
            fill="currentColor"
          />
        </svg>
      </button>
    </>
  );
}
