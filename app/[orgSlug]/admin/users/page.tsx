import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { DeleteUserButton } from "./delete-user-button";
import { AddUserButton, EditUserButton } from "./_user-dialogs";
import type { EditableUser } from "./_user-dialogs";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

// ─── API response types ──────────────────────────────────────────────────────

interface UserRow {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  mobile: string | null;
  profileEmail: string | null;
  externalCompanyId: string | null;
  active: boolean;
  roleId: string;
  role: { id: string; name: string };
}

interface RoleOption {
  id: string;
  name: string;
  isInternalRole: boolean;
}

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * Users list page (Server Component).
 *
 * Lists all users within the session's org, ordered alphabetically.
 *
 * Hotfix 2026-09-27 H-8: replaced full-page Add/Edit navigation with popup
 * modals (AddUserButton, EditUserButton from _user-dialogs.tsx). The existing
 * Delete action (DeleteUserButton) is unchanged. Fetches roles and external
 * companies to populate the modal dropdowns.
 */
export default async function UsersPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [usersRes, rolesRes, companiesRes, t] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/users`),
    internalFetch(`/api/v1/orgs/${orgSlug}/roles`),
    internalFetch(`/api/v1/orgs/${orgSlug}/external-companies`),
    getTranslations("users"),
  ]);

  if (usersRes.status === 401 || usersRes.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  // Stage 29: the list response carries seats { limit, used } (every user row counts).
  const usersBody = usersRes.ok
    ? ((await usersRes.json()) as {
        users: UserRow[];
        seats?: { limit: number; used: number };
        recordCounts?: Record<string, { projects: number; inquiries: number }>;
      })
    : null;
  const users: UserRow[] = usersBody?.users ?? [];
  const seats = usersBody?.seats ?? null;
  // Stage 31: projects/inquiries each user created (absent = none), for the delete dialog.
  const recordCounts = usersBody?.recordCounts ?? {};
  const atCap = seats !== null && seats.used >= seats.limit;

  const roles: RoleOption[] = rolesRes.ok
    ? ((await rolesRes.json()) as { roles: RoleOption[] }).roles
    : [];

  const externalCompanies: { id: string; name: string }[] = companiesRes.ok
    ? ((await companiesRes.json()) as { companies: { id: string; name: string }[] }).companies
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
        <div className="flex items-center gap-2.5">
          {seats && (
            <span
              title={t("seatsTitle", { used: seats.used, limit: seats.limit })}
              className={`inline-flex items-center whitespace-nowrap rounded-pill px-2.5 py-0.5 text-xs font-bold tabular-nums ${
                atCap
                  ? "bg-status-pending-bg text-status-pending-text"
                  : "bg-primary-softer text-primary-dark"
              }`}
            >
              {seats.used}/{seats.limit}
            </span>
          )}
          {/* H-8: replaced Link to /admin/users/new with AddUserButton modal. Stays enabled at the
              cap (Stage 29 Deviation 3): the org admin cannot raise the limit and the server is the
              single enforcer, so submitting shows the USER_LIMIT_REACHED form error. */}
          <AddUserButton
            orgSlug={orgSlug}
            roles={roles}
            externalCompanies={externalCompanies}
          />
        </div>
      </div>

      {atCap && seats && (
        <div
          role="status"
          className="mt-4 rounded-md border border-status-pending-border bg-status-pending-bg px-4 py-3 text-sm font-semibold text-status-pending-text"
        >
          {t("limitBanner", { used: seats.used, limit: seats.limit })}
        </div>
      )}

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
              {users.map((user) => {
                const editableUser: EditableUser = {
                  id: user.id,
                  username: user.username,
                  firstName: user.firstName,
                  lastName: user.lastName,
                  mobile: user.mobile,
                  profileEmail: user.profileEmail,
                  roleId: user.roleId ?? user.role.id,
                  role: user.role,
                  externalCompanyId: user.externalCompanyId,
                };
                return (
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
                        {/* H-8: replaced Link to /admin/users/[userId] with EditUserButton modal */}
                        <EditUserButton
                          orgSlug={orgSlug}
                          user={editableUser}
                          roles={roles}
                          externalCompanies={externalCompanies}
                        />
                        <DeleteUserButton
                          orgSlug={orgSlug}
                          userId={user.id}
                          username={user.username}
                          confirmMessage={t("deleteConfirm", { username: user.username })}
                          recordsMessage={
                            recordCounts[user.id]
                              ? t("deleteRecords", {
                                  projects: recordCounts[user.id].projects,
                                  inquiries: recordCounts[user.id].inquiries,
                                  name: `${user.firstName} ${user.lastName}`,
                                })
                              : null
                          }
                          reassignCandidates={users
                            .filter((u) => u.active && u.id !== user.id)
                            .map((u) => ({ id: u.id, label: `${u.firstName} ${u.lastName} (${u.username})` }))}
                          reassignLabel={t("deleteReassignLabel")}
                          reassignNoneLabel={t("deleteReassignNone", { name: `${user.firstName} ${user.lastName}` })}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
