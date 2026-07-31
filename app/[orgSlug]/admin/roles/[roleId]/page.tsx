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
    <div>
      <Link
        href={`/${orgSlug}/admin/roles`}
        className="mb-4 inline-block text-sm text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
      >
        {t("backToList")}
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {role.name}
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {t("detailSubtitle")}
      </p>

      {/* Granted permissions */}
      <div className="mt-6 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t("grantedPermissions")}
          </h2>
        </div>
        {grantedRps.length === 0 ? (
          <p className="px-5 py-4 text-sm text-zinc-400 dark:text-zinc-500">
            {t("noGranted")}
          </p>
        ) : (
          <ul>
            {grantedRps.map((rp) => (
              <li
                key={rp.permissionId}
                className="flex items-center gap-4 border-b border-zinc-100 px-5 py-3 last:border-0 dark:border-zinc-800"
              >
                <span className="w-40 shrink-0 font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                  {rp.permission.code}
                </span>
                <span className="flex-1 text-sm text-zinc-500 dark:text-zinc-400">
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
        <div className="mt-6 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
            <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t("availablePermissions")}
            </h2>
          </div>
          <ul>
            {availablePerms.map((perm) => (
              <li
                key={perm.id}
                className="flex items-center gap-4 border-b border-zinc-100 px-5 py-3 last:border-0 dark:border-zinc-800"
              >
                <span className="w-40 shrink-0 font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                  {perm.code}
                </span>
                <span className="flex-1 text-sm text-zinc-500 dark:text-zinc-400">
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
