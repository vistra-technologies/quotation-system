import Link from "next/link";
import { notFound } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { getTranslations } from "next-intl/server";
import { CreateRoleForm } from "../../../roles/create-role-form";
import { RenameRoleForm } from "../../../roles/rename-role-form";
import { PermissionToggleButton } from "../../../roles/permission-toggle-button";
import { loadWorkspaceOrg } from "../_org";

// Always render live — reads the SuperAdminSession table (via guard layout) and live DB.
export const dynamic = "force-dynamic";

// ─── API response types ────────────────────────────────────────────────────────

interface RoleRow {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  isInternalRole: boolean;
}

interface PermissionRow {
  id: string;
  code: string;
  description: string;
}

interface RolePermissionRow {
  permissionId: string;
  permission: PermissionRow;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * Workspace Roles & Permissions tab (Server Component).
 *
 * URL state:
 *   /controls/orgs/[orgId]/roles               — the org's roles
 *   /controls/orgs/[orgId]/roles?roleId=yyy    — role selected; shows permission toggles
 *
 * The org comes from the URL (S29-2) and works for a suspended org.
 *
 * Auth: enforced by app/controls/(authenticated)/layout.tsx.
 *
 * UI/API separation (Stage 12 pattern): data fetched via internalFetch → the
 * qs-sa-token cookie is forwarded so route handlers' requireSuperAdminFromRequest()
 * sees the session.
 *
 * Stage 16 Batch D — F3; moved into the workspace in Stage 29 Batch 1.
 */
export default async function OrgRolesPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ roleId?: string }>;
}) {
  const { orgId } = await params;
  const { roleId } = await searchParams;
  const tRoles = await getTranslations("roles");

  const selectedOrg = await loadWorkspaceOrg(orgId);
  if (!selectedOrg) notFound();

  // ── Fetch roles for the selected org ──────────────────────────────────────

  let roles: RoleRow[] | null = null;

  const rolesRes = await internalFetch(
    `/api/v1/superadmin/roles?orgId=${encodeURIComponent(orgId)}`,
  );
  if (rolesRes.ok) {
    roles = ((await rolesRes.json()) as { roles: RoleRow[] }).roles;
  } else if (rolesRes.status !== 404) {
    // 404 means the org doesn't exist (stale URL) — treat as no roles.
    // Other errors are unexpected.
    return (
      <p className="p-8 text-center text-sm text-status-failed-text">
        Failed to load roles — please refresh.
      </p>
    );
  }

  // ── Fetch role detail when a role is selected ──────────────────────────────

  let selectedRole: RoleRow | null = null;
  let grantedPermissions: RolePermissionRow[] | null = null;
  let allPermissions: PermissionRow[] | null = null;

  if (roleId && roles) {
    selectedRole = roles.find((r) => r.id === roleId) ?? null;

    if (selectedRole) {
      const [rolePermsRes, allPermsRes] = await Promise.all([
        internalFetch(
          `/api/v1/superadmin/roles/${encodeURIComponent(roleId)}/permissions?orgId=${encodeURIComponent(orgId)}`,
        ),
        internalFetch("/api/v1/superadmin/permissions"),
      ]);

      if (rolePermsRes.ok) {
        grantedPermissions = (
          (await rolePermsRes.json()) as { rolePermissions: RolePermissionRow[] }
        ).rolePermissions;
      }

      if (allPermsRes.ok) {
        allPermissions = (
          (await allPermsRes.json()) as { permissions: PermissionRow[] }
        ).permissions;
      }
    }
  }

  // Compute the set of not-yet-granted permissions (for the "available" list).
  const grantedIds = new Set(grantedPermissions?.map((rp) => rp.permissionId) ?? []);
  const availablePermissions =
    allPermissions?.filter((p) => !grantedIds.has(p.id)) ?? [];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      <p className="mb-5 text-sm text-text-muted">
        Manage roles and their permission assignments.
        The global permission catalog is read-only here — codes are managed via seeding.
      </p>

      {/* ── Roles section ── */}
      <div>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-text-heading">
              Roles — {selectedOrg.name}
            </h2>
          </div>

          {/* ── Roles table ── */}
          {roles && roles.length > 0 ? (
            <div className="mt-4 rounded-md border border-border bg-bg-card shadow-card">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                        Name
                      </th>
                      <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                        Description
                      </th>
                      <th className="px-5 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-text-muted">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {roles.map((role) => {
                      const isSelected = role.id === roleId;
                      return (
                        <tr
                          key={role.id}
                          className={isSelected ? "bg-primary-softer/30" : "hover:bg-primary-softer/20"}
                        >
                          <td className="px-5 py-4 font-semibold text-text-heading">
                            {role.name}
                            {role.isInternalRole && (
                              <span className="ml-2 rounded-pill bg-bg-subtle px-2 py-0.5 text-xs font-normal text-text-muted">
                                internal
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-4 text-text-muted">
                            {role.description ?? "—"}
                          </td>
                          <td className="px-5 py-4 text-right">
                            <Link
                              href={`/controls/orgs/${encodeURIComponent(orgId)}/roles?roleId=${encodeURIComponent(role.id)}`}
                              className="text-sm font-semibold text-primary hover:text-primary-dark"
                            >
                              {isSelected ? "Selected" : "Manage permissions"}
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-text-muted">
              No roles found for this organization.
            </p>
          )}

          {/* ── Create role form ── */}
          <div className="mt-6">
            <h3 className="text-sm font-bold text-text-heading">Create new role</h3>
            <div className="mt-3 max-w-md rounded-md border border-border bg-bg-card px-5 py-4 shadow-card">
              <CreateRoleForm
                orgId={orgId}
                roleNamePlaceholder={tRoles("fieldNamePlaceholder")}
                roleDescriptionPlaceholder={tRoles("fieldDescriptionPlaceholder")}
              />
            </div>
          </div>
      </div>

      {/* ── Role detail / permission management ── */}
      {roleId && selectedRole && grantedPermissions !== null && (
        <div className="mt-8">
          {/* Rename form */}
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-bold text-text-heading shrink-0">
              Role:
            </h2>
            <RenameRoleForm
              orgId={orgId}
              roleId={roleId}
              currentName={selectedRole.name}
            />
          </div>

          <p className="mt-1 text-sm text-text-muted">
            Edit the name above and click Save. Permission changes take effect immediately.
          </p>

          {/* Granted permissions */}
          <div className="mt-4 rounded-md border border-border bg-bg-card shadow-card">
            <div className="border-b border-border px-5 py-3">
              <h3 className="text-sm font-bold text-text-body">Granted permissions</h3>
            </div>
            {grantedPermissions.length === 0 ? (
              <p className="px-5 py-4 text-sm text-text-muted">
                No permissions granted to this role yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {grantedPermissions.map((rp) => (
                  <li key={rp.permissionId} className="flex items-center gap-4 px-5 py-3">
                    <span className="w-48 shrink-0 font-mono text-xs font-semibold text-text-heading">
                      {rp.permission.code}
                    </span>
                    <span className="flex-1 text-sm text-text-muted">
                      {rp.permission.description}
                    </span>
                    <PermissionToggleButton
                      orgId={orgId}
                      roleId={roleId}
                      permissionId={rp.permissionId}
                      action="revoke"
                      label="Revoke"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Available permissions */}
          {availablePermissions.length > 0 && (
            <div className="mt-4 rounded-md border border-border bg-bg-card shadow-card">
              <div className="border-b border-border px-5 py-3">
                <h3 className="text-sm font-bold text-text-body">Available permissions</h3>
              </div>
              <ul className="divide-y divide-border">
                {availablePermissions.map((perm) => (
                  <li key={perm.id} className="flex items-center gap-4 px-5 py-3">
                    <span className="w-48 shrink-0 font-mono text-xs font-semibold text-text-heading">
                      {perm.code}
                    </span>
                    <span className="flex-1 text-sm text-text-muted">
                      {perm.description}
                    </span>
                    <PermissionToggleButton
                      orgId={orgId}
                      roleId={roleId}
                      permissionId={perm.id}
                      action="grant"
                      label="Grant"
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Back link */}
          <div className="mt-4">
            <Link
              href={`/controls/orgs/${encodeURIComponent(orgId)}/roles`}
              className="text-sm text-text-muted hover:text-text-heading"
            >
              ← Back to roles list
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
