import Link from "next/link";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { UserDetailForms } from "./user-detail-forms";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

// ─── API response types ──────────────────────────────────────────────────────

interface UserDetail {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  mobile: string | null;
  profileEmail: string | null;
  active: boolean;
  roleId: string;
  role: { name: string };
}

interface RoleOption {
  id: string;
  name: string;
}

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * User detail page (Server Component shell).
 *
 * Shows username, full name, mobile, email, role, and active status.
 * Delegates the three action forms (activate/deactivate, change role, set
 * password) to the UserDetailForms Client Component so LoadingOverlay can
 * respond to pending state.
 *
 * Stage 12: switched from direct requireSession + DAL calls to internalFetch
 * against GET /api/v1/orgs/[orgSlug]/users/[userId] and GET /roles.
 * RBAC (MANAGE_USERS) is enforced by the route handlers.
 *
 * Batch 7g: added firstName, lastName, mobile, profileEmail to the metadata
 * display block. Mutation actions are unchanged (activate/deactivate/role/pw).
 *
 * The GET /users/[userId] response includes `isSelf` (true when the requesting
 * user is the target user) so the page does not need a separate session call.
 *
 * Tenancy guard: getUserById in the route handler filters by both id AND
 * organizationId = session's org, so a spoofed id for a different org returns 404.
 */
export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; userId: string }>;
}) {
  const { orgSlug, userId } = await params;
  const base = await orgHref(orgSlug, "");

  const [userRes, rolesRes, t] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/users/${userId}`),
    internalFetch(`/api/v1/orgs/${orgSlug}/roles`),
    getTranslations("users"),
  ]);

  if (userRes.status === 401 || userRes.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  if (userRes.status === 404) {
    notFound();
  }

  if (!userRes.ok) {
    notFound();
  }

  const { user, isSelf } = (await userRes.json()) as {
    user: UserDetail;
    isSelf: boolean;
  };

  const roles: RoleOption[] = rolesRes.ok
    ? ((await rolesRes.json()) as { roles: RoleOption[] }).roles
    : [];

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
            <dt className="text-text-muted">{t("fieldFirstName")}</dt>
            <dd className="font-bold text-text-heading">{user.firstName}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-text-muted">{t("fieldLastName")}</dt>
            <dd className="font-bold text-text-heading">{user.lastName}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-text-muted">{t("colUsername")}</dt>
            <dd className="font-bold text-text-heading">{user.username}</dd>
          </div>
          {user.mobile && (
            <div className="flex justify-between gap-4">
              <dt className="text-text-muted">{t("detailMobile")}</dt>
              <dd className="text-text-body">{user.mobile}</dd>
            </div>
          )}
          {user.profileEmail && (
            <div className="flex justify-between gap-4">
              <dt className="text-text-muted">{t("detailEmail")}</dt>
              <dd className="text-text-body">{user.profileEmail}</dd>
            </div>
          )}
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
          isSelf={isSelf}
        />
      </div>
    </div>
  );
}
