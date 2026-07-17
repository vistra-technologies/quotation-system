import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PERMISSIONS } from "@/lib/rbac";
import { getUserById } from "@/lib/data/users";
import { listRolesForDropdown } from "@/lib/data/admin";
import { requireSession, requirePermissionFor } from "@/lib/data/session";
import { UserDetailForms } from "./user-detail-forms";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * User detail page (Server Component shell).
 *
 * Shows username, role, and active status; delegates the three action forms
 * (activate/deactivate, change role, set password) to the UserDetailForms
 * Client Component so LoadingOverlay can respond to pending state.
 *
 * Tenancy guard: getUserById filters by both id AND organizationId = session's
 * org, so a client-supplied id for a different org returns notFound().
 */
export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; userId: string }>;
}) {
  const { orgSlug, userId } = await params;
  const session = await requireSession(orgSlug);
  await requirePermissionFor(session, PERMISSIONS.MANAGE_USERS, orgSlug);

  const [user, roles, t] = await Promise.all([
    // Tenancy guard: scope by both id and organizationId.
    getUserById(session, userId),
    listRolesForDropdown(session),
    getTranslations("users"),
  ]);

  if (!user) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-lg">
      <Link
        href={`/${orgSlug}/admin/users`}
        className="mb-4 inline-block text-sm text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
      >
        {t("backToList")}
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {t("detailPageTitle")}
      </h1>

      {/* User metadata */}
      <div className="mt-4 rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500 dark:text-zinc-400">{t("colUsername")}</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-50">{user.username}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500 dark:text-zinc-400">{t("colRole")}</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">{user.role.name}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500 dark:text-zinc-400">{t("colStatus")}</dt>
            <dd>
              <span
                className={
                  user.active
                    ? "inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-300"
                    : "inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                }
              >
                {user.active ? t("statusActive") : t("statusInactive")}
              </span>
            </dd>
          </div>
        </dl>
      </div>

      {/* Action forms (Client Component — drives LoadingOverlay) */}
      <div className="mt-6 flex flex-col gap-4">
        <UserDetailForms
          orgSlug={orgSlug}
          userId={user.id}
          isActive={user.active}
          currentRoleId={user.roleId}
          roles={roles}
          isSelf={user.id === session.userId}
        />
      </div>
    </div>
  );
}
