import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { PermissionActionButton } from "./permission-buttons";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Role detail / edit-permissions page (Server Component).
 *
 * Shows the role's currently granted permissions and the full global permission
 * catalog, with Add / Remove buttons for each entry.
 *
 * Tenancy asymmetry preserved:
 *   - Role is org-scoped: GET /roles/[roleId] filters by organizationId.
 *   - Permission catalog is global: GET /permissions has no org filter.
 *   - RolePermission writes re-verify via assertRoleInOrg in route handlers.
 *
 * Gated on MANAGE_FEATURES (enforced by the /roles/[roleId] and /permissions routes).
 *
 * Stage 12 Batch 6: switched from requireSession/requirePermissionFor/DAL calls
 * to parallel internalFetch against the three relevant API routes.
 */
export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; roleId: string }>;
}) {
  const { orgSlug, roleId } = await params;
  const base = await orgHref(orgSlug, "");

  // Fetch role detail, granted permissions, and global permission catalog in parallel.
  // All three routes require MANAGE_FEATURES — a 403 from any means redirect to dashboard.
  const [roleRes, rolePermsRes, allPermsRes, t] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/roles/${roleId}`),
    internalFetch(`/api/v1/orgs/${orgSlug}/roles/${roleId}/permissions`),
    internalFetch(`/api/v1/permissions`),
    getTranslations("roles"),
  ]);

  if (
    roleRes.status === 401 ||
    rolePermsRes.status === 401 ||
    allPermsRes.status === 401
  ) {
    redirect(await orgHref(orgSlug, "/login"));
  }
  if (
    roleRes.status === 403 ||
    rolePermsRes.status === 403 ||
    allPermsRes.status === 403
  ) {
    redirect(await orgHref(orgSlug, "/dashboard"));
  }
  if (roleRes.status === 404) notFound();
  if (!roleRes.ok || !rolePermsRes.ok || !allPermsRes.ok) notFound();

  const { role } = (await roleRes.json()) as {
    role: { id: string; name: string };
  };
  const { rolePermissions: grantedRps } = (await rolePermsRes.json()) as {
    rolePermissions: Array<{
      permissionId: string;
      permission: { id: string; code: string; description: string };
    }>;
  };
  const { permissions: allPerms } = (await allPermsRes.json()) as {
    permissions: Array<{ id: string; code: string; description: string }>;
  };

  const grantedPermissionIds = new Set(grantedRps.map((rp) => rp.permissionId));
  const availablePerms = allPerms.filter((p) => !grantedPermissionIds.has(p.id));

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <Link
        href={`${base}/admin/roles`}
        className="mb-4 inline-block text-sm text-text-muted hover:text-text-heading"
      >
        {t("backToList")}
      </Link>

      <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-text-heading">
        {role.name}
      </h1>
      <p className="mt-1 text-sm text-text-muted">
        {t("detailSubtitle")}
      </p>

      {/* Granted permissions */}
      <div className="mt-6 rounded-md border border-border bg-bg-card shadow-card">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-bold text-text-body">
            {t("grantedPermissions")}
          </h2>
        </div>
        {grantedRps.length === 0 ? (
          <p className="px-5 py-4 text-sm text-text-muted">
            {t("noGranted")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {grantedRps.map((rp) => (
              <li
                key={rp.permissionId}
                className="flex items-center gap-4 px-5 py-3"
              >
                <span className="w-40 shrink-0 font-mono text-xs font-semibold text-text-heading">
                  {rp.permission.code}
                </span>
                <span className="flex-1 text-sm text-text-muted">
                  {rp.permission.description}
                </span>
                <PermissionActionButton
                  orgSlug={orgSlug}
                  roleId={roleId}
                  permissionId={rp.permissionId}
                  action="remove"
                  label={t("removePermission")}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Available permissions — only rendered when there is something to add */}
      {availablePerms.length > 0 && (
        <div className="mt-6 rounded-md border border-border bg-bg-card shadow-card">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-bold text-text-body">
              {t("availablePermissions")}
            </h2>
          </div>
          <ul className="divide-y divide-border">
            {availablePerms.map((perm) => (
              <li
                key={perm.id}
                className="flex items-center gap-4 px-5 py-3"
              >
                <span className="w-40 shrink-0 font-mono text-xs font-semibold text-text-heading">
                  {perm.code}
                </span>
                <span className="flex-1 text-sm text-text-muted">
                  {perm.description}
                </span>
                <PermissionActionButton
                  orgSlug={orgSlug}
                  roleId={roleId}
                  permissionId={perm.id}
                  action="add"
                  label={t("addPermission")}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
