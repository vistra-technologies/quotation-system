"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { LoadingOverlay } from "@/components/loading-overlay";
import {
  activateUser,
  deactivateUser,
  setUserPassword,
} from "../actions";

interface UserDangerZoneProps {
  orgSlug: string;
  userId: string;
  isActive: boolean;
  isSelf: boolean;
}

/**
 * Client Component — the Danger Zone section on the User Detail page.
 *
 * Contains only the destructive / sensitive actions: Activate / Deactivate
 * and Set Password. Role change and profile editing have moved to UserEditForm.
 *
 * Stage 15 Batch G (U5): split from the original UserDetailForms as part of the
 * page redesign. Each action uses its own useTransition so only the active
 * form shows the overlay; the other remains interactive.
 *
 * next-intl: useTranslations("users") — namespace forwarded by admin/layout.tsx clientMessages.
 */
export function UserDetailForms({
  orgSlug,
  userId,
  isActive,
  isSelf,
}: UserDangerZoneProps) {
  const t = useTranslations("users");

  const [togglePending, startToggle] = useTransition();
  const [pwPending, startPw] = useTransition();

  const anyPending = togglePending || pwPending;

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

  function handlePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startPw(async () => {
      await setUserPassword(formData);
    });
  }

  const inputCls =
    "rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body placeholder:text-text-placeholder focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]";
  const labelCls = "text-xs font-bold uppercase tracking-wide text-text-muted";

  return (
    <section
      aria-label={t("dangerZoneLabel")}
      className="rounded-md border border-status-failed-bg bg-bg-card p-5 shadow-card"
    >
      <LoadingOverlay visible={anyPending} />

      <h2 className="mb-4 text-sm font-bold text-status-failed-text">
        {t("dangerZoneLabel")}
      </h2>

      {/* Activate / Deactivate */}
      <form onSubmit={handleToggle} className="mb-5">
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

      {/* Set Password */}
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-text-muted">
        {t("setPasswordLabel")}
      </h3>
      <form onSubmit={handlePassword} className="flex flex-col gap-3">
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="userId" value={userId} />
        <label htmlFor="danger-password" className={labelCls}>
          {t("setPasswordLabel")}
        </label>
        <input
          id="danger-password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          className={inputCls}
        />
        <button
          type="submit"
          disabled={anyPending}
          className="self-start rounded-sm bg-status-failed-text px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          {t("setPasswordSubmit")}
        </button>
      </form>
    </section>
  );
}
