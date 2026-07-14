"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import { createPermission, type CreatePermissionState } from "../../actions";

const initialState: CreatePermissionState = { error: null };

interface CreatePermissionFormProps {
  orgSlug: string;
}

/**
 * Client Component: create-permission form.
 *
 * Uses useActionState (React 19) so the server action can return a user-readable
 * error on P2002 duplicate code, rather than crashing the page.
 *
 * LoadingOverlay is driven by isPending from useActionState — visible while the
 * server action is in flight and dismissed the moment it settles.
 *
 * Requires NextIntlClientProvider in scope (provided by the admin layout).
 */
export function CreatePermissionForm({ orgSlug }: CreatePermissionFormProps) {
  const t = useTranslations("permissions");
  const [state, formAction, isPending] = useActionState(createPermission, initialState);

  return (
    <>
      <LoadingOverlay visible={isPending} />

      {state.error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 dark:border-red-700 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">{state.error}</p>
        </div>
      )}

      <form action={formAction} className="mt-4 space-y-5">
        {/* Carry orgSlug so the action can redirect and revalidate correctly */}
        <input type="hidden" name="orgSlug" value={orgSlug} />

        <div>
          <label
            htmlFor="code"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            {t("fieldCode")}
          </label>
          <input
            id="code"
            name="code"
            type="text"
            required
            autoComplete="off"
            placeholder="e.g. MANAGE_REPORTS"
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder-zinc-500"
          />
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Conventionally uppercase with underscores, e.g. MANAGE_REPORTS
          </p>
        </div>

        <div>
          <label
            htmlFor="description"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            {t("fieldDescription")}
          </label>
          <input
            id="description"
            name="description"
            type="text"
            required
            autoComplete="off"
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder-zinc-500"
          />
        </div>

        <div>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 shadow-sm hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {t("submitCreate")}
          </button>
        </div>
      </form>
    </>
  );
}
