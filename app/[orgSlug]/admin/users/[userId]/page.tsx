import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PERMISSIONS } from "@/lib/rbac";
import { getUserById } from "@/lib/data/users";
import { listRolesForDropdown } from "@/lib/data/admin";
import { requireSession, requirePermissionFor } from "@/lib/data/session";
import { orgHref } from "@/lib/orgHref";
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
 *
 * Stage 11 Batch 8: restyled to Sage Ease tokens. No logic changes.
 */
export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; userId: string }>;
}) {
  const { orgSlug, userId } = await params;
  const base = await orgHref(orgSlug, "");
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
        href={`${base}/admin/users`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-text-heading"
      >
        {t("backToList")}
      </Link>

      <h1 className="mt-2 text-2xl font-bold text-text-heading">
        {t("detailPageTitle")}
      </h1>

      {/* User metadata */}
      <div className="mt-4 rounded-md border border-border bg-bg-card p-5 shadow-card">
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-text-muted">{t("colUsername")}</dt>
            <dd className="font-bold text-text-heading">{user.username}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-text-muted">{t("colRole")}</dt>
            <dd className="text-text-body">{user.role.name}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-text-muted">{t("colStatus")}</dt>
            <dd>
              <span
                className={
                  user.active
                    ? "inline-flex items-center rounded-pill bg-status-paid-bg px-2.5 py-0.5 text-xs font-bold text-status-paid-text"
                    : "inline-flex items-center rounded-pill bg-border px-2.5 py-0.5 text-xs font-bold text-text-muted"
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
