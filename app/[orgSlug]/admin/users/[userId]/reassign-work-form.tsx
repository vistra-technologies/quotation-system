"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { SelectField } from "@/components/select-field";
import { LoadingOverlay } from "@/components/loading-overlay";
import { reassignWork, type ReassignWorkState } from "../actions";

interface ReassignWorkFormProps {
  orgSlug: string;
  userId: string;
  /** Other active users of the org the work can move to. */
  candidates: { id: string; label: string }[];
}

const initialState: ReassignWorkState = { error: null, moved: null };

/**
 * Client Component: "Reassign work" card on the User Detail page (Stage 31 S31-4a).
 *
 * Moves every project and inquiry this user created to another active colleague. The server
 * (POST .../users/[userId]/reassign-work) enforces the rules (target active, same org, an external
 * target must be able to access the records) and its message is shown inline.
 *
 * next-intl: useTranslations("users") — namespace forwarded by admin/layout.tsx clientMessages.
 */
export function ReassignWorkForm({ orgSlug, userId, candidates }: ReassignWorkFormProps) {
  const t = useTranslations("users");
  const [state, formAction, pending] = useActionState(reassignWork, initialState);

  return (
    <section
      aria-label={t("reassignWorkLabel")}
      className="rounded-md border border-border bg-bg-card p-5 shadow-card"
    >
      <LoadingOverlay visible={pending} />
      <h2 className="mb-4 text-sm font-bold text-text-heading">{t("reassignWorkLabel")}</h2>

      {candidates.length === 0 ? (
        <p className="text-sm text-text-muted">{t("reassignWorkNone")}</p>
      ) : (
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="orgSlug" value={orgSlug} />
          <input type="hidden" name="userId" value={userId} />
          <span className="text-xs font-bold uppercase tracking-wide text-text-muted">
            {t("reassignWorkTo")}
          </span>
          <SelectField name="toUserId" placeholder={t("reassignWorkChoose")} defaultValue="" required>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </SelectField>
          <button
            type="submit"
            disabled={pending}
            className="self-start rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
          >
            {t("reassignWorkSubmit")}
          </button>
        </form>
      )}

      {state.error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-status-failed-text">
          {state.error}
        </p>
      )}
      {state.moved && (
        <p role="status" className="mt-3 text-sm font-semibold text-status-paid-text">
          {t("reassignWorkDone", state.moved)}
        </p>
      )}
    </section>
  );
}
