"use client";

import { useState, useTransition } from "react";
import { LoadingOverlay } from "@/components/loading-overlay";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SelectField } from "@/components/select-field";
import { deleteUser } from "./actions";

interface DeleteUserButtonProps {
  orgSlug: string;
  userId: string;
  username: string;
  /** Confirm message resolved by the parent server component. */
  confirmMessage: string;
  /**
   * Stage 31 S31-4: what happens to the user's records ("Owns 2 projects and 1 inquiry. They stay,
   * and will show as created by X (removed)."). Null when the user created nothing.
   */
  recordsMessage: string | null;
  /** Other active users the work can be reassigned to (S31-4a). Empty hides the picker. */
  reassignCandidates: { id: string; label: string }[];
  /** "Reassign their work to" label and the keep-as-is option text, resolved by the parent. */
  reassignLabel: string;
  reassignNoneLabel: string;
}

/**
 * Delete row action for the users list.
 *
 * Renders an icon-only trash button. On click, opens a themed ConfirmDialog
 * (no window.confirm). On confirmation, calls the deleteUser server action
 * which DELETEs via the API route and revalidates the users list.
 *
 * Stage 31: deleting is never blocked by the user's records. The dialog says what happens to them
 * and offers an optional "Reassign their work to..." picker (the work moves first, then the user is
 * deleted). The action returns state, so a refusal (self-delete, a target that cannot access the
 * records) shows inside the dialog; picking another option clears it.
 *
 * All text is passed as props from the parent server component so this component has no i18n
 * dependency (avoids clientMessages coupling).
 *
 * Consistent with the useTransition + server action pattern used in
 * user-detail-forms.tsx for activate/deactivate/role/password actions.
 */
export function DeleteUserButton({
  orgSlug,
  userId,
  username,
  confirmMessage,
  recordsMessage,
  reassignCandidates,
  reassignLabel,
  reassignNoneLabel,
}: DeleteUserButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toUserId, setToUserId] = useState("");

  function openDialog() {
    setErrorMessage(null);
    setToUserId("");
    setIsConfirmOpen(true);
  }

  function closeDialog() {
    setIsConfirmOpen(false);
    setErrorMessage(null);
  }

  function handleDeleteConfirm() {
    setErrorMessage(null);
    const formData = new FormData();
    formData.set("orgSlug", orgSlug);
    formData.set("userId", userId);
    if (toUserId) formData.set("toUserId", toUserId);
    startTransition(async () => {
      try {
        const result = await deleteUser({ error: null, success: false }, formData);
        if (result.error) {
          setErrorMessage(result.error); // stay open and show why
        } else {
          setIsConfirmOpen(false);
        }
      } catch {
        setErrorMessage("Delete failed — please try again.");
      }
    });
  }

  const dialogMessage = (
    <>
      <p>{confirmMessage}</p>
      {recordsMessage && <p className="mt-2">{recordsMessage}</p>}
      {recordsMessage && reassignCandidates.length > 0 && (
        <div className="mt-3 block text-xs font-bold uppercase tracking-wide text-text-muted">
          {reassignLabel}
          <div className="mt-1 font-normal normal-case tracking-normal">
            <SelectField
              value={toUserId}
              onChange={(e) => {
                setToUserId(e.target.value);
                setErrorMessage(null);
              }}
            >
              <option value="">{reassignNoneLabel}</option>
              {reassignCandidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </SelectField>
          </div>
        </div>
      )}
    </>
  );

  return (
    <>
      <LoadingOverlay visible={isPending} />
      <ConfirmDialog
        isOpen={isConfirmOpen}
        title={`Delete ${username}`}
        message={dialogMessage}
        errorMessage={errorMessage}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
        onCancel={closeDialog}
      />
      <button
        type="button"
        onClick={openDialog}
        disabled={isPending}
        aria-label={`Delete user ${username}`}
        title={`Delete user ${username}`}
        className="flex h-7 w-7 items-center justify-center rounded-sm border border-border text-red-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
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
