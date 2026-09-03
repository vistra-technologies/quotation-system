import { internalFetch } from "@/lib/internal-fetch";
import { OrgPicker } from "../roles/org-picker";
import { CreateUserForm } from "./create-user-form";

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
 * Scope: add-only. No edit, deactivate, or delete (Stage 17 scope boundary).
 *
 * Stage 17 Item 4b.
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;

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
          Add users to any organization. Select an org to see its current
          members and add a new one.
        </p>
      </div>

      {/* ── Org picker ── */}
      <div className="mt-6 max-w-sm">
        <OrgPicker
          orgs={selectableOrgs}
          selectedOrgId={orgId ?? null}
          basePath="/controls/users"
        />
      </div>

      {/* ── Users section (only when an org is selected) ── */}
      {orgId && selectedOrg && (
        <div className="mt-8">
          <h2 className="text-lg font-bold text-text-heading">
            {selectedOrg.name}
          </h2>

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

          {/* ── Add user form ── */}
          {roles && roles.length > 0 && (
            <div className="mt-8">
              <h3 className="text-sm font-bold text-text-heading">Add new user</h3>
              <div className="mt-3 max-w-md rounded-md border border-border bg-bg-card px-5 py-4 shadow-card">
                <CreateUserForm
                  orgId={orgId}
                  roles={roles}
                  externalCompanies={externalCompanies ?? []}
                />
              </div>
            </div>
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
