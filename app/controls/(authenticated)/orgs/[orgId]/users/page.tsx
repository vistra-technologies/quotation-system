import Link from "next/link";
import { notFound } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { getTranslations } from "next-intl/server";
import { AddUserButton, EditUserButton, DeleteSAUserButton } from "../../../users/_user-dialogs";
import { SeatPill } from "../../../_seat-pill";
import { loadWorkspaceOrg } from "../_org";

// Always render live — reads the SuperAdminSession table (via guard layout) and live DB.
export const dynamic = "force-dynamic";

// ─── API response types ────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  mobile: string | null;
  profileEmail: string | null;
  active: boolean;
  role: { id: string; name: string };
}

interface RoleRow {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  isInternalRole: boolean;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * Workspace Users tab (Server Component): one org's users, add + edit + delete.
 *
 * The org comes from the URL (/controls/orgs/[orgId]/users, S29-2). Works for a suspended org.
 * The platform-level SuperAdmin accounts section moved to /controls/admins (O-1).
 *
 * Auth: enforced by app/controls/(authenticated)/layout.tsx.
 *
 * UI/API separation (Stage 12 pattern): data fetched via internalFetch so
 * the qs-sa-token cookie is forwarded to route handlers.
 *
 * Scope: add + edit (hotfix 2026-09-25, H-5 lifted the Stage 17 add-only boundary),
 * both in popups; delete (H-9).
 *
 * Stage 17 Item 4b; moved into the workspace in Stage 29 Batch 1.
 */
export default async function OrgUsersPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const tUsers = await getTranslations("users");

  const org = await loadWorkspaceOrg(orgId);
  if (!org) notFound();
  const atCap = org.userCount >= org.userLimit;

  // ── Fetch users, roles, and external companies for the org ──────────────────

  let users: UserRow[] | null = null;
  let roles: RoleRow[] | null = null;
  let externalCompanies: { id: string; name: string }[] | null = null;

  const [usersRes, rolesRes] = await Promise.all([
    internalFetch(`/api/v1/superadmin/orgs/${encodeURIComponent(orgId)}/users`),
    internalFetch(`/api/v1/superadmin/roles?orgId=${encodeURIComponent(orgId)}`),
  ]);

  if (usersRes.ok) {
    const body = (await usersRes.json()) as {
      users: UserRow[];
      externalCompanies: { id: string; name: string }[];
    };
    users = body.users;
    externalCompanies = body.externalCompanies;
  } else if (usersRes.status !== 404) {
    return (
      <p className="p-8 text-center text-sm text-status-failed-text">
        Failed to load users — please refresh.
      </p>
    );
  }

  if (rolesRes.ok) {
    roles = ((await rolesRes.json()) as { roles: RoleRow[] }).roles;
  } else if (rolesRes.status !== 404) {
    return (
      <p className="p-8 text-center text-sm text-status-failed-text">
        Failed to load roles — please refresh.
      </p>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Users section ── */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-bold text-text-heading">Users</h2>
            <SeatPill used={org.userCount} limit={org.userLimit} />
          </div>
          {roles && roles.length > 0 && (
            <AddUserButton
              orgId={orgId}
              roles={roles}
              externalCompanies={externalCompanies ?? []}
              disabledReason={
                atCap ? "User limit reached. Raise the limit on the Overview tab." : undefined
              }
            />
          )}
        </div>

        {/* Stage 29: at the cap the Add button is disabled and this explains why. */}
        {atCap && (
          <div
            role="status"
            className="mt-4 rounded-md border border-status-pending-border bg-status-pending-bg px-4 py-3 text-sm font-semibold text-status-pending-text"
          >
            User limit reached ({org.userCount}/{org.userLimit}). Deactivated users count toward the limit.{" "}
            <Link
              href={`/controls/orgs/${encodeURIComponent(orgId)}/overview`}
              className="underline"
            >
              Raise the limit on the Overview tab
            </Link>{" "}
            to add more.
          </div>
        )}

        {/* ── Users table ── */}
        {users && users.length > 0 ? (
          <div className="mt-4 rounded-md border border-border bg-bg-card shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                      Username
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                      Name
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                      Role
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                      Status
                    </th>
                    <th className="px-5 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-text-muted">
                      Actions
                    </th>
                    {/* H-9: delete column — no heading */}
                    <th className="px-5 py-3.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-primary-softer/20">
                      <td className="px-5 py-4 font-semibold text-text-heading">
                        {user.username}
                      </td>
                      <td className="px-5 py-4 text-text-body">
                        {user.firstName} {user.lastName}
                      </td>
                      <td className="px-5 py-4 text-text-muted">
                        {user.role.name}
                      </td>
                      <td className="px-5 py-4">
                        {user.active ? (
                          <span className="rounded-pill bg-status-success-bg px-2 py-0.5 text-xs font-semibold text-status-success-text">
                            Active
                          </span>
                        ) : (
                          <span className="rounded-pill bg-status-failed-bg px-2 py-0.5 text-xs font-semibold text-status-failed-text">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {roles && roles.length > 0 && (
                          <EditUserButton
                            orgId={orgId}
                            user={user}
                            roles={roles}
                            deactivateHint={tUsers("editDeactivateHint")}
                            passwordHint={tUsers("editPasswordHint")}
                          />
                        )}
                      </td>
                      {/* H-9: delete action */}
                      <td className="px-3 py-4">
                        <DeleteSAUserButton
                          orgId={orgId}
                          userId={user.id}
                          username={user.username}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-text-muted">
            No users found for this organization.
          </p>
        )}

        {roles && roles.length === 0 && (
          <p className="mt-4 text-sm text-text-muted">
            This organization has no roles yet — create a role first before adding users.
          </p>
        )}
      </div>
    </div>
  );
}
