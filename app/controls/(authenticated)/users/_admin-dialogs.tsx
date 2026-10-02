"use client";

import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Modal } from "./_modal";
import { PendingOverlay } from "./create-user-form";
import {
  addSuperAdmin,
  changeSuperAdminPassword,
  deleteSuperAdmin,
  type AdminFormState,
} from "./admin-actions";

// Popups for SuperAdmin account management (hotfix 2026-10-02). Uses the local PendingOverlay,
// never the shared LoadingOverlay — /controls has no i18n provider (AGENTS.md).

const inputCls =
  "rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body placeholder:text-text-placeholder focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]";
const labelCls = "text-xs font-bold uppercase tracking-wide text-text-muted";
const initialState: AdminFormState = { error: null };

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mb-4 rounded-sm border border-status-failed-bg bg-status-failed-bg px-4 py-3">
      <p className="text-sm text-status-failed-text">{message}</p>
    </div>
  );
}

// ─── Add SuperAdmin ──────────────────────────────────────────────────────────

export function AddSuperAdminButton() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center rounded-sm bg-primary px-4 py-2.5 text-sm font-bold text-text-on-primary hover:bg-primary-dark"
      >
        Add SuperAdmin
      </button>
      <Modal isOpen={open} title="Add SuperAdmin" onClose={close}>
        <AddSuperAdminForm onSuccess={close} />
      </Modal>
    </>
  );
}

function AddSuperAdminForm({ onSuccess }: { onSuccess: () => void }) {
  const [state, formAction, isPending] = useActionState(addSuperAdmin, initialState);
  // Controlled so a failed submit doesn't wipe the fields (React 19 resets uncontrolled inputs).
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (state.ok) onSuccess();
  }, [state, onSuccess]);

  return (
    <>
      <PendingOverlay visible={isPending} />
      <FormError message={state.error} />
      <form action={formAction} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <label htmlFor="sa-username" className={labelCls}>Username</label>
          <input id="sa-username" name="username" type="text" required autoComplete="off"
            className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} />
          <p className="text-xs text-text-muted">
            2–32 characters: lowercase letters, digits, &apos;.&apos;, &apos;_&apos; or &apos;-&apos;.
          </p>
        </div>
        <div className="flex gap-4">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="sa-password" className={labelCls}>Password</label>
            <input id="sa-password" name="password" type="password" required minLength={8}
              autoComplete="new-password" className={inputCls}
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="sa-confirm" className={labelCls}>Confirm password</label>
            <input id="sa-confirm" name="confirmPassword" type="password" required minLength={8}
              autoComplete="new-password" className={inputCls}
              value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </div>
        </div>
        <button type="submit" disabled={isPending}
          className="rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50">
          Create SuperAdmin
        </button>
      </form>
    </>
  );
}

// ─── Change password ─────────────────────────────────────────────────────────

export function ChangeSuperAdminPasswordButton({
  adminId,
  username,
  isSelf,
}: {
  adminId: string;
  username: string;
  isSelf: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Change password for ${username}`}
        className="text-sm font-bold text-primary hover:text-primary-dark"
      >
        Change password
      </button>
      <Modal isOpen={open} title="Change password" onClose={close}>
        <ChangePasswordForm adminId={adminId} username={username} isSelf={isSelf} onSuccess={close} />
      </Modal>
    </>
  );
}

function ChangePasswordForm({
  adminId,
  username,
  isSelf,
  onSuccess,
}: {
  adminId: string;
  username: string;
  isSelf: boolean;
  onSuccess: () => void;
}) {
  const [state, formAction, isPending] = useActionState(changeSuperAdminPassword, initialState);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (state.ok) onSuccess();
  }, [state, onSuccess]);

  return (
    <>
      <PendingOverlay visible={isPending} />
      <p className="mb-1 text-sm text-text-muted">@{username}</p>
      <p className="mb-4 text-xs text-text-muted">
        {isSelf
          ? "Your other sessions will be signed out; this one stays signed in."
          : "All of this account's active sessions will be signed out."}
      </p>
      <FormError message={state.error} />
      <form action={formAction} className="flex flex-col gap-5">
        <input type="hidden" name="adminId" value={adminId} />
        <div className="flex gap-4">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor={`pw-${adminId}`} className={labelCls}>New password</label>
            <input id={`pw-${adminId}`} name="password" type="password" required minLength={8}
              autoComplete="new-password" className={inputCls}
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor={`pwc-${adminId}`} className={labelCls}>Confirm password</label>
            <input id={`pwc-${adminId}`} name="confirmPassword" type="password" required minLength={8}
              autoComplete="new-password" className={inputCls}
              value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </div>
        </div>
        <button type="submit" disabled={isPending}
          className="rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50">
          Save password
        </button>
      </form>
    </>
  );
}

// ─── Delete ──────────────────────────────────────────────────────────────────

/**
 * Per-row delete. The server (DAL + route) is the enforcement point for the protected account,
 * self-delete and last-admin rules; the page simply doesn't render this button for `devadmin`.
 */
export function DeleteSuperAdminButton({
  adminId,
  username,
}: {
  adminId: string;
  username: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleDeleteConfirm() {
    setErrorMessage(null);
    const formData = new FormData();
    formData.set("adminId", adminId);
    startTransition(async () => {
      try {
        await deleteSuperAdmin(formData);
        setIsConfirmOpen(false);
      } catch (err) {
        // Keep the dialog open so the reason (last admin, self, …) is visible.
        setErrorMessage(err instanceof Error ? err.message : "Delete failed — please try again.");
      }
    });
  }

  return (
    <>
      <PendingOverlay visible={isPending} />
      <ConfirmDialog
        isOpen={isConfirmOpen}
        title={`Delete ${username}`}
        message={`Delete SuperAdmin "${username}"? They will be signed out and lose access to /controls. Their audit-log history is kept. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setIsConfirmOpen(false);
          setErrorMessage(null);
        }}
        errorMessage={errorMessage}
      />
      <button
        type="button"
        onClick={() => setIsConfirmOpen(true)}
        disabled={isPending}
        aria-label={`Delete SuperAdmin ${username}`}
        title={`Delete SuperAdmin ${username}`}
        className="flex h-7 w-7 items-center justify-center rounded-sm border border-border text-red-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
          <path d="M6 2h4a1 1 0 0 1 1 1H5a1 1 0 0 1 1-1Z" fill="currentColor" />
          <path
            d="M2 4.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1H13l-.8 7.2A1.5 1.5 0 0 1 10.71 13H5.29A1.5 1.5 0 0 1 3.8 12.2L3 5H2.5a.5.5 0 0 1-.5-.5ZM4.02 5l.76 6.83a.5.5 0 0 0 .5.17h5.44a.5.5 0 0 0 .5-.17L11.98 5H4.02Z"
            fill="currentColor"
          />
        </svg>
      </button>
    </>
  );
}
