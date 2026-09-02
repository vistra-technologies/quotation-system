"use client";

import { useActionState } from "react";
import { createSuperAdminRole, type RoleActionState } from "./actions";

const initialState: RoleActionState = { error: null };

interface CreateRoleFormProps {
  orgId: string;
}

/**
 * Create-role form (Client Component).
 *
 * Uses useActionState (React 19) so the server action can return a user-readable
 * error rather than crashing to an error boundary. On success, the action
 * redirects to the new role's detail view.
 *
 * Mirrors app/controls/(authenticated)/orgs/new/create-org-form.tsx pattern.
 *
 * Stage 16 Batch D — F3.
 */
export function CreateRoleForm({ orgId }: CreateRoleFormProps) {
  const [state, formAction, isPending] = useActionState(createSuperAdminRole, initialState);

  const inputCls =
    "rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body placeholder:text-text-placeholder focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]";
  const labelCls = "text-xs font-bold uppercase tracking-wide text-text-muted";

  return (
    <>
      {state.error && (
        <div className="mb-4 rounded-sm border border-status-failed-bg bg-status-failed-bg px-4 py-3">
          <p className="text-sm text-status-failed-text">{state.error}</p>
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="orgId" value={orgId} />

        <div className="flex flex-col gap-1">
          <label htmlFor="roleName" className={labelCls}>
            Role name
          </label>
          <input
            id="roleName"
            name="name"
            type="text"
            required
            autoComplete="off"
            placeholder="e.g. Sales Manager"
            className={inputCls}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="roleDescription" className={labelCls}>
            Description (optional)
          </label>
          <input
            id="roleDescription"
            name="description"
            type="text"
            autoComplete="off"
            placeholder="What this role is for"
            className={inputCls}
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
        >
          {isPending ? "Creating…" : "Create role"}
        </button>
      </form>
    </>
  );
}
