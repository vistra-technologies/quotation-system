"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import { createUser, type CreateUserState } from "../actions";

interface CreateUserFormProps {
  orgSlug: string;
  roles: { id: string; name: string }[];
  externalCompanies: { id: string; name: string }[];
}

const initialState: CreateUserState = { error: null };

/**
 * Client Component form for creating a new user.
 *
 * Uses useActionState (React 19) so the server action can return a user-readable
 * error (e.g. duplicate username) rather than crashing to an error boundary.
 *
 * Stage 11 Batch 8: restyled to Sage Ease tokens.
 *
 * Batch 7g: added First Name, Last Name (required), Mobile, Email (optional);
 * password minLength=8 enforced client-side (HTML5) and server-side (route handler).
 */
export function CreateUserForm({ orgSlug, roles, externalCompanies }: CreateUserFormProps) {
  const t = useTranslations("users");
  const [state, formAction, isPending] = useActionState(createUser, initialState);

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
        <input type="hidden" name="orgSlug" value={orgSlug} />

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
              autoComplete="family-name"
              className={inputCls}
            />
          </div>
        </div>

        {/* Username */}
        <div className="flex flex-col gap-1">
          <label htmlFor="username" className={labelCls}>
            {t("fieldUsername")}
          </label>
          <input
            id="username"
            name="username"
            type="text"
            required
            autoComplete="off"
            className={inputCls}
          />
        </div>

        {/* Role */}
        <div className="flex flex-col gap-1">
          <label htmlFor="roleId" className={labelCls}>
            {t("fieldRole")}
          </label>
          <select
            id="roleId"
            name="roleId"
            required
            className={inputCls}
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        {/* Initial password */}
        <div className="flex flex-col gap-1">
          <label htmlFor="password" className={labelCls}>
            {t("fieldPassword")}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={inputCls}
          />
          <p className="text-xs text-text-muted">{t("fieldPasswordHint")}</p>
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
            autoComplete="email"
            className={inputCls}
          />
        </div>

        {/* External Company (optional) */}
        <div className="flex flex-col gap-1">
          <label htmlFor="externalCompanyId" className={labelCls}>
            {t("fieldExternalCompany")}
          </label>
          <select
            id="externalCompanyId"
            name="externalCompanyId"
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
          disabled={isPending}
          className="rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
        >
          {t("submitCreate")}
        </button>
      </form>
    </>
  );
}
