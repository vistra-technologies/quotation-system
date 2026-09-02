"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";

interface ControlsShellProps {
  children: React.ReactNode;
  /** SuperAdmin username forwarded from the server layout (requireSuperAdmin()). */
  username: string;
}

/**
 * SuperAdmin console shell (Client Component).
 *
 * Renders the sidebar + top bar + padded content area for all authenticated
 * /controls/** pages. Mirrors the app/[orgSlug]/sidebar.tsx visual language:
 * same Sage Ease tokens, same collapse behavior (252px expanded / 100px
 * collapsed), same active-link detection via usePathname().
 *
 * Nav items: Organizations (/controls/orgs) and Roles & Permissions
 * (/controls/roles). Logout: POSTs to /api/v1/superadmin/logout then
 * hard-navigates to /controls/login (same cookie-visible pattern as login).
 *
 * Stage 16 — nav shell added after implement-phase (human bug report during
 * formal test: no way to navigate between Orgs and Roles from the UI).
 */
export function ControlsShell({ children, username }: ControlsShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  const isActive = (prefix: string): boolean =>
    pathname === prefix || pathname.startsWith(`${prefix}/`);

  // Shared nav-item class builder — mirrors sidebar.tsx exactly.
  const navItemClass = (prefix: string): string => {
    const base =
      "flex items-center gap-3 rounded-sm text-sm font-bold transition-colors";
    const activeClass = "bg-primary text-text-on-primary";
    const inactiveClass =
      "text-text-body hover:bg-primary-softer hover:text-text-heading";
    const padding = collapsed
      ? "justify-center px-[11px] py-[11px]"
      : "px-[14px] py-[11px]";
    return `${base} ${padding} ${isActive(prefix) ? activeClass : inactiveClass}`;
  };

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
        style={{ width: collapsed ? "100px" : "252px" }}
        className="sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-bg-card transition-all duration-200"
      >
        {/* ── Sidebar top: logo mark + collapse button ── */}
        <div
          className={`flex items-center border-b border-border ${
            collapsed
              ? "justify-center gap-1 px-2 py-4"
              : "justify-between gap-2 px-[18px] py-4"
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
              <span className="whitespace-nowrap text-base font-extrabold text-text-heading">
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
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-bg-white text-text-muted transition-colors hover:bg-primary-softer hover:text-primary-dark"
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
            className="mx-auto mt-3 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-bg-white text-text-muted transition-colors hover:bg-primary-softer hover:text-primary-dark"
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
        <nav className="flex flex-1 flex-col gap-1 p-[14px]">
          {/* Organizations */}
          <Link
            href="/controls/orgs"
            title="Organizations"
            className={navItemClass("/controls/orgs")}
          >
            {/* Building / office icon */}
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
            {!collapsed && <span>Organizations</span>}
          </Link>

          {/* Roles & Permissions */}
          <Link
            href="/controls/roles"
            title="Roles & Permissions"
            className={navItemClass("/controls/roles")}
          >
            {/* Shield icon */}
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
            </svg>
            {!collapsed && <span>Roles &amp; Permissions</span>}
          </Link>
        </nav>

        {/* ── Bottom: log out ── */}
        <div className="border-t border-border p-[14px]">
          <button
            type="button"
            onClick={handleLogout}
            title="Log Out"
            className={`flex w-full items-center gap-3 rounded-sm text-sm font-bold text-text-body transition-colors hover:bg-primary-softer hover:text-text-heading ${
              collapsed ? "justify-center px-[11px] py-[11px]" : "px-[14px] py-[11px]"
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
            {!collapsed && <span>Log Out</span>}
          </button>
        </div>
      </aside>

      {/* ── Right column: top bar + page content ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-border bg-bg-card px-10 shadow-header">
          <span className="text-xs font-extrabold uppercase tracking-[.06em] text-text-muted">
            SuperAdmin Console
          </span>
          <div className="flex items-center gap-3">
            <span className="text-sm text-text-muted">
              Signed in as{" "}
              <span className="font-bold text-text-heading">{username}</span>
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-sm border border-border bg-bg-white px-3 py-1.5 text-sm font-semibold text-text-body transition-colors hover:bg-primary-softer"
            >
              Log Out
            </button>
          </div>
        </header>

        {/* Main content area — padded container for all /controls/** pages */}
        <main className="flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-5xl px-8 py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
