"use client";

import { useActionState } from "react";
import { renameSuperAdminRole, type RoleActionState } from "./actions";

const initialState: RoleActionState = { error: null };

interface RenameRoleFormProps {
  orgId: string;
  roleId: string;
  currentName: string;
}

/**
 * Inline rename-role form (Client Component).
 *
 * Uses useActionState (React 19) so the server action can surface errors
 * (e.g. role not found) without crashing to an error boundary.
 * On success (error: null) the page revalidates via revalidatePath() in the action.
 *
 * Stage 16 Batch D — F3.
 */
export function RenameRoleForm({ orgId, roleId, currentName }: RenameRoleFormProps) {
  const [state, formAction, isPending] = useActionState(renameSuperAdminRole, initialState);

  const inputCls =
    "rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body focus:outline-none focus:border-primary focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]";

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="roleId" value={roleId} />

      <input
        name="name"
        type="text"
        required
        defaultValue={currentName}
        autoComplete="off"
        className={inputCls}
        aria-label="Role name"
      />

      <button
        type="submit"
        disabled={isPending}
        className="rounded-sm bg-primary px-3 py-2 text-xs font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Save"}
      </button>

      {state.error && (
        <p className="text-xs text-status-failed-text">{state.error}</p>
      )}
    </form>
  );
}
