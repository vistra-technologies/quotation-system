"use client";

import { useActionState } from "react";
import { editOrg, type EditOrgState } from "../actions";
import { FormulaSetPicker, type FormulaSetPickerItem } from "../_formula-set-picker";
import type { OrgFormulaWarning } from "@/lib/data/superadmin/orgs";
import { SuspendOrgButton } from "../_suspend-button";

const initialState: EditOrgState = { error: null, saved: false, warnings: [] };

interface EditOrgFormProps {
  orgId: string;
  initialName: string;
  slug: string;
  isSuspended: boolean;
  activeFormulaSetId: string | null;
  formulaSets: FormulaSetPickerItem[];
  /** Mismatch warnings computed on page load (server-side). */
  initialMismatches: OrgFormulaWarning[];
}

/**
 * Client Component for editing an organization's name and formula-set assignment.
 *
 * Uses useActionState (React 19) so the server action returns { saved, warnings, error }
 * without navigating away. A "Saved" indicator appears on success. Mismatch warnings
 * are shown both on initial render (from server-computed data) and after every save.
 *
 * Stage 25 Batch 5.
 */
export function EditOrgForm({
  orgId,
  initialName,
  slug,
  isSuspended,
  activeFormulaSetId,
  formulaSets,
  initialMismatches,
}: EditOrgFormProps) {
  const [state, formAction, isPending] = useActionState(editOrg, initialState);

  const inputCls =
    "rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body placeholder:text-text-placeholder focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]";
  const labelCls = "text-xs font-bold uppercase tracking-wide text-text-muted";

  // After a save, use the warnings from the action state; otherwise show initial server data.
  const activeWarnings: OrgFormulaWarning[] = state.saved ? state.warnings : initialMismatches;
  const hasMismatch = activeWarnings.length > 0;

  return (
    <div className="flex flex-col gap-8">
      {/* ── Persistent mismatch banner (shown when mismatch is present) ── */}
      {hasMismatch && !state.saved && (
        <MismatchBanner message="Formula set mismatch — the assigned set references ComponentType codes that are missing or inactive in this org. New projects cannot be created under this org until this is resolved." />
      )}
      {hasMismatch && state.saved && (
        <MismatchBanner message="Formula set saved — but the assigned set references ComponentType codes that are missing or inactive in this org. New projects cannot be created under this org until this is resolved. See details below." />
      )}

      {/* ── Main form card ── */}
      <div className="rounded-md border border-border bg-bg-card p-7 shadow-card">
        {/* Error banner */}
        {state.error && (
          <div className="mb-5 rounded-sm border border-status-failed-bg bg-status-failed-bg px-4 py-3">
            <p className="text-sm text-status-failed-text">{state.error}</p>
          </div>
        )}

        <form action={formAction} className="flex flex-col gap-5">
          {/* Hidden org ID — server action reads it */}
          <input type="hidden" name="orgId" value={orgId} />

          {/* Name */}
          <div className="flex flex-col gap-1">
            <label htmlFor="editOrgName" className={labelCls}>
              Organization name
            </label>
            <input
              id="editOrgName"
              name="name"
              type="text"
              required
              autoComplete="off"
              defaultValue={initialName}
              className={inputCls}
            />
          </div>

          {/* Slug — read-only */}
          <div className="flex flex-col gap-1">
            <span className={labelCls}>Slug</span>
            <input
              type="text"
              readOnly
              value={slug}
              className={`${inputCls} cursor-default bg-[rgba(27,40,30,0.04)] font-mono text-text-muted`}
            />
            <p className="text-xs text-text-muted">
              The slug is fixed — it is the org&apos;s subdomain (
              <code className="font-mono">{slug}.easeetool.com</code>) and cannot be changed after creation.
            </p>
          </div>

          {/* Divider */}
          <hr className="border-border" />

          {/* Formula set picker */}
          <div className="flex flex-col gap-2">
            <FormulaSetPicker
              formulaSets={formulaSets}
              initialSetId={activeFormulaSetId ?? undefined}
              hint="Pick a name, then a version. Only new projects created under this org will use a changed version. Existing projects keep their pinned formula set version and are not affected."
            />

            {/* Mismatch detail panel — shown when there's a structural mismatch */}
            {hasMismatch && (
              <div
                id="mismatch-detail"
                className="mt-3 rounded-md border border-status-pending-border bg-status-pending-bg p-4"
              >
                <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-status-pending-text">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3.5 w-3.5 flex-shrink-0"
                    aria-hidden="true"
                  >
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  {state.saved
                    ? "The formula set was saved. The following are missing or inactive in this org:"
                    : "Missing or inactive in this org"}
                </p>
                <ul className="flex flex-col gap-1.5">
                  {activeWarnings.map((w, i) => (
                    <li
                      key={i}
                      className="rounded-sm bg-[rgba(135,87,17,0.07)] px-2.5 py-1.5 text-xs font-semibold text-status-pending-text"
                    >
                      {w.kind === "missing_code" ? (
                        <>
                          ComponentType{" "}
                          <code className="rounded-sm bg-[rgba(135,87,17,0.12)] px-1 py-px font-mono text-[11px] font-bold">
                            {w.code}
                          </code>{" "}
                          — does not exist or is inactive in this org.
                        </>
                      ) : (
                        <>
                          ComponentType{" "}
                          <code className="rounded-sm bg-[rgba(135,87,17,0.12)] px-1 py-px font-mono text-[11px] font-bold">
                            {w.code}
                          </code>{" "}
                          — field key{" "}
                          <code className="rounded-sm bg-[rgba(135,87,17,0.12)] px-1 py-px font-mono text-[11px] font-bold">
                            {w.key}
                          </code>{" "}
                          is required by the formula but is not configured in this org.
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 border-t border-status-pending-border pt-2.5 text-xs font-semibold text-status-pending-text opacity-85">
                  This is advisory only — the formula set assignment is saved. Fix these ComponentTypes in
                  this org&apos;s component type configuration to resolve the mismatch.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-3 border-t border-border pt-5">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save changes"}
            </button>
            {state.saved && (
              <span className="flex items-center gap-1.5 text-sm font-bold text-primary">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Saved
              </span>
            )}
          </div>
        </form>
      </div>

      {/* ── Org status section — suspend / reactivate ── */}
      <div>
        <h2 className="mb-3 text-base font-bold text-text-heading">Org status</h2>
        <div className="rounded-md border border-border bg-bg-white p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-text-heading">
                {isSuspended ? "Suspended" : "Active"}
              </p>
              <p className="mt-0.5 text-sm text-text-muted">
                {isSuspended
                  ? "This org is suspended. Users cannot sign in. Reactivate to restore access."
                  : "This org is active. Users can sign in and create projects."}
              </p>
            </div>
            <SuspendOrgButton orgId={orgId} orgName={initialName} isSuspended={isSuspended} />
          </div>
        </div>
      </div>
    </div>
  );
}

function MismatchBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-status-pending-border bg-status-pending-bg px-4 py-3">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-status-pending-text"
        aria-hidden="true"
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <p className="text-sm font-semibold text-status-pending-text">{message}</p>
    </div>
  );
}
