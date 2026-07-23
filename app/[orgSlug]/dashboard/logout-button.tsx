"use client";

import { authClient } from "@/lib/auth-client";

interface LogoutButtonProps {
  orgSlug: string;
}

/**
 * Client Component logout button.  Calls authClient.signOut() then performs a
 * hard navigation to /{orgSlug}/login via window.location.href.
 *
 * A hard navigation (not router.push) is intentional: router.push is a soft
 * navigation that keeps the dashboard's RSC payload in the Next.js client-side
 * router cache.  Pressing Back after a soft-nav logout would restore that
 * cached payload without re-running the server-side session guard.
 * window.location.href blows away the router cache entirely; the browser then
 * must fetch the dashboard fresh on Back, at which point force-dynamic +
 * Cache-Control: no-store prevents bfcache and the server redirects the
 * logged-out user to login.  (Next.js docs confirm this pattern in
 * docs/01-app/02-guides/preserving-ui-state.md §"State and authentication".)
 *
 * orgSlug is passed as a prop from DashboardPage (server component) because
 * client components have no access to route params or server-side headers.
 */
export function LogoutButton({ orgSlug }: LogoutButtonProps) {
  async function handleLogout() {
    await authClient.signOut();
    window.location.href = `/${orgSlug}/login`;
  }

  return (
    <button
      onClick={handleLogout}
      className="rounded-sm border border-border bg-bg-white px-5 py-2 text-sm font-medium text-text-body transition-colors hover:bg-primary-softer"
    >
      Sign out
    </button>
  );
}
