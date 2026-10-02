import { internalFetch } from "@/lib/internal-fetch";
import { getTranslations } from "next-intl/server";
import { OrgPicker } from "../roles/org-picker";
import { AddUserButton, EditUserButton, DeleteSAUserButton } from "./_user-dialogs";
import {
  AddSuperAdminButton,
  ChangeSuperAdminPasswordButton,
  DeleteSuperAdminButton,
} from "./_admin-dialogs";

// Always render live — reads the SuperAdminSession table (via guard layout) and live DB.
export const dynamic = "force-dynamic";

// ─── API response types ────────────────────────────────────────────────────────

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  isSuspended: boolean;
  createdAt: string;
  userCount: number;
}

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

interface SuperAdminRow {
  id: string;
  username: string;
  createdAt: string;
  protected: boolean;
  isSelf: boolean;
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
 * SuperAdmin cross-org users console (Server Component).
 *
 * URL state:
 *   /controls/users              — org picker only (no org selected)
 *   /controls/users?orgId=xxx    — org selected; shows that org's users + add-user form
 *
 * Auth: enforced by app/controls/(authenticated)/layout.tsx.
 *
 * UI/API separation (Stage 12 pattern): data fetched via internalFetch so
 * the qs-sa-token cookie is forwarded to route handlers.
 *
 * Scope: add + edit (hotfix 2026-09-25, H-5 lifted the Stage 17 add-only boundary),
 * both in popups. No delete.
 *
 * Stage 17 Item 4b.
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  const tUsers = await getTranslations("users");

  // Always fetch the org list for the picker.
  const orgsRes = await internalFetch("/api/v1/superadmin/orgs");

  if (!orgsRes.ok) {
    return (
      <p className="p-8 text-center text-sm text-status-failed-text">
        Failed to load organizations — please refresh.
      </p>
    );
  }

  const orgs = ((await orgsRes.json()) as { orgs: OrgRow[] }).orgs;

  // SuperAdmin accounts (hotfix 2026-10-02). A failure here must not hide the org users console.
  const adminsRes = await internalFetch("/api/v1/superadmin/admins");
  const admins: SuperAdminRow[] | null = adminsRes.ok
    ? ((await adminsRes.json()) as { admins: SuperAdminRow[] }).admins
    : null;

  // Suspended orgs are excluded from the picker — adding users to a suspended org
  // isn't a supported flow (the org is locked out of the product).
  const selectableOrgs = orgs.filter((o) => !o.isSuspended);

  // Resolve selected org metadata.
  const selectedOrg = orgId ? orgs.find((o) => o.id === orgId) ?? null : null;

  // ── Fetch users, roles, and external companies for the selected org ──────────

  let users: UserRow[] | null = null;
  let roles: RoleRow[] | null = null;
  let externalCompanies: { id: string; name: string }[] | null = null;

  if (orgId) {
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
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-text-heading">Users</h1>
        <p className="mt-1 text-sm text-text-muted">
          Manage SuperAdmin accounts, and add or edit users in any
          organization. Select an org to see its current members.
        </p>
      </div>

      {/* ── SuperAdmin accounts (hotfix 2026-10-02) ── */}
      <section aria-labelledby="superadmins-heading" className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="superadmins-heading" className="text-lg font-bold text-text-heading">
              SuperAdmins
            </h2>
            <p className="mt-0.5 text-sm text-text-muted">
              Platform accounts that can sign in to this console.
            </p>
          </div>
          <AddSuperAdminButton />
        </div>

        {admins === null ? (
          <p className="mt-4 text-sm text-status-failed-text">
            Failed to load SuperAdmins — please refresh.
          </p>
        ) : (
          <div className="mt-4 rounded-md border border-border bg-bg-card shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="SuperAdmins">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                      Username
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                      Created
                    </th>
                    <th className="px-5 py-3.5 text-right text-xs font-bold uppercase tracking-wider text-text-muted">
                      Actions
                    </th>
                    <th className="px-5 py-3.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {admins.map((a) => (
                    <tr key={a.id} className="hover:bg-primary-softer/20">
                      <td className="px-5 py-4 font-semibold text-text-heading">
                        {a.username}
                        {a.isSelf && (
                          <span className="ml-2 rounded-pill bg-primary-softer px-2 py-0.5 text-xs font-semibold text-primary-dark">
                            You
                          </span>
                        )}
                        {a.protected && (
                          <span className="ml-2 rounded-pill bg-status-success-bg px-2 py-0.5 text-xs font-semibold text-status-success-text">
                            Protected
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-text-muted">
                        {new Date(a.createdAt).toISOString().slice(0, 10)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <ChangeSuperAdminPasswordButton
                          adminId={a.id}
                          username={a.username}
                          isSelf={a.isSelf}
                        />
                      </td>
                      <td className="px-3 py-4">
                        {/* The protected account is never deletable; the server enforces this too. */}
                        {!a.protected && (
                          <DeleteSuperAdminButton adminId={a.id} username={a.username} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ── Org picker ── */}
      <div className="mt-8 max-w-sm">
        <OrgPicker
          orgs={selectableOrgs}
          selectedOrgId={orgId ?? null}
          basePath="/controls/users"
        />
      </div>

      {/* ── Users section (only when an org is selected) ── */}
      {orgId && selectedOrg && (
        <div className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-text-heading">
              {selectedOrg.name}
            </h2>
            {roles && roles.length > 0 && (
              <AddUserButton
                orgId={orgId}
                roles={roles}
                externalCompanies={externalCompanies ?? []}
              />
            )}
          </div>

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
      )}

      {/* ── Placeholder when no org is selected ── */}
      {!orgId && (
        <p className="mt-8 text-sm text-text-muted">
          Select an organization above to view its members and add a new user.
        </p>
      )}
    </div>
  );
}
