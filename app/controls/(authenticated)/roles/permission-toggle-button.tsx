"use client";

import { useFormStatus } from "react-dom";
import { grantSuperAdminRolePermission, revokeSuperAdminRolePermission } from "./actions";

/**
 * Renders a loading overlay while the enclosing form action is pending.
 * Must live inside <form> so useFormStatus() finds the correct ancestor.
 *
 * Deliberately does NOT use the shared @/components/loading-overlay — that
 * component calls next-intl's useTranslations() and requires a
 * NextIntlClientProvider ancestor (provided by the org-admin layout). The
 * /controls console has no such provider, so using it here throws on mount
 * and crashes to app/global-error.tsx (Stage 16 post-deploy bug, 2026-09-02).
 */
function PendingOverlay() {
  const { pending } = useFormStatus();
  if (!pending) return null;

  return (
    <div
      role="status"
      aria-label="Loading"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/50"
    >
      <div
        aria-hidden="true"
        className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white"
      />
      <p className="mt-3 text-sm font-medium text-white">Loading…</p>
    </div>
  );
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
