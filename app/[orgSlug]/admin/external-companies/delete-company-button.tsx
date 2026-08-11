"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import { deleteExternalCompany } from "./actions";

interface DeleteCompanyButtonProps {
  orgSlug: string;
  companyId: string;
  companyName: string;
}

/**
 * Delete row action for the external companies list.
 *
 * Shows a window.confirm() dialog before proceeding.  On confirmation,
 * calls the deleteExternalCompany server action which DELETEs via the API route
 * and revalidates the companies list — the deleted row disappears on next render.
 *
 * FK behavior (verified Stage 13 Batch 2): User/Project/Inquiry.externalCompanyId
 * all use ON DELETE SET NULL — clean cascade, no blocker.
 *
 * Mirrors the DeleteUserButton pattern (Stage 12 Batch 7g).
 *
 * Stage 13 Batch 2.
 */
export function DeleteCompanyButton({
  orgSlug,
  companyId,
  companyName,
}: DeleteCompanyButtonProps) {
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("externalCompanies");

  function handleClick() {
    const message = t("deleteConfirm", { name: companyName });
    if (!window.confirm(message)) {
      return;
    }
    const formData = new FormData();
    formData.set("orgSlug", orgSlug);
    formData.set("companyId", companyId);
    startTransition(async () => {
      try {
        await deleteExternalCompany(formData);
      } catch (err) {
        window.alert(
          err instanceof Error
            ? err.message
            : "Delete failed — please try again.",
        );
      }
    });
  }

  return (
    <>
      <LoadingOverlay visible={isPending} />
      <button
        onClick={handleClick}
        disabled={isPending}
        className="text-sm font-medium text-red-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-red-400"
      >
        Delete
      </button>
    </>
  );
}
