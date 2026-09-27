"use client";

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import { SelectField } from "@/components/select-field";
import { Modal } from "./_modal";
import { CreateUserForm } from "./new/create-user-form";
import {
  updateUserProfile,
  changeUserRole,
  setUserPasswordModal,
  type UpdateUserProfileState,
  type SetPasswordModalState,
} from "./actions";

// ─── Shared types ─────────────────────────────────────────────────────────────

interface RoleOption {
  id: string;
  name: string;
  isInternalRole: boolean;
}

export interface EditableUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  mobile: string | null;
  profileEmail: string | null;
  roleId: string;
  role: { id: string; name: string };
  externalCompanyId: string | null;
}

// ─── Add user ────────────────────────────────────────────────────────────────

/**
 * "Add user" button that opens the existing CreateUserForm in a popup modal.
 *
 * The CreateUserForm's server action (`createUser`) redirects to /admin/users
 * on success — this naturally closes the modal via full-page navigation, which
 * also re-fetches the updated user list.
 *
 * Hotfix 2026-09-27 H-8.
 */
export function AddUserButton({
  orgSlug,
  roles,
  externalCompanies,
}: {
  orgSlug: string;
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
        className="rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark"
      >
        Add user
      </button>
      <Modal isOpen={open} title="Add user" onClose={close}>
        <CreateUserForm
          orgSlug={orgSlug}
          roles={roles}
          externalCompanies={externalCompanies}
        />
      </Modal>
    </>
  );
}

// ─── Edit user ───────────────────────────────────────────────────────────────

/**
 * Per-row "Edit" action that opens an edit popup modal.
 *
 * Editable: firstName, lastName, mobile, profileEmail, externalCompanyId
 * (via updateUserProfile) + role (via changeUserRole, separate form).
 * Username is shown but not editable. Closes the modal after a successful
 * profile save.
 *
 * Hotfix 2026-09-27 H-8.
 */
