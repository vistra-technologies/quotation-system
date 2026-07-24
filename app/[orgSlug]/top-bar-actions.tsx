"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

interface TopBarActionsProps {
  orgSlug: string;
  name: string;
  username: string;
}

/**
 * Top bar right-corner icon group (Client Component): Home + Profile.
 *
 * Matches quotation-system-docs/ui-mockups/finalized/project-details-page's
 * .eq-topbar — a Home icon-button plus a Profile icon-button that opens a
 * dropdown (avatar initial, name, username, My Profile / Change Password
 * placeholders, Log Out). "My Profile" and "Change Password" have no page
 * yet, so they show an inline "Coming soon" note instead of navigating.
 *
 * Log Out reuses the same hard-navigation pattern as the prior
 * dashboard/logout-button.tsx (window.location.href, not router.push) so the
 * router cache doesn't restore a stale authenticated view on browser Back.
 */
export function TopBarActions({ orgSlug, name, username }: TopBarActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [comingSoon, setComingSoon] = useState<string | null>(null);

  async function handleLogout() {
    await authClient.signOut();
    window.location.href = `/${orgSlug}/login`;
  }

  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="flex items-center gap-2">
      <Link
        href={`/${orgSlug}/dashboard`}
        title="Home"
        aria-label="Home"
        className="flex h-9 w-9 items-center justify-center rounded-sm border border-border bg-bg-white text-text-body transition-colors hover:bg-primary-softer"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9" />
        </svg>
      </Link>

      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          title="Profile"
          aria-haspopup="true"
          aria-expanded={menuOpen}
          className="flex h-9 w-9 items-center justify-center rounded-sm border border-border bg-bg-white text-text-body transition-colors hover:bg-primary-softer"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
        </button>

        {menuOpen && (
          <>
            {/* Backdrop to close on outside click */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => {
                setMenuOpen(false);
                setComingSoon(null);
              }}
            />
            <div className="absolute right-0 top-11 z-50 w-64 rounded-md border border-border bg-bg-white p-3 shadow-card">
              <div className="flex items-center gap-3 px-1 py-1">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-extrabold text-text-on-primary">
                  {initial}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-extrabold text-text-heading">
                    {name}
                  </div>
                  <div className="truncate text-[11.5px] text-text-muted">{username}</div>
                </div>
              </div>

              <div className="my-2 h-px bg-border" />

              <button
                type="button"
                onClick={() => setComingSoon("profile")}
                className="block w-full rounded-sm px-2 py-1.5 text-left text-sm text-text-body hover:bg-primary-softer"
              >
                My Profile
              </button>
              <button
                type="button"
                onClick={() => setComingSoon("password")}
                className="block w-full rounded-sm px-2 py-1.5 text-left text-sm text-text-body hover:bg-primary-softer"
              >
                Change Password
              </button>
              {comingSoon && (
                <p className="px-2 pb-1 text-xs text-text-muted">Coming soon</p>
              )}

              <div className="my-2 h-px bg-border" />

              <button
                type="button"
                onClick={handleLogout}
                className="block w-full rounded-sm px-2 py-1.5 text-left text-sm font-semibold text-red-600 hover:bg-primary-softer"
              >
                Log Out
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
