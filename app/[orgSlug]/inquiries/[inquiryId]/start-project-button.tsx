"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import { convertInquiryToProject, type ConvertInquiryState } from "../actions";

interface StartProjectButtonProps {
  orgSlug: string;
  inquiryId: string;
  disabled?: boolean;
}

const initialState: ConvertInquiryState = { error: null };

/**
 * Client Component for the "Start Project" conversion action.
 *
 * Uses useActionState so that a SEQUENCE_CONFLICT (concurrent projectNumber race)
 * is surfaced inline as a user-readable error rather than crashing to an error
 * boundary.
 *
 * The `inquiries` namespace must be forwarded in the ancestor layout's
 * clientMessages — verified in app/[orgSlug]/inquiries/layout.tsx.
 */
export function StartProjectButton({ orgSlug, inquiryId, disabled }: StartProjectButtonProps) {
  const t = useTranslations("inquiries");
  const [state, formAction, isPending] = useActionState(convertInquiryToProject, initialState);

  return (
    <div className="flex flex-col gap-2">
      <LoadingOverlay visible={isPending} />

      {state.error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 dark:border-red-700 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">{state.error}</p>
        </div>
      )}

      <form action={formAction}>
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="inquiryId" value={inquiryId} />
        <button
          type="submit"
          disabled={disabled || isPending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {t("startProject")}
        </button>
      </form>
    </div>
  );
}
