"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";

interface SidebarProps {
  orgSlug: string;
  canManageUsers: boolean;
  canManageFeatures: boolean;
}

/**
 * Authenticated app-shell sidebar (Client Component).
 *
 * Owns collapse state: 252px expanded (icon + label) / 100px collapsed (icon
 * only). Determines the active nav item via usePathname(), handling both
 * path-based routing (/orgSlug/projects) and subdomain-based routing after
 * Batch 2's rewrite (/projects without orgSlug prefix).
 *
 * Admin links are shown via a CSS-only hover flyout (Tailwind `group` /
 * `group-hover`) — no additional React state required.
 *
 * Receives `canManageUsers` and `canManageFeatures` from the parent Server
 * Component (layout.tsx) which has already fetched admin permissions.
 *
 * Stage 10 — Task 1.3: initial extraction. The hardcoded "Vistra" brand string
 * in layout.tsx is removed here; the EaseeTool logo mark lives in the
 * sidebar-top section.  Task 2.1 (Batch 6) makes no further changes to this
 * file (the rebrand is already applied here from the start).
 */
export function Sidebar({
  orgSlug,
  canManageUsers,
  canManageFeatures,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  // Handle both path-based routing (/orgSlug/...) and subdomain-based routing
  // (/... without orgSlug prefix). After Batch 2's proxy rewrite, users on
  // orgSlug.easeetool.com see /projects in the address bar (no orgSlug).
  const sectionPath = pathname.startsWith(`/${orgSlug}`)
    ? pathname.slice(`/${orgSlug}`.length) || "/"
    : pathname;

  const isActive = (section: string): boolean =>
    sectionPath === section || sectionPath.startsWith(`${section}/`);

  const showAdmin = canManageUsers || canManageFeatures;

  // Shared nav-item class builder — active state applies Sage Ease primary green.
  const navItemClass = (section: string): string => {
    const base =
      "flex items-center gap-3 rounded-sm text-sm font-bold transition-colors";
    const activeClass = "bg-primary text-text-on-primary";
    const inactiveClass =
      "text-text-body hover:bg-primary-softer hover:text-text-heading";
    const padding = collapsed ? "justify-center px-[11px] py-[11px]" : "px-[14px] py-[11px]";
    return `${base} ${padding} ${isActive(section) ? activeClass : inactiveClass}`;
  };

  return (
    <aside
      style={{ width: collapsed ? "100px" : "252px" }}
      className="sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-bg-card transition-all duration-200"
    >
      {/* ── Sidebar top: logo mark + collapse button ── */}
      <div
        className={`flex items-center border-b border-border ${
          collapsed
            ? "justify-center gap-1 px-2 py-5"
            : "justify-between gap-2 px-[18px] py-5"
        }`}
      >
        {/* Logo mark square + wordmark */}
        <div className="flex items-center gap-2 overflow-hidden">
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
            <span className="whitespace-nowrap text-sm font-extrabold text-text-heading">
              EaseeTool
            </span>
          )}
        </div>

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
          {/* Arrows pointing right (rotation-180 of the collapse icon) */}
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
        {/* Inquiries */}
        <Link
          href={`/${orgSlug}/inquiries`}
          title="Inquiries"
          className={navItemClass("/inquiries")}
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
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
          {!collapsed && <span>Inquiries</span>}
        </Link>

        {/* Orders — new in Stage 10, no permission gate */}
        <Link
          href={`/${orgSlug}/orders`}
          title="Orders"
          className={navItemClass("/orders")}
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
            <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
          </svg>
          {!collapsed && <span>Orders</span>}
        </Link>

        {/* Projects */}
        <Link
          href={`/${orgSlug}/projects`}
          title="Projects"
          className={navItemClass("/projects")}
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
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
          </svg>
          {!collapsed && <span>Projects</span>}
        </Link>
      </nav>

      {/* ── Admin section (conditional) — CSS-only hover flyout ── */}
      {showAdmin && (
        <div className="border-t border-border p-[14px]">
          {/*
           * Flyout pattern: `group` on the wrapper, `group-hover:` on the
           * flyout panel. Hovering over either the trigger button OR the flyout
           * panel itself keeps the hover state active (both are inside `group`).
           * The flyout is absolutely positioned to the right of the sidebar,
           * so it never clips the sidebar's own scrollable area.
           */}
          <div className="group relative">
            <button
              type="button"
              title="Admin"
              className={`flex w-full items-center gap-3 rounded-sm text-sm font-bold text-text-body transition-colors hover:bg-primary-softer hover:text-text-heading ${
                collapsed ? "justify-center px-[11px] py-[11px]" : "px-[14px] py-[11px]"
              }`}
            >
              {/* Settings / gear icon */}
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
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>

              {!collapsed && (
                <>
                  <span>Admin</span>
                  {/* Caret pointing right */}
                  <svg
                    className="ml-auto h-3.5 w-3.5 shrink-0 text-text-placeholder"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </>
              )}
            </button>

            {/* Admin flyout panel — positioned to the right of the sidebar */}
            <div className="invisible absolute bottom-0 left-full z-40 ml-2.5 min-w-[220px] translate-x-[-6px] rounded-md border border-border bg-bg-white py-2 opacity-0 shadow-[0_16px_34px_-12px_rgba(27,40,30,.28)] transition-all duration-150 group-hover:visible group-hover:translate-x-0 group-hover:opacity-100">
              <p className="px-2.5 pb-1.5 pt-2 text-[10.5px] font-extrabold uppercase tracking-[.06em] text-text-muted">
                Admin
              </p>

              {canManageUsers && (
                <>
                  <Link
                    href={`/${orgSlug}/admin/users`}
                    className="block rounded-md px-2.5 py-2.5 text-[13.5px] font-semibold text-text-body hover:bg-primary-softer hover:text-text-heading"
                  >
                    Users
                  </Link>
                  <Link
                    href={`/${orgSlug}/admin/external-companies`}
                    className="block rounded-md px-2.5 py-2.5 text-[13.5px] font-semibold text-text-body hover:bg-primary-softer hover:text-text-heading"
                  >
                    External Companies
                  </Link>
                  <Link
                    href={`/${orgSlug}/pricing`}
                    className="block rounded-md px-2.5 py-2.5 text-[13.5px] font-semibold text-text-body hover:bg-primary-softer hover:text-text-heading"
                  >
                    Pricing
                  </Link>
                </>
              )}

              {canManageFeatures && (
                <>
                  <Link
                    href={`/${orgSlug}/admin/roles`}
                    className="block rounded-md px-2.5 py-2.5 text-[13.5px] font-semibold text-text-body hover:bg-primary-softer hover:text-text-heading"
                  >
                    Roles
                  </Link>
                  <Link
                    href={`/${orgSlug}/admin/permissions`}
                    className="block rounded-md px-2.5 py-2.5 text-[13.5px] font-semibold text-text-body hover:bg-primary-softer hover:text-text-heading"
                  >
                    Permissions
                  </Link>
                  <Link
                    href={`/${orgSlug}/admin/components`}
                    className="block rounded-md px-2.5 py-2.5 text-[13.5px] font-semibold text-text-body hover:bg-primary-softer hover:text-text-heading"
                  >
                    Component Types
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
