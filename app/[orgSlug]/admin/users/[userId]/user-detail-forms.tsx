"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { LoadingOverlay } from "@/components/loading-overlay";
import {
  activateUser,
  deactivateUser,
  changeUserRole,
  setUserPassword,
} from "../actions";

interface UserDetailFormsProps {
  orgSlug: string;
  userId: string;
  isActive: boolean;
  currentRoleId: string;
  roles: { id: string; name: string }[];
  isSelf: boolean;
}

/**
 * Client Component that renders the three action forms on the user detail page.
 *
 * Each form uses its own useTransition so only the form being submitted shows
 * the overlay; the others remain interactive.
 */
export function UserDetailForms({
  orgSlug,
  userId,
  isActive,
  currentRoleId,
  roles,
  isSelf,
}: UserDetailFormsProps) {
  const t = useTranslations("users");

  // Separate pending flags so overlays are scoped to each action.
  const [togglePending, startToggle] = useTransition();
  const [rolePending, startRole] = useTransition();
  const [pwPending, startPw] = useTransition();

  const anyPending = togglePending || rolePending || pwPending;

  function handleToggle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startToggle(async () => {
      if (isActive) {
        await deactivateUser(formData);
      } else {
        await activateUser(formData);
      }
    });
  }

  function handleRole(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startRole(async () => {
      await changeUserRole(formData);
    });
  }

  function handlePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startPw(async () => {
      await setUserPassword(formData);
    });
  }

  return (
    <>
      <LoadingOverlay visible={anyPending} />

      {/* Activate / Deactivate */}
      <section className="rounded-lg border border-zinc-200 bg-white px-5 py-5 dark:border-zinc-800 dark:bg-zinc-900">
        <form onSubmit={handleToggle}>
          <input type="hidden" name="orgSlug" value={orgSlug} />
          <input type="hidden" name="userId" value={userId} />
          <button
            type="submit"
            disabled={anyPending || isSelf}
            title={isSelf ? "You cannot deactivate your own account" : undefined}
            className={
              isActive
                ? "rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 dark:bg-red-700 dark:hover:bg-red-600"
                : "rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50 dark:bg-green-600 dark:hover:bg-green-500"
            }
          >
            {isActive ? t("deactivateAction") : t("activateAction")}
          </button>
          {isSelf && (
            <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
              You cannot deactivate your own account.
            </p>
          )}
        </form>
      </section>

      {/* Change Role */}
      <section className="rounded-lg border border-zinc-200 bg-white px-5 py-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t("changeRoleLabel")}
        </h2>
        <form onSubmit={handleRole} className="flex flex-col gap-3">
          <input type="hidden" name="orgSlug" value={orgSlug} />
          <input type="hidden" name="userId" value={userId} />
          <select
            name="roleId"
            defaultValue={currentRoleId}
            className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:focus:ring-zinc-50"
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
            className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {t("changeRoleSubmit")}
          </button>
        </form>
      </section>

      {/* Set Password */}
      <section className="rounded-lg border border-zinc-200 bg-white px-5 py-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t("setPasswordLabel")}
        </h2>
        <form onSubmit={handlePassword} className="flex flex-col gap-3">
          <input type="hidden" name="orgSlug" value={orgSlug} />
          <input type="hidden" name="userId" value={userId} />
          <input
            name="password"
            type="password"
            required
            autoComplete="new-password"
            className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-50"
          />
          <button
            type="submit"
            disabled={anyPending}
            className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {t("setPasswordSubmit")}
          </button>
        </form>
      </section>
    </>
  );
}
