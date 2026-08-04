import { internalFetch } from "@/lib/internal-fetch";
import { detectIsSubdomain } from "@/lib/orgHref";
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

  // Compute subdomain mode once on the server so Sidebar and TopBarActions
  // receive the correct value as a prop — no client-side window.location read
  // required, no SSR/hydration mismatch.
  const isSubdomain = await detectIsSubdomain(orgSlug);

  const meRes = await internalFetch(`/api/v1/orgs/${orgSlug}/me`);

  // No session (401) or cross-org guard (403) → render page without chrome.
  // This is the pass-through for the login page and unauthenticated states.
  if (!meRes.ok) {
    return <>{children}</>;
  }

  const me = (await meRes.json()) as {
    name: string;
    username: string;
    orgName: string;
    adminPermissions: string[];
  };

  const canManageUsers = me.adminPermissions.includes("MANAGE_USERS");
  const canManageFeatures = me.adminPermissions.includes("MANAGE_FEATURES");

  return (
    <div className="flex min-h-screen bg-bg-page">
      {/* Sidebar — Client Component owning collapse state */}
      <Sidebar
        orgSlug={orgSlug}
        isSubdomain={isSubdomain}
        canManageUsers={canManageUsers}
        canManageFeatures={canManageFeatures}
      />

      {/* Right column: top bar + page content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-border bg-bg-card px-10 shadow-header">
          {/* Organisation chip — left side */}
          <div className="flex items-center gap-[7px] rounded-full bg-primary-softer px-3 py-[5px] text-[11.5px] font-bold text-primary-dark">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-[13px] w-[13px] shrink-0"
              aria-hidden="true"
            >
              <path d="M3 21h18M6 21V7l6-4 6 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1" />
            </svg>
            {me.orgName}
          </div>
          {/* Home + Profile actions — right side */}
          <TopBarActions orgSlug={orgSlug} isSubdomain={isSubdomain} name={me.name} username={me.username} />
        </header>

        {/* Main content area */}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
