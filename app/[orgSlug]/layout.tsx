import { getSession } from "@/lib/session";
import { getAdminPermissions } from "@/lib/data/admin";
import { PERMISSIONS } from "@/lib/rbac";
import { LogoutButton } from "./dashboard/logout-button";
import { Sidebar } from "./sidebar";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Org-scoped shell layout (Server Component).
 *
 * Wraps every page under /[orgSlug]/* with the Sage Ease app shell when the
 * user is authenticated. The login page passes through unchanged because
 * getSession() returns null there (no session cookie / cross-org guard) and
 * the layout renders children directly.
 *
 * Stage 10 (Task 1.3): shell redesigned — sidebar extracted to <Sidebar />
 * (Client Component, owns collapse state), top bar restyled with Sage Ease
 * tokens.  The "Vistra" brand string is replaced by the EaseeTool logo mark
 * inside <Sidebar />.
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
  const session = await getSession();

  // No session → login page or similar; render children without chrome.
  if (!session) {
    return <>{children}</>;
  }

  // One query for both MANAGE_USERS and MANAGE_FEATURES visibility.
  const adminCodes = await getAdminPermissions(session);
  const canManageUsers = adminCodes.includes(PERMISSIONS.MANAGE_USERS);
  const canManageFeatures = adminCodes.includes(PERMISSIONS.MANAGE_FEATURES);

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
          <LogoutButton orgSlug={orgSlug} />
        </header>

        {/* Main content area */}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
