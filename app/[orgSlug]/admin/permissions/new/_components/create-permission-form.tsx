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
 * The "permissions" namespace is forwarded in admin layout's clientMessages.
 *
 * Stage 11 (Batch 9): restyled to Sage Ease tokens.
 */
export function CreatePermissionForm({ orgSlug }: CreatePermissionFormProps) {
  const t = useTranslations("permissions");
  const [state, formAction, isPending] = useActionState(createPermission, initialState);

  return (
    <>
      <LoadingOverlay visible={isPending} />

      {state.error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">{state.error}</p>
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-4">
        {/* Carry orgSlug so the action can redirect and revalidate correctly */}
        <input type="hidden" name="orgSlug" value={orgSlug} />

        <div className="flex flex-col gap-1">
          <label
            htmlFor="code"
            className="text-xs font-bold uppercase tracking-wide text-text-muted"
          >
            {t("fieldCode")}
          </label>
          <input
            id="code"
            name="code"
            type="text"
            required
            autoComplete="off"
            placeholder={t("fieldCodePlaceholder")}
            className="rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-heading placeholder:text-text-placeholder focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <p className="text-xs text-text-muted">
            {t("fieldCodeHint")}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="description"
            className="text-xs font-bold uppercase tracking-wide text-text-muted"
          >
            {t("fieldDescription")}
          </label>
          <input
            id="description"
            name="description"
            type="text"
            required
            autoComplete="off"
            className="rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-heading placeholder:text-text-placeholder focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
          >
            {t("submitCreate")}
          </button>
        </div>
      </form>
    </>
  );
}
