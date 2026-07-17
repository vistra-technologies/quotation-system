import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PERMISSIONS } from "@/lib/rbac";
import { listUsers } from "@/lib/data/users";
import { requireSession, requirePermissionFor } from "@/lib/data/session";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Users list page (Server Component).
 *
 * Lists all users within the session's org, ordered alphabetically.
 * Gated on MANAGE_USERS — wrong-role requests redirect to the dashboard.
 */
export default async function UsersPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await requireSession(orgSlug);
  await requirePermissionFor(session, PERMISSIONS.MANAGE_USERS, orgSlug);

  const [users, t] = await Promise.all([
    listUsers(session),
    getTranslations("users"),
  ]);

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t("pageTitle")}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {t("pageSubtitle")}
          </p>
        </div>
        <Link
          href={`/${orgSlug}/admin/users/new`}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {t("createUser")}
        </Link>
      </div>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                  {t("colUsername")}
                </th>
                <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                  {t("colRole")}
                </th>
                <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                  {t("colStatus")}
                </th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                >
                  <td className="px-5 py-3 font-medium text-zinc-900 dark:text-zinc-50">
                    {user.username}
                  </td>
                  <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400">
                    {user.role.name}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={
                        user.active
                          ? "inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-300"
                          : "inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                      }
                    >
                      {user.active ? t("statusActive") : t("statusInactive")}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/${orgSlug}/admin/users/${user.id}`}
                      className="text-sm font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
                    >
                      {t("colActions")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