export function EditUserButton({
  orgSlug,
  user,
  roles,
  externalCompanies,
}: {
  orgSlug: string;
  user: EditableUser;
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
        aria-label={`Edit ${user.username}`}
        title={`Edit ${user.username}`}
        className="flex h-7 w-7 items-center justify-center rounded-sm border border-border text-primary-dark hover:bg-primary-softer hover:text-primary"
      >
        {/* Pencil icon 16×16 */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm1.414 1.06a.25.25 0 0 0-.354 0L2.543 12.023l-.625 2.185 2.185-.625L13.64 4.047a.25.25 0 0 0 0-.354l-1.213-1.206Z"
            fill="currentColor"
          />
        </svg>
      </button>
      <Modal isOpen={open} title="Update User" onClose={close}>
        <OrgEditUserForm
          orgSlug={orgSlug}
          user={user}
          roles={roles}
          externalCompanies={externalCompanies}
          onClose={close}
        />
      </Modal>
    </>
  );
}

// ─── Inline edit form ─────────────────────────────────────────────────────────

const initialProfileState: UpdateUserProfileState = { error: null, success: false };
const initialPasswordState: SetPasswordModalState = { error: null, success: false };

/**
 * Edit form used inside the EditUserButton modal.
 *
 * Profile section (firstName, lastName, mobile, email, externalCompanyId) uses
 * updateUserProfile via useActionState — closes the modal on success.
 * Role section uses changeUserRole via useTransition — also closes on completion.
 *
 * next-intl: uses "users" namespace forwarded by admin/layout.tsx clientMessages.
 */
function OrgEditUserForm({
  orgSlug,
  user,
  roles,
  externalCompanies,
  onClose,
}: {
  orgSlug: string;
  user: EditableUser;
  roles: RoleOption[];
  externalCompanies: { id: string; name: string }[];
  onClose: () => void;
}) {
  const t = useTranslations("users");
  const router = useRouter();
  const [profileState, profileAction, profilePending] = useActionState(
    updateUserProfile,
    initialProfileState,
  );
  const [passwordState, passwordAction, passwordPending] = useActionState(
    setUserPasswordModal,
    initialPasswordState,
  );
  const [rolePending, startRole] = useTransition();
  const [selectedRoleId, setSelectedRoleId] = useState(
    user.roleId ?? user.role.id,
  );
  const selectedRole = roles.find((r) => r.id === selectedRoleId);
  const companyRequired = selectedRole ? !selectedRole.isInternalRole : false;
  // Ref to clear the password input after a successful password save.
  const passwordInputRef = useRef<HTMLInputElement>(null);

  // Close modal after a successful profile save.
  useEffect(() => {
    if (profileState.success) onClose();
  }, [profileState.success, onClose]);

  // Clear the password input after a successful password save (don't close — the
  // user may still want to save profile fields).
  useEffect(() => {
    if (passwordState.success && passwordInputRef.current) {
      passwordInputRef.current.value = "";
    }
  }, [passwordState.success]);

  function handleRoleChange(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startRole(async () => {
      await changeUserRole(formData);
      onClose();
      // Ensure the users list picks up the server's revalidatePath for this
      // imperative (non-<form action>) call — router.refresh() forces RSC re-fetch.
      router.refresh();
    });
  }

  const anyPending = profilePending || rolePending || passwordPending;

  const inputCls =
    "w-full rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body placeholder:text-text-placeholder focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]";
  const labelCls = "text-xs font-bold uppercase tracking-wide text-text-muted";

  return (
    <>
      <LoadingOverlay visible={anyPending} />

      {/* Username (read-only) */}
      <p className="mb-4 text-sm text-text-muted">
        Username:{" "}
        <span className="font-bold text-text-heading">@{user.username}</span>
      </p>

      {profileState.error && (
        <div className="mb-4 rounded-sm border border-status-failed-bg bg-status-failed-bg px-4 py-3">
          <p className="text-sm text-status-failed-text">{profileState.error}</p>
        </div>
      )}

      {/* Profile edit form */}
      <form action={profileAction} className="flex flex-col gap-4">
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="userId" value={user.id} />

        <div className="flex gap-4">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="edit-firstName" className={labelCls}>
              {t("fieldFirstName")}
            </label>
            <input
              id="edit-firstName"
              name="firstName"
              type="text"
              required
              defaultValue={user.firstName}
              autoComplete="given-name"
              className={inputCls}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="edit-lastName" className={labelCls}>
              {t("fieldLastName")}
            </label>
            <input
              id="edit-lastName"
              name="lastName"
              type="text"
              required
              defaultValue={user.lastName}
              autoComplete="family-name"
              className={inputCls}
            />
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="edit-mobile" className={labelCls}>
              {t("fieldMobile")}
            </label>
            <input
              id="edit-mobile"
              name="mobile"
              type="tel"
              defaultValue={user.mobile ?? ""}
              autoComplete="tel"
              className={inputCls}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="edit-profileEmail" className={labelCls}>
              {t("fieldEmail")}
            </label>
            <input
              id="edit-profileEmail"
              name="profileEmail"
              type="email"
              defaultValue={user.profileEmail ?? ""}
              autoComplete="email"
              className={inputCls}
            />
          </div>
        </div>

        {/* External Company — required for external roles (U3) */}
        <div className="flex flex-col gap-1">
          <label htmlFor="edit-externalCompanyId" className={labelCls}>
            {companyRequired
              ? t("fieldExternalCompanyRequired")
              : t("fieldExternalCompany")}
          </label>
          <SelectField
            id="edit-externalCompanyId"
            name="externalCompanyId"
            required={companyRequired}
            defaultValue={user.externalCompanyId ?? ""}
            className={inputCls}
          >
            <option value="">{t("fieldExternalCompanyNone")}</option>
            {externalCompanies.map((ec) => (
              <option key={ec.id} value={ec.id}>
                {ec.name}
              </option>
            ))}
          </SelectField>
        </div>

        <button
          type="submit"
          disabled={anyPending}
          className="self-start rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
        >
          {t("editProfileSubmit")}
        </button>
      </form>

      {/* Divider */}
      <hr className="my-5 border-border" />

      {/* Role change — separate form */}
      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-text-muted">
        {t("changeRoleLabel")}
      </p>
      <form onSubmit={handleRoleChange} className="flex flex-col gap-3">
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="userId" value={user.id} />
        <SelectField
          name="roleId"
          value={selectedRoleId}
          onChange={(e) => setSelectedRoleId(e.target.value)}
          className={inputCls}
        >
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </SelectField>
        <button
          type="submit"
          disabled={anyPending}
          className="self-start rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
        >
          {t("changeRoleSubmit")}
        </button>
      </form>

      {/* Divider */}
      <hr className="my-5 border-border" />

      {/* Password — separate form; blank = keep current (H-18). */}
      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-text-muted">
        Password
      </p>
      {passwordState.error && (
        <div className="mb-3 rounded-sm border border-status-failed-bg bg-status-failed-bg px-4 py-3">
          <p className="text-sm text-status-failed-text">{passwordState.error}</p>
        </div>
      )}
      {passwordState.success && (
        <div className="mb-3 rounded-sm border border-status-ok-bg bg-status-ok-bg px-4 py-3">
          <p className="text-sm text-status-ok-text">Password updated.</p>
        </div>
      )}
      <form action={passwordAction} className="flex flex-col gap-3">
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="userId" value={user.id} />
        <div className="flex flex-col gap-1">
          <label htmlFor="edit-newPassword" className={labelCls}>
            New password
          </label>
          <input
            ref={passwordInputRef}
            id="edit-newPassword"
            name="password"
            type="password"
            minLength={8}
            autoComplete="new-password"
            className={inputCls}
          />
          <p className="text-xs text-text-muted">
            Leave blank to keep the current password. Setting one signs this user out everywhere.
          </p>
        </div>
        <button
          type="submit"
          disabled={anyPending}
          className="self-start rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
        >
          Set password
        </button>
      </form>
    </>
  );
}
