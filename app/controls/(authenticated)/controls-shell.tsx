"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { OrgSwitcher, type ControlsOrg } from "./_org-switcher";
import { TAB_SLUGS } from "./orgs/[orgId]/_tabs";

interface ControlsShellProps {
  children: React.ReactNode;
  /** SuperAdmin username forwarded from the server layout (requireSuperAdmin()). */
  username: string;
  /** Every org (suspended included) for the top-bar dropdown, fetched once by the server layout. */
  orgs: ControlsOrg[];
}

/**
 * SuperAdmin console shell (Client Component).
 *
 * Renders the sidebar + top bar + padded content area for all authenticated
 * /controls/** pages. Mirrors the app/[orgSlug]/sidebar.tsx visual language:
 * same Sage Ease tokens, same collapse behavior (252px expanded / 100px
 * collapsed), same active-link detection via usePathname().
 *
 * Nav items (Stage 29, S29-4 + O-1): Organizations, Org Workspace, Formula Sets, Audit Log,
 * SuperAdmins. The searchable org dropdown sits in the top bar; the URL is the source of truth
 * for which org (and tab) is chosen. On phones (< sm) the sidebar is a fixed 64px icon rail and
 * can't be expanded (Deviation 2).
 *
 * Logout: POSTs to /api/v1/superadmin/logout then hard-navigates to /controls/login (same
 * cookie-visible pattern as login).
 *
 * Stage 16 — nav shell added after implement-phase (human bug report during
 * formal test: no way to navigate between Orgs and Roles from the UI).
 */
