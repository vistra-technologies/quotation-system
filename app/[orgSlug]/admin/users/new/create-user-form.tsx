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
 */
export function CreateUserForm({ orgSlug, roles, externalCompanies }: CreateUserFormProps) {
  const t = useTranslations("users");
  const [state, formAction, isPending] = useActionState(createUser, initialState);

  return (
    <>
      <LoadingOverlay visible={isPending} />

      {state.error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 dark:border-red-700 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">{state.error}</p>
        </div>
      )}

      <form action={formAction} className="mt-6 flex flex-col gap-5">
        <input type="hidden" name="orgSlug" value={orgSlug} />

        {/* Username */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="username"
            className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
          >
            {t("fieldUsername")}
          </label>
          <input
            id="username"
            name="username"
            type="text"
            required
            autoComplete="off"
            className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-50"
          />
        </div>

        {/* Role */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="roleId"
            className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
          >
            {t("fieldRole")}
          </label>
          <select
            id="roleId"
            name="roleId"
            required
            className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:focus:ring-zinc-50"
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
            className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
          >
            {t("fieldExternalCompany")}
          </label>
          <select
            id="externalCompanyId"
            name="externalCompanyId"
            className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:focus:ring-zinc-50"
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
            className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
          >
            {t("fieldPassword")}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-50"
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {t("submitCreate")}
        </button>
      </form>
    </>
  );
}
