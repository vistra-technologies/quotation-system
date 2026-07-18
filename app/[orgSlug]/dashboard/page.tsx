import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/session";
import { PERMISSIONS } from "@/lib/rbac";
import { getOrgById, getSessionRole, getSessionRolePermissions } from "@/lib/data/admin";
import { LogoutButton } from "./logout-button";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Protected proof page (Server Component).
 *
 * Verifies the session, then displays the authenticated user's identity and
 * effective permissions.  If no valid session exists (or user is inactive),
 * redirects to /{orgSlug}/login.
 */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await getSession();

  if (!session) {
    redirect(`/${orgSlug}/login`);
  }

  const [org, role, permissionCodes, t] = await Promise.all([
    getOrgById(session.organizationId),
    getSessionRole(session),
    getSessionRolePermissions(session),
    getTranslations("dashboard"),
  ]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 dark:bg-zinc-950">
      <main className="w-full max-w-lg">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Session verified — your identity and permissions below.
        </p>

        <div className="mt-6 rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500 dark:text-zinc-400">Username</dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                {session.username}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500 dark:text-zinc-400">Organization</dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                {org?.name ?? session.organizationId}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500 dark:text-zinc-400">Role</dt>
              <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                {role?.name ?? session.roleId}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="shrink-0 text-zinc-500 dark:text-zinc-400">
                Permissions
              </dt>
              <dd className="text-right font-mono text-xs text-zinc-900 dark:text-zinc-50">
                {permissionCodes.length > 0 ? permissionCodes.join(", ") : "none"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-4">
          <Link
            href={`/${orgSlug}/projects`}
            className="block w-full rounded-md border border-zinc-300 bg-white px-4 py-2 text-center text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {t("projects")}
          </Link>
        </div>

        <div className="mt-4">
          <Link
            href={`/${orgSlug}/inquiries`}
            className="block w-full rounded-md border border-zinc-300 bg-white px-4 py-2 text-center text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {t("inquiries")}
          </Link>
        </div>

        {permissionCodes.includes(PERMISSIONS.MANAGE_PRICING) && (
          <div className="mt-4">
            <Link
              href={`/${orgSlug}/pricing`}
              className="block w-full rounded-md border border-zinc-300 bg-white px-4 py-2 text-center text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {t("managePricing")}
            </Link>
          </div>
        )}

        {(permissionCodes.includes(PERMISSIONS.MANAGE_USERS) ||
          permissionCodes.includes(PERMISSIONS.MANAGE_FEATURES)) && (
          <div className="mt-4">
            <Link
              href={
                permissionCodes.includes(PERMISSIONS.MANAGE_USERS)
                  ? `/${orgSlug}/admin/users`
                  : `/${orgSlug}/admin/roles`
              }
              className="block w-full rounded-md border border-zinc-300 bg-white px-4 py-2 text-center text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {t("manageAdmin")}
            </Link>
          </div>
        )}

        <div className="mt-4">
          <LogoutButton orgSlug={orgSlug} />
        </div>
      </main>
    </div>
  );
}
