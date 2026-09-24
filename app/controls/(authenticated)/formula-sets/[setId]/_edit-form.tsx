"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { updateSuperAdminFormulaSet, type FormulaSetFormState } from "../actions";

interface EditFormulaSetFormProps {
  setId: string;
  initialName: string;
  version: number;
  initialBodyJson: string;
}

/**
 * Editable form for an unlocked FormulaSet (Client Component).
 *
 * Renders name input, read-only version display, and a JSON body textarea.
 * On validation errors from the API, shows an inline error panel below the
 * textarea and disables Save. When the user edits the textarea, local errors
 * clear so they can resubmit.
 *
 * Deliberately does NOT use the shared @/components/loading-overlay — that
 * component calls next-intl's useTranslations() and requires a provider that
 * /controls does not have (same reason as edit-component-form.tsx).
 *
 * Stage 25 Batch 4 — Formula Sets SuperAdmin screens.
 */
export function EditFormulaSetForm({
  setId,
  initialName,
  version,
  initialBodyJson,
}: EditFormulaSetFormProps) {
  const [state, formAction, isPending] = useActionState<FormulaSetFormState, FormData>(
    updateSuperAdminFormulaSet,
    { error: null },
  );

  // Controlled field state — React 19 resets uncontrolled inputs after any
  // <form action> finishes (success or error); without this the textarea is
  // wiped on a failed submit (see profile.md "Recurring gotcha").
  const [name, setName] = useState(initialName);
  const [body, setBody] = useState(initialBodyJson);

  // Dismiss errors by identity: once the user edits after a failed submit the
  // current `state` object is "dismissed", so currentErrors becomes [].  A new
  // submit produces a fresh state reference, so fresh errors re-appear.
  const [dismissed, setDismissed] = useState<FormulaSetFormState | null>(null);
  const currentErrors = dismissed === state ? [] : (state.validationErrors ?? []);
  const hasErrors = currentErrors.length > 0;

  return (
    <div className="rounded-md border border-border bg-bg-card px-5 py-5 shadow-card">
      {isPending && (
        <div
          role="status"
          aria-label="Saving changes"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/50"
        >
          <div
            aria-hidden="true"
            className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white"
          />
          <p className="mt-3 text-sm font-medium text-white">Saving…</p>
        </div>
      )}

      {/* Top-level error (non-validation) */}
      {state.error && !state.validationErrors?.length && (
        <div className="mb-4 rounded-sm border border-status-failed-border bg-status-failed-bg px-4 py-3 text-sm font-semibold text-status-failed-text">
          {state.error}
        </div>
      )}

      <form action={formAction}>
        <input type="hidden" name="setId" value={setId} />

        {/* Name + Version row */}
        <div className="mb-4 grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="edit-name"
              className="mb-1.5 block text-xs font-extrabold uppercase tracking-wider text-text-muted"
            >
              Name
            </label>
            <input
              id="edit-name"
              name="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-heading outline-none focus:border-primary"
            />
          </div>
          <div>
            <label
              className="mb-1.5 block text-xs font-extrabold uppercase tracking-wider text-text-muted"
            >
              Version
            </label>
            {/* Version is identity — read-only in the UI. PATCH still accepts it
                programmatically, but the UI does not expose editing it. */}
            <input
              type="text"
              value={`v${version}`}
              disabled
              aria-label={`Version ${version}`}
              className="w-full max-w-[120px] rounded-sm border border-border bg-bg-subtle px-3 py-2 text-sm text-text-muted"
            />
          </div>
        </div>

        {/* Body JSON */}
        <div className="mb-4">
          <label
            htmlFor="edit-body"
            className="mb-1.5 block text-xs font-extrabold uppercase tracking-wider text-text-muted"
          >
            Formula Set Body (JSON)
          </label>
          <textarea
            id="edit-body"
            name="bodyJson"
            rows={14}
            value={body}
            className={`w-full resize-y rounded-sm border px-3 py-2 font-mono text-xs text-text-heading outline-none focus:border-primary ${
              hasErrors ? "border-status-failed-text" : "border-border"
            } bg-bg-white`}
            onChange={(e) => {
              setBody(e.target.value);
              // Dismiss the current error set so Save re-enables while the
              // user is editing; fresh errors will appear on the next submit.
              setDismissed(state);
            }}
          />

          {/* Inline validation errors — directly below textarea */}
          {hasErrors && (
            <div className="mt-2 rounded-sm border border-status-failed-border bg-status-failed-bg px-3 py-2.5">
              <p className="mb-1.5 text-xs font-extrabold text-status-failed-text">
                Validation failed — {currentErrors.length} error
                {currentErrors.length !== 1 ? "s" : ""}
              </p>
              <ul className="flex flex-col gap-1">
                {currentErrors.map((e, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1.5 text-xs font-semibold text-status-failed-text"
                  >
                    <span aria-hidden="true" className="mt-0.5 shrink-0 text-[10px]">
                      ✕
                    </span>
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-border pt-5">
          <button
            type="submit"
            disabled={isPending || hasErrors}
            className="inline-flex items-center rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save Changes
          </button>
          <Link
            href="/controls/formula-sets"
            className="rounded-sm border border-border bg-bg-white px-4 py-2.5 text-sm font-bold text-text-body hover:bg-primary-softer"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
