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
 *
 * Stage 11 Batch 8: restyled to Sage Ease tokens. No logic changes.
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
      <section className="rounded-md border border-border bg-bg-card p-5 shadow-card">
        <form onSubmit={handleToggle}>
          <input type="hidden" name="orgSlug" value={orgSlug} />
          <input type="hidden" name="userId" value={userId} />
          <button
            type="submit"
            disabled={anyPending || isSelf}
            title={isSelf ? t("cannotDeactivateSelfTooltip") : undefined}
            className={
              isActive
                ? "rounded-sm bg-status-failed-text px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
                : "rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
            }
          >
            {isActive ? t("deactivateAction") : t("activateAction")}
          </button>
          {isSelf && (
            <p className="mt-2 text-xs text-text-placeholder">
              {t("cannotDeactivateSelf")}
            </p>
          )}
        </form>
      </section>

      {/* Change Role */}
      <section className="rounded-md border border-border bg-bg-card p-5 shadow-card">
        <h2 className="mb-3 text-sm font-bold text-text-body">
          {t("changeRoleLabel")}
        </h2>
        <form onSubmit={handleRole} className="flex flex-col gap-3">
          <input type="hidden" name="orgSlug" value={orgSlug} />
          <input type="hidden" name="userId" value={userId} />
          <select
            name="roleId"
            defaultValue={currentRoleId}
            className="rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
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

      {/* Set Password */}
      <section className="rounded-md border border-border bg-bg-card p-5 shadow-card">
        <h2 className="mb-3 text-sm font-bold text-text-body">
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
            className="rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body placeholder:text-text-placeholder focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
          />
          <button
            type="submit"
            disabled={anyPending}
            className="self-start rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
          >
            {t("setPasswordSubmit")}
          </button>
        </form>
      </section>
    </>
  );
}
