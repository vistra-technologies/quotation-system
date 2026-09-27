"use client";

import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { SelectField } from "@/components/select-field";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Modal } from "./_modal";
import { CreateUserForm, PendingOverlay } from "./create-user-form";
import { editUser, deleteSAUser, type EditUserState } from "./actions";

interface RoleOption {
  id: string;
  name: string;
  isInternalRole: boolean;
}

// ─── Add user ────────────────────────────────────────────────────────────────

/**
 * "Add user" button that opens the existing add-user form in a popup
 * (hotfix 2026-09-25, H-5 — was an inline form under the table).
 */
export function AddUserButton({
  orgId,
  roles,
  externalCompanies,
}: {
  orgId: string;
  roles: RoleOption[];
  externalCompanies: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center rounded-sm bg-primary px-4 py-2.5 text-sm font-bold text-text-on-primary hover:bg-primary-dark"
      >
        Add user
      </button>
      <Modal isOpen={open} title="Add new user" onClose={close}>
        <CreateUserForm
          orgId={orgId}
          roles={roles}
          externalCompanies={externalCompanies}
          onSuccess={close}
        />
      </Modal>
    </>
  );
}

// ─── Edit user ───────────────────────────────────────────────────────────────

export interface EditableUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  mobile: string | null;
  profileEmail: string | null;
  active: boolean;
  role: { id: string; name: string };
}

/**
 * Per-row "Edit" action that opens an edit popup (hotfix 2026-09-25, H-5).
 * Editable: name, mobile, email, role, active, optional new password.
 * Username is shown but not editable.
 */
export function EditUserButton({
  orgId,
  user,
  roles,
  deactivateHint,
  passwordHint,
}: {
  orgId: string;
  user: EditableUser;
  roles: RoleOption[];
  /** Translated hint shown below the Active toggle (H-14). */
  deactivateHint: string;
  /** Translated hint shown below the new password input (H-14). */
  passwordHint: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Edit ${user.username}`}
        className="text-sm font-bold text-primary hover:text-primary-dark"
      >
        Edit
      </button>
      <Modal isOpen={open} title={`Edit user — ${user.username}`} onClose={close}>
        <EditUserForm orgId={orgId} user={user} roles={roles} onSuccess={close} deactivateHint={deactivateHint} passwordHint={passwordHint} />
      </Modal>
    </>
  );
}

const initialEditState: EditUserState = { error: null };

function EditUserForm({
  orgId,
  user,
  roles,
  onSuccess,
  deactivateHint,
  passwordHint,
}: {
  orgId: string;
  user: EditableUser;
  roles: RoleOption[];
  onSuccess: () => void;
  deactivateHint: string;
  passwordHint: string;
}) {
  const [state, formAction, isPending] = useActionState(editUser, initialEditState);

  // Controlled fields — React 19 resets uncontrolled inputs after a form action,
  // which would wipe the user's edits on a failed save.
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [mobile, setMobile] = useState(user.mobile ?? "");
  const [profileEmail, setProfileEmail] = useState(user.profileEmail ?? "");
  const [roleId, setRoleId] = useState(user.role.id);
  const [active, setActive] = useState(user.active ? "true" : "false");
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    if (state.ok) onSuccess();
  }, [state, onSuccess]);

  const inputCls =
    "rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body placeholder:text-text-placeholder focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]";
  const labelCls = "text-xs font-bold uppercase tracking-wide text-text-muted";

  return (
    <>
      <PendingOverlay visible={isPending} />

      {state.error && (
        <div className="mb-4 rounded-sm border border-status-failed-bg bg-status-failed-bg px-4 py-3">
          <p className="text-sm text-status-failed-text">{state.error}</p>
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-5">
        <input type="hidden" name="orgId" value={orgId} />
        <input type="hidden" name="userId" value={user.id} />

        <div className="flex gap-4">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="edit-firstName" className={labelCls}>First Name</label>
            <input id="edit-firstName" name="firstName" type="text" required className={inputCls}
              value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="edit-lastName" className={labelCls}>Last Name</label>
            <input id="edit-lastName" name="lastName" type="text" required className={inputCls}
              value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="edit-mobile" className={labelCls}>
              Mobile <span className="font-normal normal-case">(optional)</span>
            </label>
            <input id="edit-mobile" name="mobile" type="tel" className={inputCls}
              value={mobile} onChange={(e) => setMobile(e.target.value)} />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="edit-profileEmail" className={labelCls}>
              Email <span className="font-normal normal-case">(optional)</span>
            </label>
            <input id="edit-profileEmail" name="profileEmail" type="email" className={inputCls}
              value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} />
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="edit-roleId" className={labelCls}>Role</label>
            <SelectField id="edit-roleId" name="roleId" required className={inputCls}
              value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </SelectField>
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="edit-active" className={labelCls}>Status</label>
            <SelectField id="edit-active" name="active" className={inputCls}
              value={active} onChange={(e) => setActive(e.target.value)}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </SelectField>
            <p className="text-xs text-text-muted">{deactivateHint}</p>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="edit-newPassword" className={labelCls}>
            New Password <span className="font-normal normal-case">(optional)</span>
          </label>
          <input id="edit-newPassword" name="newPassword" type="password" minLength={8}
            autoComplete="new-password" placeholder="Leave blank to keep current password"
            className={inputCls} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <p className="text-xs text-text-muted">
            {passwordHint}
          </p>
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
        >
          Save changes
        </button>
      </form>
    </>
  );
}

// ─── Delete user ─────────────────────────────────────────────────────────────

/**
 * Per-row delete action for the SuperAdmin users console.
 *
 * Trash icon button opens a ConfirmDialog naming the user. On confirmation,
 * calls the deleteSAUser server action which DELETEs via the API route,
 * cascades Account/Session, writes an audit log entry, and revalidates the page.
 *
 * Uses PendingOverlay (NOT the shared LoadingOverlay — /controls has no i18n
 * provider; see AGENTS.md). ConfirmDialog has no i18n dependency.
 *
 * Hotfix 2026-09-27 H-9.
 */
export function DeleteSAUserButton({
  orgId,
  userId,
  username,
}: {
  orgId: string;
  userId: string;
  username: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleDeleteConfirm() {
    setIsConfirmOpen(false);
    setErrorMessage(null);
    const formData = new FormData();
    formData.set("orgId", orgId);
    formData.set("userId", userId);
    startTransition(async () => {
      try {
        await deleteSAUser(formData);
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : "Delete failed — please try again.",
        );
      }
    });
  }

  return (
    <>
      <PendingOverlay visible={isPending} />
      <ConfirmDialog
        isOpen={isConfirmOpen}
        title={`Delete ${username}`}
        message={`Delete user "${username}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setIsConfirmOpen(false)}
        errorMessage={errorMessage}
      />
      <button
        type="button"
        onClick={() => setIsConfirmOpen(true)}
        disabled={isPending}
        aria-label={`Delete user ${username}`}
        title={`Delete user ${username}`}
        className="flex h-7 w-7 items-center justify-center rounded-sm border border-border text-red-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
      >
        {/* Trash icon 16×16 — same as org-admin delete-user-button.tsx */}
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
