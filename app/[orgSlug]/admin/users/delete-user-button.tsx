"use client";

import { useTransition } from "react";
import { LoadingOverlay } from "@/components/loading-overlay";
import { deleteUser } from "./actions";

interface DeleteUserButtonProps {
  orgSlug: string;
  userId: string;
  username: string;
}

/**
 * Delete row action for the users list.
 *
 * Shows a window.confirm() dialog before proceeding.  On confirmation,
 * calls the deleteUser server action which DELETEs via the API route and
 * revalidates the users list — the deleted row disappears on next render.
 *
 * Errors (self-delete guard, FK constraint) are surfaced via alert().
 * Consistent with the useTransition + server action pattern used in
 * user-detail-forms.tsx for activate/deactivate/role/password actions.
 */
export function DeleteUserButton({ orgSlug, userId, username }: DeleteUserButtonProps) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!window.confirm(`Delete user "${username}"? This cannot be undone.`)) {
      return;
    }
    const formData = new FormData();
    formData.set("orgSlug", orgSlug);
    formData.set("userId", userId);
    startTransition(async () => {
      try {
        await deleteUser(formData);
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
