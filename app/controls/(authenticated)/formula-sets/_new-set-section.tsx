"use client";

import { useActionState, useState } from "react";
import { createSuperAdminFormulaSet, type FormulaSetFormState } from "./actions";

interface NewSetSectionProps {
  /** Existing formula set names — used to populate the <datalist> autocomplete. */
  existingNames: string[];
}

/**
 * Inline "Create new formula set" section rendered below the list table.
 *
 * Shows a name input (with datalist autocomplete from existing names) and a
 * JSON body textarea. Version is auto-computed by the API. On success the
 * action redirects to the new set's detail page; on error it displays inline.
 *
 * Deliberately does NOT use the shared @/components/loading-overlay — that
 * component calls next-intl's useTranslations() and requires a provider that
 * /controls does not have (same reason as edit-component-form.tsx).
 *
 * Stage 25 Batch 4 — Formula Sets SuperAdmin screens.
 */
export function NewSetSection({ existingNames }: NewSetSectionProps) {
  const [state, formAction, isPending] = useActionState<FormulaSetFormState, FormData>(
    createSuperAdminFormulaSet,
    { error: null },
  );

  // Controlled field state — React 19 resets uncontrolled inputs after any
  // <form action> finishes (success or error); without this the textarea is
  // wiped on every failed submit (see profile.md "Recurring gotcha").
  const [name, setName] = useState("");
  const [body, setBody] = useState("");

  // Dismiss errors by identity: once the user edits after a failed submit the
  // current `state` object is "dismissed", so currentErrors becomes [].  A new
  // submit produces a fresh state reference, so fresh errors re-appear.
  const [dismissed, setDismissed] = useState<FormulaSetFormState | null>(null);
  const currentErrors = dismissed === state ? [] : (state.validationErrors ?? []);

  const hasErrors = currentErrors.length > 0;

  return (
    <section id="create-form" className="mt-8" aria-label="Create new formula set">
      <h3 className="text-sm font-extrabold text-text-heading">Create new formula set</h3>

      {/* Info banner: version is automatic */}
      <div className="mt-3 flex items-start gap-3 rounded-sm border border-primary-soft bg-primary-softer px-4 py-3 text-sm text-primary-dark">
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-base">ℹ</span>
        <div>
          <strong className="block font-extrabold">Version is automatic</strong>
          <p className="mt-0.5 text-xs opacity-90">
            New name → saved as v1. Existing name → saved as the next version
            automatically. Body validation runs before saving either way.
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-md border border-border bg-bg-card px-5 py-5 shadow-card">
        {isPending && (
          <div
            role="status"
            aria-label="Creating formula set"
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/50"
          >
            <div
              aria-hidden="true"
              className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white"
            />
            <p className="mt-3 text-sm font-medium text-white">Creating…</p>
          </div>
        )}

        {/* Top-level error (non-validation) */}
        {state.error && !state.validationErrors?.length && (
          <div className="mb-4 rounded-sm border border-status-failed-border bg-status-failed-bg px-4 py-3 text-sm font-semibold text-status-failed-text">
            {state.error}
          </div>
        )}

        <form action={formAction}>
          {/* Name */}
          <div className="mb-4">
            <label
              htmlFor="create-name"
              className="mb-1.5 block text-xs font-extrabold uppercase tracking-wider text-text-muted"
            >
              Name
            </label>
            <input
              id="create-name"
              name="name"
              type="text"
              list="existing-names-list"
              placeholder="e.g. glass-partition-standard"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-heading outline-none focus:border-primary"
            />
            <datalist id="existing-names-list">
              {existingNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <p className="mt-1 text-xs text-text-muted">
              Matches an existing name → next version. New name → v1.
            </p>
          </div>

          {/* Body JSON */}
          <div className="mb-4">
            <label
              htmlFor="create-body"
              className="mb-1.5 block text-xs font-extrabold uppercase tracking-wider text-text-muted"
            >
              Formula Set Body (JSON)
            </label>
            <textarea
              id="create-body"
              name="bodyJson"
              placeholder={'{"slots":{"GLASS":{"role":"glass"}}}'}
              rows={10}
              value={body}
              className={`w-full resize-y rounded-sm border px-3 py-2 font-mono text-xs text-text-heading outline-none focus:border-primary ${
                hasErrors ? "border-status-failed-text" : "border-border"
              } bg-bg-white`}
              onChange={(e) => {
                setBody(e.target.value);
                // Dismiss the current error set so Create re-enables while the
                // user is editing; fresh errors will appear on the next submit.
                setDismissed(state);
              }}
            />

            {/* Validation error panel — directly below textarea */}
            {hasErrors && (
              <div className="mt-2 rounded-sm border border-status-failed-border bg-status-failed-bg px-3 py-2.5">
                <p className="mb-1.5 text-xs font-extrabold text-status-failed-text">
                  Validation failed — {currentErrors.length} error
                  {currentErrors.length !== 1 ? "s" : ""}
                </p>
                <ul className="flex flex-col gap-1">
                  {currentErrors.map((e, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs font-semibold text-status-failed-text">
                      <span aria-hidden="true" className="mt-0.5 shrink-0 text-[10px]">✕</span>
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isPending || hasErrors}
              className="inline-flex items-center rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
