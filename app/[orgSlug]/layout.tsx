import { internalFetch } from "@/lib/internal-fetch";
import { TopBarActions } from "./top-bar-actions";
import { Sidebar } from "./sidebar";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Org-scoped shell layout (Server Component).
 *
 * Wraps every page under /[orgSlug]/* with the Sage Ease app shell when the
 * user is authenticated. The login page passes through unchanged because
 * the /me call returns 401 there (no session cookie) and the layout renders
 * children directly.
 *
 * Stage 10 (Task 1.3): shell redesigned — sidebar extracted to <Sidebar />
 * (Client Component, owns collapse state), top bar restyled with Sage Ease
 * tokens.  The "Vistra" brand string is replaced by the EaseeTool logo mark
 * inside <Sidebar />.
 *
 * Stage 12 Batch 6: switched from getSession()/getAdminPermissions() DAL to
 * internalFetch against /api/v1/orgs/[orgSlug]/me.
 *
 * No NextIntlClientProvider here — the nav chrome is pure Server Component.
 * Existing per-section layouts (projects, admin, inquiries, orders) continue
 * to provide their own NextIntlClientProvider as before.
 */
export default async function OrgSlugLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const meRes = await internalFetch(`/api/v1/orgs/${orgSlug}/me`);

  // No session (401) or cross-org guard (403) → render page without chrome.
  // This is the pass-through for the login page and unauthenticated states.
  if (!meRes.ok) {
    return <>{children}</>;
  }

  const me = (await meRes.json()) as {
    name: string;
    username: string;
    adminPermissions: string[];
  };

  const canManageUsers = me.adminPermissions.includes("MANAGE_USERS");
  const canManageFeatures = me.adminPermissions.includes("MANAGE_FEATURES");

  return (
    <div className="flex min-h-screen bg-bg-page">
      {/* Sidebar — Client Component owning collapse state */}
      <Sidebar
        orgSlug={orgSlug}
        canManageUsers={canManageUsers}
        canManageFeatures={canManageFeatures}
      />

      {/* Right column: top bar + page content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-end border-b border-border bg-bg-card px-10 shadow-header">
          <TopBarActions orgSlug={orgSlug} name={me.name} username={me.username} />
        </header>

        {/* Main content area */}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
