import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { DeleteUserButton } from "./delete-user-button";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

// ─── API response types ──────────────────────────────────────────────────────

interface UserRow {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  active: boolean;
  role: { name: string };
}

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * Users list page (Server Component).
 *
 * Lists all users within the session's org, ordered alphabetically.
 *
 * Stage 12: switched from direct requireSession + DAL calls to internalFetch
 * against GET /api/v1/orgs/[orgSlug]/users. RBAC (MANAGE_USERS) is enforced
 * by the route handler — 401/403 here redirects to login.
 *
 * Batch 7g: added Full Name column; added Delete row action (client component
 * with window.confirm() before proceeding).
 */
export default async function UsersPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [usersRes, t] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/users`),
    getTranslations("users"),
  ]);

  if (usersRes.status === 401 || usersRes.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  const users: UserRow[] = usersRes.ok
    ? ((await usersRes.json()) as { users: UserRow[] }).users
    : [];

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
                  {t("colFullName")}
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
                  <td className="px-5 py-3 text-zinc-700 dark:text-zinc-300">
                    {user.firstName} {user.lastName}
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
                    <div className="flex items-center justify-end gap-4">
                      <Link
                        href={`/${orgSlug}/admin/users/${user.id}`}
                        className="text-sm font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
                      >
                        {t("colActions")}
                      </Link>
                      <DeleteUserButton
                        orgSlug={orgSlug}
                        userId={user.id}
                        username={user.username}
                      />
                    </div>
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
