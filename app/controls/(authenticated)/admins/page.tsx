import { internalFetch } from "@/lib/internal-fetch";
import {
  AddSuperAdminButton,
  ChangeSuperAdminPasswordButton,
  DeleteSuperAdminButton,
} from "../users/_admin-dialogs";

// Always render live — reads the SuperAdminSession table (via guard layout) and live DB.
export const dynamic = "force-dynamic";

// ─── API response types ────────────────────────────────────────────────────────

interface SuperAdminRow {
  id: string;
  username: string;
  createdAt: string;
  protected: boolean;
  isSelf: boolean;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * SuperAdmin accounts page (Server Component) — O-1, decided 2026-10-09: the platform-level
 * SuperAdmin accounts section gets its own sidebar item. Moved unchanged from the old
 * /controls/users page (hotfix 2026-10-02); the per-org users console now lives in the
 * org workspace's Users tab.
 *
 * Auth: enforced by app/controls/(authenticated)/layout.tsx.
 *
 * UI/API separation (Stage 12 pattern): data fetched via internalFetch so
 * the qs-sa-token cookie is forwarded to route handlers.
 */
export default async function SuperAdminsPage() {
  const adminsRes = await internalFetch("/api/v1/superadmin/admins");
  const admins: SuperAdminRow[] | null = adminsRes.ok
    ? ((await adminsRes.json()) as { admins: SuperAdminRow[] }).admins
    : null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── SuperAdmin accounts (hotfix 2026-10-02) ── */}
      <section aria-labelledby="superadmins-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 id="superadmins-heading" className="text-2xl font-bold text-text-heading">
              SuperAdmins
            </h1>
            <p className="mt-1 text-sm text-text-muted">
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
    </div>
  );
}
