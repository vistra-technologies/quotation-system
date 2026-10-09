"use client";

import { useActionState } from "react";
import { editOrg, type EditOrgState } from "../../actions";
import { SuspendOrgButton } from "../../_suspend-button";

const initialState: EditOrgState = { error: null, saved: false, warnings: [] };

interface EditOrgFormProps {
  orgId: string;
  initialName: string;
  slug: string;
  isSuspended: boolean;
  userLimit: number;
  userCount: number;
  /** Pre-formatted creation date (read-only). */
  createdLabel: string;
}

/**
 * Client Component for the workspace Overview tab: organization name, read-only slug and
 * created date, and suspend / reactivate.
 *
 * Uses useActionState (React 19) so the server action returns { saved, error } without
 * navigating away. A "Saved" indicator appears on success.
 *
 * The formula-set picker and mismatch panel moved to the Formula & Pricing tab
 * (formula/formula-form.tsx) in Stage 29. Originally Stage 25 Batch 5.
 */
export function EditOrgForm({
  orgId,
  initialName,
  slug,
  isSuspended,
  userLimit,
  userCount,
  createdLabel,
}: EditOrgFormProps) {
  const [state, formAction, isPending] = useActionState(editOrg, initialState);

  const inputCls =
    "rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body placeholder:text-text-placeholder focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]";
  const labelCls = "text-xs font-bold uppercase tracking-wide text-text-muted";

  return (
    <div className="flex flex-col gap-8">
      {/* ── Main form card ── */}
      <div className="max-w-[640px] rounded-md border border-border bg-bg-card p-7 shadow-card">
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

          {/* User limit — SuperAdmin only (this whole console is). Every user counts, active or not. */}
          <div className="flex flex-col gap-1">
            <label htmlFor="editOrgUserLimit" className={`${labelCls} flex items-center gap-2`}>
              User limit
              <span className="rounded-pill bg-primary-softer px-2 py-px text-[11px] font-bold normal-case tracking-normal text-primary-dark">
                SuperAdmin only
              </span>
            </label>
            <input
              id="editOrgUserLimit"
              name="userLimit"
              type="number"
              required
              min={1}
              max={10000}
              step={1}
              defaultValue={userLimit}
              className={`${inputCls} max-w-[160px]`}
            />
            <p className="text-xs text-text-muted">
              Currently {userCount} of {userLimit} used. Default 3 for new orgs (1–10000). Every user counts toward
              the limit, active or deactivated. Lowering it below current usage is allowed and only blocks new adds.
            </p>
          </div>

          {/* Created — read-only */}
          <div className="flex flex-col gap-1">
            <span className={labelCls}>Created</span>
            <input
              type="text"
              readOnly
              value={createdLabel}
              className={`${inputCls} max-w-[200px] cursor-default bg-[rgba(27,40,30,0.04)] text-text-muted`}
            />
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
        <div className="max-w-[640px] rounded-md border border-border bg-bg-white p-4">
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
