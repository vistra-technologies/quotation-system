"use client";

import { useActionState, useState } from "react";
import { LoadingOverlay } from "@/components/loading-overlay";
import { addUser, type AddUserState } from "./actions";

interface RoleOption {
  id: string;
  name: string;
  isInternalRole: boolean;
}

interface CreateUserFormProps {
  orgId: string;
  roles: RoleOption[];
  externalCompanies: { id: string; name: string }[];
}

const initialState: AddUserState = { error: null };

/**
 * SuperAdmin add-user form (Client Component).
 *
 * Mirrors app/[orgSlug]/admin/users/new/create-user-form.tsx field-for-field:
 * firstName, lastName, username, roleId (scoped to the selected org), password ≥8,
 * mobile, profileEmail, externalCompanyId (required when role.isInternalRole = false).
 *
 * Takes an explicit orgId prop (no org slug/session — this is cross-org SuperAdmin).
 * On success, the server action revalidates /controls/users so the user list refreshes.
 *
 * Stage 17 Item 4b.
 */
export function CreateUserForm({ orgId, roles, externalCompanies }: CreateUserFormProps) {
  const [state, formAction, isPending] = useActionState(addUser, initialState);

  // Track the selected role to drive the External Company requirement (U3 parity).
  const [selectedRoleId, setSelectedRoleId] = useState(roles[0]?.id ?? "");
  const selectedRole = roles.find((r) => r.id === selectedRoleId);
  const companyRequired = selectedRole ? !selectedRole.isInternalRole : false;

  const inputCls =
    "rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body placeholder:text-text-placeholder focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]";
  const labelCls = "text-xs font-bold uppercase tracking-wide text-text-muted";

  return (
    <>
      <LoadingOverlay visible={isPending} />

      {state.error && (
        <div className="mb-4 rounded-sm border border-status-failed-bg bg-status-failed-bg px-4 py-3">
          <p className="text-sm text-status-failed-text">{state.error}</p>
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-5">
        {/* Hidden fields */}
        <input type="hidden" name="orgId" value={orgId} />

        {/* First Name + Last Name — side by side */}
        <div className="flex gap-4">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="sa-firstName" className={labelCls}>
              First Name
            </label>
            <input
              id="sa-firstName"
              name="firstName"
              type="text"
              required
              autoComplete="given-name"
              className={inputCls}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="sa-lastName" className={labelCls}>
              Last Name
            </label>
            <input
              id="sa-lastName"
              name="lastName"
              type="text"
              required
              autoComplete="family-name"
              className={inputCls}
            />
          </div>
        </div>

        {/* Username */}
        <div className="flex flex-col gap-1">
          <label htmlFor="sa-username" className={labelCls}>
            Username
          </label>
          <input
            id="sa-username"
            name="username"
            type="text"
            required
            autoComplete="off"
            className={inputCls}
          />
        </div>

        {/* Role — changing this drives the External Company requirement */}
        <div className="flex flex-col gap-1">
          <label htmlFor="sa-roleId" className={labelCls}>
            Role
          </label>
          <select
            id="sa-roleId"
            name="roleId"
            required
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
        </div>

        {/* Password */}
        <div className="flex flex-col gap-1">
          <label htmlFor="sa-password" className={labelCls}>
            Password
          </label>
          <input
            id="sa-password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={inputCls}
          />
          <p className="text-xs text-text-muted">At least 8 characters.</p>
        </div>

        {/* Mobile (optional) */}
        <div className="flex flex-col gap-1">
          <label htmlFor="sa-mobile" className={labelCls}>
            Mobile <span className="font-normal normal-case">(optional)</span>
          </label>
          <input
            id="sa-mobile"
            name="mobile"
            type="tel"
            autoComplete="tel"
            className={inputCls}
          />
        </div>

        {/* Profile Email (optional) */}
        <div className="flex flex-col gap-1">
          <label htmlFor="sa-profileEmail" className={labelCls}>
            Email <span className="font-normal normal-case">(optional)</span>
          </label>
          <input
            id="sa-profileEmail"
            name="profileEmail"
            type="email"
            autoComplete="email"
            className={inputCls}
          />
        </div>

        {/* External Company — required for external roles (U3 parity) */}
        <div className="flex flex-col gap-1">
          <label htmlFor="sa-externalCompanyId" className={labelCls}>
            {companyRequired
              ? "External Company (required for this role)"
              : "External Company"}
          </label>
          <select
            id="sa-externalCompanyId"
            name="externalCompanyId"
            required={companyRequired}
            className={inputCls}
          >
            <option value="">— None —</option>
            {externalCompanies.map((ec) => (
              <option key={ec.id} value={ec.id}>
                {ec.name}
              </option>
            ))}
          </select>
          {companyRequired && (
            <p className="text-xs text-status-failed-text">
              This role requires an external company.
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
        >
          Add User
        </button>
      </form>
    </>
  );
}
