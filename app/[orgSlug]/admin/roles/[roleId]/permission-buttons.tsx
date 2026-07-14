"use client";

import { useFormStatus } from "react-dom";
import { LoadingOverlay } from "@/components/loading-overlay";
import { addRolePermission, removeRolePermission } from "../actions";

/**
 * Renders the loading overlay while the enclosing form action is pending.
 * Must live inside <form> so useFormStatus() finds the correct ancestor.
 */
function PendingOverlay() {
  const { pending } = useFormStatus();
  return <LoadingOverlay visible={pending} />;
}

interface PermissionActionButtonProps {
  orgSlug: string;
  roleId: string;
  permissionId: string;
  action: "add" | "remove";
  label: string;
}

/**
 * Single add or remove permission button (Client Component).
 *
 * Each button renders its own <form> pointing at the appropriate server action.
 * The PendingOverlay child shows the full-screen overlay while the action is
 * in flight and disappears automatically when the action settles.
 */
export function PermissionActionButton({
  orgSlug,
  roleId,
  permissionId,
  action,
  label,
}: PermissionActionButtonProps) {
  const serverAction = action === "add" ? addRolePermission : removeRolePermission;

  return (
    <form action={serverAction}>
      {/* PendingOverlay is inside the form so useFormStatus() resolves correctly */}
      <PendingOverlay />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="roleId" value={roleId} />
      <input type="hidden" name="permissionId" value={permissionId} />
      <button
        type="submit"
        className={
          action === "remove"
            ? "text-sm text-red-600 underline-offset-2 hover:underline dark:text-red-400"
            : "text-sm font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
        }
      >
        {label}
      </button>
    </form>
  );
}
