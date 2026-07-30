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
 * Stage 11 Batch 8: restyled to Sage Ease tokens. No logic changes.
 */
export function CreateUserForm({ orgSlug, roles, externalCompanies }: CreateUserFormProps) {
  const t = useTranslations("users");
  const [state, formAction, isPending] = useActionState(createUser, initialState);

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

        {/* Username */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="username"
            className="text-xs font-bold uppercase tracking-wide text-text-muted"
          >
            {t("fieldUsername")}
          </label>
          <input
            id="username"
            name="username"
            type="text"
            required
            autoComplete="off"
            className="rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body placeholder:text-text-placeholder focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
          />
        </div>

        {/* Role */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="roleId"
            className="text-xs font-bold uppercase tracking-wide text-text-muted"
          >
            {t("fieldRole")}
          </label>
          <select
            id="roleId"
            name="roleId"
            required
            className="rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        {/* External Company (optional) */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="externalCompanyId"
            className="text-xs font-bold uppercase tracking-wide text-text-muted"
          >
            {t("fieldExternalCompany")}
          </label>
          <select
            id="externalCompanyId"
            name="externalCompanyId"
            className="rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
          >
            <option value="">{t("fieldExternalCompanyNone")}</option>
            {externalCompanies.map((ec) => (
              <option key={ec.id} value={ec.id}>
                {ec.name}
              </option>
            ))}
          </select>
        </div>

        {/* Initial password */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="password"
            className="text-xs font-bold uppercase tracking-wide text-text-muted"
          >
            {t("fieldPassword")}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            className="rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body placeholder:text-text-placeholder focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
          />
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
