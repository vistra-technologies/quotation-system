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
            <dt className="text-zinc-500 dark:text-zinc-400">{t("fieldFirstName")}</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-50">{user.firstName}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500 dark:text-zinc-400">{t("fieldLastName")}</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-50">{user.lastName}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500 dark:text-zinc-400">{t("colUsername")}</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-50">{user.username}</dd>
          </div>
          {user.mobile && (
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500 dark:text-zinc-400">{t("detailMobile")}</dt>
              <dd className="text-zinc-900 dark:text-zinc-50">{user.mobile}</dd>
            </div>
          )}
          {user.profileEmail && (
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500 dark:text-zinc-400">{t("detailEmail")}</dt>
              <dd className="text-zinc-900 dark:text-zinc-50">{user.profileEmail}</dd>
            </div>
          )}
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
          isSelf={isSelf}
        />
      </div>
    </div>
  );
}
