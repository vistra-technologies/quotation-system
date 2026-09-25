"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { SelectField } from "@/components/select-field";
import { Modal } from "./_modal";
import { CreateUserForm, PendingOverlay } from "./create-user-form";
import { editUser, type EditUserState } from "./actions";

interface RoleOption {
  id: string;
  name: string;
  isInternalRole: boolean;
}

// ─── Add user ────────────────────────────────────────────────────────────────

/**
 * "+ Add user" button that opens the existing add-user form in a popup
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
        + Add user
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
}: {
  orgId: string;
  user: EditableUser;
  roles: RoleOption[];
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
        <EditUserForm orgId={orgId} user={user} roles={roles} onSuccess={close} />
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
}: {
  orgId: string;
  user: EditableUser;
  roles: RoleOption[];
  onSuccess: () => void;
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
            <p className="text-xs text-text-muted">Deactivating signs the user out everywhere.</p>
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
            Setting a password signs the user out everywhere. Username can&apos;t be changed.
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