export function ControlsShell({ children, username, orgs }: ControlsShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  // /controls/orgs/<orgId>[/<tab>] — "new" is the create-org page, not a workspace.
  const wsMatch = /^\/controls\/orgs\/([^/]+)(?:\/([^/]+))?/.exec(pathname);
  const wsOrgId = wsMatch && wsMatch[1] !== "new" ? decodeURIComponent(wsMatch[1]) : null;
  const wsTab = wsOrgId && wsMatch?.[2] && TAB_SLUGS.includes(wsMatch[2]) ? wsMatch[2] : null;

  const isActive = (prefix: string): boolean =>
    pathname === prefix || pathname.startsWith(`${prefix}/`);

  // Active state for the two items that share the /controls/orgs prefix.
  const activeFor = (id: "orgs" | "workspace" | string): boolean => {
    if (id === "orgs") return !wsOrgId && isActive("/controls/orgs");
    if (id === "workspace") return wsOrgId !== null || isActive("/controls/workspace");
    return isActive(id);
  };

  // Shared nav-item class builder — mirrors sidebar.tsx exactly.
  const navItemClass = (id: string): string => {
    const base =
      "flex items-center gap-3 rounded-sm text-sm font-bold transition-colors";
    const activeClass = "bg-primary text-text-on-primary";
    const inactiveClass =
      "text-text-body hover:bg-primary-softer hover:text-text-heading";
    // Phones always get the centred icon-only layout.
    const padding = collapsed
      ? "justify-center px-[11px] py-[11px]"
      : "justify-center px-[11px] py-[11px] sm:justify-start sm:px-[14px]";
    return `${base} ${padding} ${activeFor(id) ? activeClass : inactiveClass}`;
  };
  // Label visibility: hidden when collapsed, and on phones.
  const labelClass = collapsed ? "hidden" : "hidden sm:inline";

  async function handleLogout() {
    // Delete the SuperAdmin session server-side, then hard-navigate to login.
    // Hard navigation (not router.push) ensures the guard layout re-evaluates
    // requireSuperAdmin() without the now-cleared qs-sa-token cookie.
    //
    // Best-effort: even if the fetch fails (network error), navigate to /controls/login
    // anyway — the server-side guard will re-authenticate the next request and the
    // session will expire naturally.
    try {
      await fetch("/api/v1/superadmin/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      // Network failure — proceed to redirect regardless; guard will catch an invalid session.
    }
    window.location.href = "/controls/login";
  }

  return (
    <div className="flex h-screen bg-bg-page">
      {/* ── Sidebar ── */}
      <aside
        className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-bg-card transition-all duration-200 ${
          collapsed ? "w-16 sm:w-[100px]" : "w-16 sm:w-[252px]"
        }`}
      >
        {/* ── Sidebar top: logo mark + collapse button ── */}
        <div
          className={`flex items-center border-b border-border ${
            collapsed
              ? "justify-center gap-1 px-2 py-4"
              : "justify-center gap-2 px-2 py-4 sm:justify-between sm:px-[18px]"
          }`}
        >
          {/* Logo mark + wordmark — clicks to org list */}
          <Link
            href="/controls/orgs"
            className="flex items-center gap-2 overflow-hidden"
          >
            {/* Green square with document-checkmark icon — always visible */}
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-primary">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M14 2.5H6.8a1.8 1.8 0 0 0-1.8 1.8v15.4a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8V8.3z"
                  stroke="white"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M14 2.5v5.8h5.2"
                  stroke="white"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M8.6 14.2l2 2 4-4.4"
                  stroke="white"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            {/* Wordmark — hidden when collapsed */}
            {!collapsed && (
              <span className="hidden whitespace-nowrap text-base font-extrabold text-text-heading sm:inline">
                EaseeTool
              </span>
            )}
          </Link>

          {/* Collapse button — visible only when expanded */}
          {!collapsed && (
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              title="Collapse panel"
              aria-label="Collapse panel"
              className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-bg-white text-text-muted transition-colors hover:bg-primary-softer hover:text-primary-dark sm:flex"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
              </svg>
            </button>
          )}
        </div>

        {/* Expand rail button — visible only when collapsed */}
        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            title="Expand panel"
            aria-label="Expand panel"
            className="mx-auto mt-3 hidden h-7 w-7 items-center justify-center rounded-full sm:flex border border-border bg-bg-white text-text-muted transition-colors hover:bg-primary-softer hover:text-primary-dark"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="rotate-180"
            >
              <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
            </svg>
          </button>
        )}

        {/* ── Nav items ── */}
        <nav className="flex flex-1 flex-col gap-1 p-2 sm:p-[14px]">
          {/* Organizations: list / create (a single org is "Org Workspace") */}
          <Link
            href="/controls/orgs"
            title="Organizations"
            className={navItemClass("orgs")}
          >
            <svg
              className="h-5 w-5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 21h18M6 21V7l6-4 6 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1" />
            </svg>
            <span className={labelClass}>Organizations</span>
          </Link>
          {/* Org Workspace: the chosen org's current tab, or the empty state when none is chosen (M-3) */}
          <Link
            href={wsOrgId ? `/controls/orgs/${encodeURIComponent(wsOrgId)}/${wsTab ?? "overview"}` : "/controls/workspace"}
            title="Org Workspace"
            className={navItemClass("workspace")}
          >
            <svg
              className="h-5 w-5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="7" height="9" rx="1" />
              <rect x="14" y="3" width="7" height="5" rx="1" />
              <rect x="14" y="12" width="7" height="9" rx="1" />
              <rect x="3" y="16" width="7" height="5" rx="1" />
            </svg>
            <span className={labelClass}>Org Workspace</span>
          </Link>
          {/* Formula Sets */}
          <Link
            href="/controls/formula-sets"
            title="Formula Sets"
            className={navItemClass("/controls/formula-sets")}
          >
            <svg
              className="h-5 w-5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
            </svg>
            <span className={labelClass}>Formula Sets</span>
          </Link>
          {/* Audit Log (hotfix 2026-10-02) */}
          <Link
            href="/controls/audit-log"
            title="Audit Log"
            className={navItemClass("/controls/audit-log")}
          >
            <svg
              className="h-5 w-5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4l3 2" />
            </svg>
            <span className={labelClass}>Audit Log</span>
          </Link>
          {/* SuperAdmins (O-1): platform-level SuperAdmin accounts */}
          <Link
            href="/controls/admins"
            title="SuperAdmins"
            className={navItemClass("/controls/admins")}
          >
            <svg
              className="h-5 w-5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 2l7 4v5c0 5-3.5 9.7-7 11-3.5-1.3-7-6-7-11V6l7-4z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
            <span className={labelClass}>SuperAdmins</span>
          </Link>
        </nav>

        {/* ── Bottom: log out ── */}
        <div className="border-t border-border p-2 sm:p-[14px]">
          <button
            type="button"
            onClick={handleLogout}
            title="Log Out"
            className={`flex w-full items-center gap-3 rounded-sm text-sm font-bold text-text-body transition-colors hover:bg-primary-softer hover:text-text-heading ${
              collapsed
                ? "justify-center px-[11px] py-[11px]"
                : "justify-center px-[11px] py-[11px] sm:justify-start sm:px-[14px]"
            }`}
          >
            {/* Log-out arrow icon */}
            <svg
              className="h-5 w-5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span className={labelClass}>Log Out</span>
          </button>
        </div>
      </aside>

      {/* ── Right column: top bar + page content ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2.5 border-b border-border bg-bg-card px-4 shadow-header sm:gap-5 sm:px-6 lg:px-8">
          <span className="hidden whitespace-nowrap text-xs font-extrabold uppercase tracking-[.06em] text-text-muted sm:inline">
            SuperAdmin Console
          </span>
          <OrgSwitcher orgs={orgs} currentOrgId={wsOrgId} currentTab={wsTab} />
          <span className="hidden flex-1 sm:block" />
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden whitespace-nowrap text-sm text-text-muted sm:inline">
              Signed in as{" "}
              <span className="font-bold text-text-heading">{username}</span>
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="whitespace-nowrap rounded-sm border border-border bg-bg-white px-3 py-1.5 text-sm font-semibold text-text-body transition-colors hover:bg-primary-softer"
            >
              Log Out
            </button>
          </div>
        </header>

        {/* Main content area — padded container for all /controls/** pages. Fix round 1: was max-w-5xl
            (1024px), which left huge empty margins on wide screens; now a 1600px cap with the same
            responsive gutter as the top bar (16 / 24 / 32px). Forms inside cards keep their own max-w. */}
        <main className="flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-6 sm:py-8 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
