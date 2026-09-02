"use client";

import { useFormStatus } from "react-dom";
import { LoadingOverlay } from "@/components/loading-overlay";
import { grantSuperAdminRolePermission, revokeSuperAdminRolePermission } from "./actions";

/**
 * Renders the loading overlay while the enclosing form action is pending.
 * Must live inside <form> so useFormStatus() finds the correct ancestor.
 */
function PendingOverlay() {
  const { pending } = useFormStatus();
  return <LoadingOverlay visible={pending} />;
}

interface PermissionToggleButtonProps {
  orgId: string;
  roleId: string;
  permissionId: string;
  action: "grant" | "revoke";
  label: string;
}

/**
 * Single grant or revoke permission button (Client Component).
 *
 * Each button renders its own <form> pointing at the appropriate server action.
 * The PendingOverlay child shows the full-screen overlay while the action is
 * in flight and disappears automatically when the action settles.
 *
 * Mirrors app/[orgSlug]/admin/roles/[roleId]/permission-buttons.tsx — same
 * useFormStatus() pattern, same Sage Ease styling tokens.
 *
 * Stage 16 Batch D — F3.
 */
export function PermissionToggleButton({
  orgId,
  roleId,
  permissionId,
  action,
  label,
}: PermissionToggleButtonProps) {
  const serverAction =
    action === "grant" ? grantSuperAdminRolePermission : revokeSuperAdminRolePermission;

  return (
    <form action={serverAction}>
      {/* PendingOverlay is inside the form so useFormStatus() resolves correctly */}
      <PendingOverlay />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="roleId" value={roleId} />
      <input type="hidden" name="permissionId" value={permissionId} />
      <button
        type="submit"
        className={
          action === "revoke"
            ? "text-sm font-semibold text-red-600 underline-offset-2 hover:underline"
            : "text-sm font-semibold text-primary underline-offset-2 hover:text-primary-dark hover:underline"
        }
      >
        {label}
      </button>
    </form>
  );
}
