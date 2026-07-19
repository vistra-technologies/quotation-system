import Link from "next/link";
import { getSession } from "@/lib/session";
import { getAdminPermissions } from "@/lib/data/admin";
import { PERMISSIONS } from "@/lib/rbac";
import { LogoutButton } from "./dashboard/logout-button";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Org-scoped shell layout (Server Component).
 *
 * Wraps every page under /[orgSlug]/* with a persistent top bar and side panel
 * when the user is authenticated. The login page passes through unchanged
 * because getSession() returns null there (no session cookie / cross-org guard)
 * and the layout renders children directly.
 *
 * Nav links shown:
 *   - Projects (all authenticated users)
 *   - Inquiries (all authenticated users)
 *   - Design → projects list (entry point for wall design; all authenticated users)
 *   - Admin links (conditionally, based on MANAGE_USERS / MANAGE_FEATURES)
 *
 * No NextIntlClientProvider here — the nav chrome is pure Server Component.
 * Existing per-section layouts (projects, admin) continue to provide their own
 * NextIntlClientProvider as before.
 *
 * Stage 9 note: nav visual polish and collapse animation are deferred.
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
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex h-14 items-center justify-between px-6">
          <Link
            href={`/${orgSlug}/dashboard`}
            className="text-sm font-semibold text-zinc-900 hover:text-zinc-600 dark:text-zinc-50 dark:hover:text-zinc-300"
          >
            Vistra
          </Link>
          <LogoutButton orgSlug={orgSlug} />
        </div>
      </header>

      <div className="flex flex-1">
        {/* Side panel */}
        <nav className="w-56 shrink-0 border-r border-zinc-200 bg-white px-4 py-6 dark:border-zinc-800 dark:bg-zinc-900">
          <ul className="flex flex-col gap-1">
            <li>
              <Link
                href={`/${orgSlug}/projects`}
                className="block rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
              >
                Projects
              </Link>
            </li>
            <li>
              <Link
                href={`/${orgSlug}/inquiries`}
                className="block rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
              >
                Inquiries
              </Link>
            </li>
            <li>
              <Link
                href={`/${orgSlug}/projects`}
                className="block rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
              >
                Design
              </Link>
            </li>

            {/* Admin section — rendered only for users with admin permissions */}
            {(canManageUsers || canManageFeatures) && (
              <>
                <li className="mt-4 px-3 pb-1">
                  <span className="text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-600">
                    Admin
                  </span>
                </li>
                {canManageUsers && (
                  <>
                    <li>
                      <Link
                        href={`/${orgSlug}/admin/users`}
                        className="block rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                      >
                        Users
                      </Link>
                    </li>
                    <li>
                      <Link
                        href={`/${orgSlug}/admin/external-companies`}
                        className="block rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                      >
                        External Companies
                      </Link>
                    </li>
                    <li>
                      <Link
                        href={`/${orgSlug}/pricing`}
                        className="block rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                      >
                        Pricing
                      </Link>
                    </li>
                  </>
                )}
                {canManageFeatures && (
                  <>
                    <li>
                      <Link
                        href={`/${orgSlug}/admin/roles`}
                        className="block rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                      >
                        Roles
                      </Link>
                    </li>
                    <li>
                      <Link
                        href={`/${orgSlug}/admin/permissions`}
                        className="block rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                      >
                        Permissions
                      </Link>
                    </li>
                    <li>
                      <Link
                        href={`/${orgSlug}/admin/components`}
                        className="block rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                      >
                        Component Types
                      </Link>
                    </li>
                  </>
                )}
              </>
            )}
          </ul>
        </nav>

        {/* Main content area */}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
