"use client";

import { useCallback, useId, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import type { SupportedCurrency } from "@/lib/currency";
import type { EstimateType } from "@/lib/quick-estimate/palette";
import { AccountPopup } from "./account-popup";
import { QuickEstimatePopup } from "./quick-estimate/quick-estimate-popup";
import { clearStoredEstimate, useEstimateState } from "./quick-estimate/use-estimate-state";

interface TopBarActionsProps {
  orgSlug: string;
  /** Forwarded from the server layout — true when the request arrived via an
   * org subdomain (e.g. acme.easeetool.com).  Eliminates the client-side
   * window.location.hostname read and the resulting SSR/hydration mismatch. */
  isSubdomain: boolean;
  /** Display name (me.name) — used for the avatar initial only. */
  name: string;
  /** Login username — shown bold in the profile dropdown (D2 Stage 15). */
  username: string;
  /** The user's role display name (e.g. "Admin", "Company Member"). */
  roleName: string;
  /** Organization display name — rendered as the org chip (D4 Stage 15). */
  orgName: string;
  /** External company display name — rendered as the company chip when present (D4 Stage 15). */
  externalCompanyName: string | null;
  /** Own editable profile fields, for the My Account popup (Hotfix 2026-10-10). */
  firstName: string;
  lastName: string;
  mobile: string | null;
  profileEmail: string | null;
  /** Quick Estimate (Stage 33): false -> the calculator icon renders disabled with a tooltip. */
  estimateEnabled: boolean;
  /** The usable component types, already trimmed by the layout (S33-3). */
  estimateTypes: EstimateType[];
  /** The external company default currency; null for internal users (the popup then defaults to INR). */
  estimateDefaultCurrency: SupportedCurrency | null;
}

/**
 * Top bar right-corner icon group (Client Component): Quick Estimate + Home + Profile.
 *
 * Matches quotation-system-docs/ui-mockups/finalized/project-details-page's
 * .eq-topbar — a Home icon-button plus a Profile icon-button that opens a
 * dropdown (avatar initial, username, role name, My Profile, Log Out). "My Profile"
 * opens the My Account popup (<AccountPopup>) on its Details tab; the Password tab
 * is reached from inside the popup (Hotfix 2026-10-10).
 *
 * Log Out reuses the same hard-navigation pattern as the prior
 * dashboard/logout-button.tsx (window.location.href, not router.push) so the
 * router cache doesn't restore a stale authenticated view on browser Back.
 *
 * Stage 33: the calculator icon opens the Quick Estimate popup. The draft state lives here (this component
 * persists across client navigation) and is mirrored to sessionStorage; Log Out removes it.
 */
export function TopBarActions({
  orgSlug,
  isSubdomain,
  name,
  username,
  roleName,
  orgName,
  externalCompanyName,
  firstName,
  lastName,
  mobile,
  profileEmail,
  estimateEnabled,
  estimateTypes,
  estimateDefaultCurrency,
}: TopBarActionsProps) {
  const t = useTranslations("account");
  const qe = useTranslations("quickEstimate");
  const estimate = useEstimateState(orgSlug, estimateEnabled, estimateTypes, estimateDefaultCurrency ?? "INR");
  const [estimateOpen, setEstimateOpen] = useState(false);
  const estimateBtnRef = useRef<HTMLButtonElement>(null);
  const estimateTipId = useId();
  const closeEstimate = useCallback(() => {
    setEstimateOpen(false);
    estimateBtnRef.current?.focus();
  }, []);
  const [menuOpen, setMenuOpen] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const profileBtnRef = useRef<HTMLButtonElement>(null);
  const closePopup = useCallback(() => {
    setPopupOpen(false);
    profileBtnRef.current?.focus();
  }, []);
  function openPopup() {
    setMenuOpen(false);
    setPopupOpen(true);
  }
  // Build org-scoped hrefs using the server-computed isSubdomain flag.
  const href = (subpath: string) =>
    isSubdomain ? subpath : `/${orgSlug}${subpath}`;

  async function handleLogout() {
    // Stage 33 (S33-8): the next user on a shared machine starts with an empty estimate.
    clearStoredEstimate(orgSlug);
    await authClient.signOut();
    window.location.href = href("/login");
  }

  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="flex items-center gap-2">
      {/* Org chip — moved from header left to right corner (D4 Stage 15) */}
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
        {orgName}
      </div>
      {/* External company chip — only when the user is linked to a company (D4 Stage 15) */}
      {externalCompanyName && (
        <div className="flex items-center gap-[7px] rounded-full bg-status-shipped-bg px-3 py-[5px] text-[11.5px] font-bold text-status-shipped-text">
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
            <rect x="2" y="7" width="20" height="14" rx="2" />
            <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
            <line x1="12" y1="12" x2="12" y2="16" />
            <line x1="10" y1="14" x2="14" y2="14" />
          </svg>
          {externalCompanyName}
        </div>
      )}
      {/* Quick Estimate (Stage 33): enabled state, on state while open, draft dot, or a disabled icon with a tooltip */}
      <div className="group relative ml-2">
        <button
          ref={estimateBtnRef}
          type="button"
          onClick={() => {
            if (estimateEnabled) setEstimateOpen((v) => !v);
          }}
          title={estimateEnabled ? (estimate.hasDraft && !estimateOpen ? qe("iconTitleDraft") : qe("iconTitle")) : undefined}
          aria-label={qe("iconTitle")}
          aria-haspopup="dialog"
          aria-expanded={estimateEnabled ? estimateOpen : undefined}
          aria-disabled={estimateEnabled ? undefined : true}
          aria-describedby={estimateEnabled ? undefined : estimateTipId}
          className={`relative flex h-9 w-9 items-center justify-center rounded-sm border transition-colors ${
            !estimateEnabled
              ? "cursor-not-allowed border-border bg-bg-card text-text-placeholder"
              : estimateOpen
                ? "border-primary bg-primary text-text-on-primary"
                : "border-border bg-bg-white text-text-body hover:bg-primary-softer"
          }`}
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
            <rect x="5" y="2.5" width="14" height="19" rx="2" />
            <rect x="8" y="5.5" width="8" height="4" rx=".5" />
            <path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01" />
          </svg>
          {estimateEnabled && estimate.hasDraft && !estimateOpen && (
            <span
              data-testid="qe-draft-dot"
              className="absolute -right-[3px] -top-[3px] h-2.5 w-2.5 rounded-full border-2 border-bg-card bg-primary"
              aria-hidden="true"
            />
          )}
        </button>
        {!estimateEnabled && (
          <span
            id={estimateTipId}
            role="tooltip"
            className="pointer-events-none invisible absolute right-[-8px] top-12 z-50 w-60 rounded-sm bg-text-heading px-[11px] py-[9px] text-left text-xs font-semibold leading-[1.45] text-white opacity-0 transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
          >
            {qe("disabledTip")}
          </span>
        )}
      </div>
      <Link
        href={href("/dashboard")}
        title={t("homeTitle")}
        aria-label={t("homeTitle")}
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
          ref={profileBtnRef}
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          title={t("profileButtonTitle")}
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
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute right-0 top-11 z-50 w-64 rounded-md border border-border bg-bg-white p-3 shadow-card">
              <div className="flex items-center gap-3 px-1 py-1">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-extrabold text-text-on-primary">
                  {initial}
                </div>
                <div className="min-w-0">
                  {/* D2 Stage 15: show username (login handle) bold, role beneath */}
                  <div className="truncate text-[13.5px] font-extrabold text-text-heading">
                    {username}
                  </div>
                  <div className="truncate text-[11.5px] text-text-muted">{roleName}</div>
                </div>
              </div>

              <div className="my-2 h-px bg-border" />

              <button
                type="button"
                onClick={() => openPopup()}
                className="block w-full rounded-sm px-2 py-1.5 text-left text-sm text-text-body hover:bg-primary-softer"
              >
                {t("menuMyProfile")}
              </button>

              <div className="my-2 h-px bg-border" />

              <button
                type="button"
                onClick={handleLogout}
                className="block w-full rounded-sm px-2 py-1.5 text-left text-sm font-semibold text-red-600 hover:bg-primary-softer"
              >
                {t("menuLogOut")}
              </button>
            </div>
          </>
        )}
      </div>

      {estimateOpen && estimateEnabled && (
        <QuickEstimatePopup
          orgName={orgName}
          types={estimateTypes}
          state={estimate}
          onClose={closeEstimate}
        />
      )}

      {popupOpen && (
        <AccountPopup
          orgSlug={orgSlug}
          onClose={closePopup}
          name={name}
          username={username}
          roleName={roleName}
          orgName={orgName}
          firstName={firstName}
          lastName={lastName}
          mobile={mobile}
          profileEmail={profileEmail}
        />
      )}
    </div>
  );
}
