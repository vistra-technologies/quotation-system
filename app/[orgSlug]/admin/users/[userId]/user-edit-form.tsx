"use client";

import { useActionState, useTransition, useState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import {
  updateUserProfile,
  changeUserRole,
  type UpdateUserProfileState,
} from "../actions";

interface RoleOption {
  id: string;
  name: string;
  /** true for Admin and Company Member — external company is optional for them. */
  isInternalRole: boolean;
}

interface ExternalCompanyOption {
  id: string;
  name: string;
}

interface UserEditFormProps {
  orgSlug: string;
  userId: string;
  currentFirstName: string;
  currentLastName: string;
  currentMobile: string | null;
  currentProfileEmail: string | null;
  currentExternalCompanyId: string | null;
  currentRoleId: string;
  roles: RoleOption[];
  externalCompanies: ExternalCompanyOption[];
}

const initialProfileState: UpdateUserProfileState = { error: null, success: false };

/**
 * Client Component — the main editable form card on the User Detail page.
 *
 * Stage 15 Batch G (U4, U5):
 * - U4: adds editing of firstName, lastName, mobile, profileEmail, externalCompanyId
 *       (all previously read-only) via PUT /api/v1/orgs/[orgSlug]/users/[userId]/profile.
 * - U5: part of the page redesign — one unified edit card here, danger zone in
 *       UserDetailForms (sibling component).
 *
 * Uses useActionState so the profile action can return structured errors.
 * Uses useTransition for role-change to keep its own pending state separate.
 *
 * next-intl: useTranslations("users") — namespace forwarded by admin/layout.tsx clientMessages.
 */
export function UserEditForm({
  orgSlug,
  userId,
  currentFirstName,
  currentLastName,
  currentMobile,
  currentProfileEmail,
  currentExternalCompanyId,
  currentRoleId,
  roles,
  externalCompanies,
}: UserEditFormProps) {
  const t = useTranslations("users");
  const [profileState, profileAction, profilePending] = useActionState(
    updateUserProfile,
    initialProfileState,
  );
  const [rolePending, startRole] = useTransition();

  // Track selected role so we can conditionally require external company (U3).
  const [selectedRoleId, setSelectedRoleId] = useState(currentRoleId);
  const selectedRole = roles.find((r) => r.id === selectedRoleId);
  const companyRequired = selectedRole ? !selectedRole.isInternalRole : false;

  const anyPending = profilePending || rolePending;

  function handleRole(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startRole(async () => {
      await changeUserRole(formData);
    });
  }

  const inputCls =
    "rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body placeholder:text-text-placeholder focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]";
  const labelCls = "text-xs font-bold uppercase tracking-wide text-text-muted";

  return (
    <section className="rounded-md border border-border bg-bg-card p-5 shadow-card">
      <LoadingOverlay visible={anyPending} />

      <h2 className="mb-4 text-sm font-bold text-text-body">{t("editProfileLabel")}</h2>

      {/* Profile edit form */}
      {profileState.error && (
        <div className="mb-4 rounded-sm border border-status-failed-bg bg-status-failed-bg px-4 py-3">
          <p className="text-sm text-status-failed-text">{profileState.error}</p>
        </div>
      )}
      {profileState.success && (
        <div className="mb-4 rounded-sm border border-status-paid-bg bg-status-paid-bg px-4 py-3">
          <p className="text-sm text-status-paid-text">{t("editProfileSuccess")}</p>
        </div>
      )}

      <form action={profileAction} className="flex flex-col gap-4">
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="userId" value={userId} />

        {/* First Name + Last Name — side by side */}
        <div className="flex gap-4">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="firstName" className={labelCls}>
              {t("fieldFirstName")}
            </label>
            <input
              id="firstName"
              name="firstName"
              type="text"
              required
              defaultValue={currentFirstName}
              autoComplete="given-name"
              className={inputCls}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="lastName" className={labelCls}>
              {t("fieldLastName")}
            </label>
            <input
              id="lastName"
              name="lastName"
              type="text"
              required
              defaultValue={currentLastName}
              autoComplete="family-name"
              className={inputCls}
            />
          </div>
        </div>

        {/* Mobile (optional) */}
        <div className="flex flex-col gap-1">
          <label htmlFor="mobile" className={labelCls}>
            {t("fieldMobile")}
          </label>
          <input
            id="mobile"
            name="mobile"
            type="tel"
            defaultValue={currentMobile ?? ""}
            autoComplete="tel"
            className={inputCls}
          />
        </div>

        {/* Email (optional) */}
        <div className="flex flex-col gap-1">
          <label htmlFor="profileEmail" className={labelCls}>
            {t("fieldEmail")}
          </label>
          <input
            id="profileEmail"
            name="profileEmail"
            type="email"
            defaultValue={currentProfileEmail ?? ""}
            autoComplete="email"
            className={inputCls}
          />
        </div>

        {/* External Company — required for external roles (U3) */}
        <div className="flex flex-col gap-1">
          <label htmlFor="externalCompanyId" className={labelCls}>
            {companyRequired
              ? t("fieldExternalCompanyRequired")
              : t("fieldExternalCompany")}
          </label>
          <select
            id="externalCompanyId"
            name="externalCompanyId"
            required={companyRequired}
            defaultValue={currentExternalCompanyId ?? ""}
            className={inputCls}
          >
            <option value="">{t("fieldExternalCompanyNone")}</option>
            {externalCompanies.map((ec) => (
              <option key={ec.id} value={ec.id}>
                {ec.name}
              </option>
            ))}
          </select>
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

      {/* Role change — separate form within the same card */}
      <h2 className="mb-3 text-sm font-bold text-text-body">{t("changeRoleLabel")}</h2>
      <form onSubmit={handleRole} className="flex flex-col gap-3">
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="userId" value={userId} />
        <select
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
        </select>
        <button
          type="submit"
          disabled={anyPending}
          className="self-start rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
        >
          {t("changeRoleSubmit")}
        </button>
      </form>
    </section>
  );
}
