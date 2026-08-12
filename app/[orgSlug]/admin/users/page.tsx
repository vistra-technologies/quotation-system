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
 *
 * Stage 11 Batch 8: restyled to Sage Ease tokens.
 */
export default async function UsersPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const base = await orgHref(orgSlug, "");

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
          <h1 className="text-2xl font-bold text-text-heading">
            {t("pageTitle")}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {t("pageSubtitle")}
          </p>
        </div>
        <Link
          href={`${base}/admin/users/new`}
          className="rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark"
        >
          {t("createUser")}
        </Link>
      </div>

      <div className="mt-6 rounded-md border border-border bg-bg-card shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                  {t("colUsername")}
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                  {t("colFullName")}
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                  {t("colRole")}
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                  {t("colStatus")}
                </th>
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-border last:border-0 hover:bg-primary-softer/40"
                >
                  <td className="px-5 py-4 font-bold text-text-heading">
                    {user.username}
                  </td>
                  <td className="px-5 py-4 text-text-body">
                    {user.firstName} {user.lastName}
                  </td>
                  <td className="px-5 py-4 text-text-body">
                    {user.role.name}
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={
                        user.active
                          ? "inline-flex items-center rounded-pill bg-status-paid-bg px-2.5 py-0.5 text-xs font-bold text-status-paid-text"
                          : "inline-flex items-center rounded-pill bg-border px-2.5 py-0.5 text-xs font-bold text-text-muted"
                      }
                    >
                      {user.active ? t("statusActive") : t("statusInactive")}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`${base}/admin/users/${user.id}`}
                        aria-label={t("editAction")}
                        title={t("editAction")}
                        className="flex items-center justify-center text-primary-dark hover:text-primary"
                      >
                        {/* Pencil icon 16×16 */}
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="none"
                          aria-hidden="true"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm1.414 1.06a.25.25 0 0 0-.354 0L2.543 12.023l-.625 2.185 2.185-.625L13.64 4.047a.25.25 0 0 0 0-.354l-1.213-1.206Z"
                            fill="currentColor"
                          />
                        </svg>
                      </Link>
                      <DeleteUserButton
                        orgSlug={orgSlug}
                        userId={user.id}
                        username={user.username}
                        confirmMessage={t("deleteConfirm", { username: user.username })}
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
