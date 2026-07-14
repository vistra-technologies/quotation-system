import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/session";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { PermissionActionButton } from "./permission-buttons";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Role detail / edit-permissions page (Server Component).
 *
 * Shows the role's currently granted permissions and the full global permission
 * catalog, with Add / Remove buttons for each entry.
 *
 * Tenancy asymmetry enforced here:
 *   - Role is org-scoped: queried with organizationId = session.organizationId.
 *   - Permission catalog is global: no organizationId filter on prisma.permission.
 *   - RolePermission rows are created/deleted via server actions that re-verify
 *     the role's org before every write — see actions.ts.
 *
 * Gated on MANAGE_FEATURES.
 */
export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; roleId: string }>;
}) {
  const { orgSlug, roleId } = await params;
  const session = await getSession();
  if (!session) redirect(`/${orgSlug}/login`);

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (e) {
    if (e instanceof ForbiddenError) redirect(`/${orgSlug}/dashboard`);
    throw e;
  }

  // Tenancy guard on read: role must belong to this session's org.
  const [role, t] = await Promise.all([
    prisma.role.findFirst({
      where: { id: roleId, organizationId: session.organizationId },
    }),
    getTranslations("roles"),
  ]);

  if (!role) notFound();

  // Fetch current grants and the full global permission catalog in parallel.
  const [grantedRps, allPerms] = await Promise.all([
    prisma.rolePermission.findMany({
      where: { roleId },
      include: { permission: true },
      orderBy: { permission: { code: "asc" } },
    }),
    // Permission is a global table — no organizationId filter.
    prisma.permission.findMany({
      orderBy: { code: "asc" },
    }),
  ]);

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
