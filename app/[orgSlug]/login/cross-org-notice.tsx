"use client";

import { authClient } from "@/lib/auth-client";

interface CrossOrgNoticeProps {
  /** Slug of the org the visitor is currently signed in to (org X). */
  sessionOrgSlug: string;
  /** Pre-translated notice title (from login.crossOrgTitle). */
  title: string;
  /** Pre-translated notice message, with {sessionOrgName} already interpolated. */
  message: string;
  /** Pre-translated logout button label, with {sessionOrgName} already interpolated. */
  logoutLabel: string;
  /** Pre-translated dashboard button label. */
  dashboardLabel: string;
}

/**
 * Shown when an authenticated user (signed in to org X) lands on a different
 * org's login page (org Y).
 *
 * Stage 10 (Task 1.4): restyled with Sage Ease tokens. Component no longer
 * owns its own full-page wrapper — the parent page.tsx provides the two-panel
 * layout; this component renders only the right-panel card content.
 *
 * Security constraint: unchanged. This component ONLY renders information about
 * org X (the session org). It receives no information about org Y and cannot
 * expose or confirm anything about the visited org.
 *
 * Props are pre-translated on the server so no NextIntlClientProvider is
 * required on the login route.
 */
export function CrossOrgNotice({
  sessionOrgSlug,
  title,
  message,
  logoutLabel,
  dashboardLabel,
}: CrossOrgNoticeProps) {
  async function handleLogout() {
    await authClient.signOut();
    // Reload the current page (org Y's login) — the session is now cleared,
    // so the login form will render. We do NOT navigate away; the user is
    // already on the page they want to sign in to.
    window.location.reload();
  }

  function handleGoToDashboard() {
    window.location.href = `/${sessionOrgSlug}/dashboard`;
  }

  return (
    <div>
      <h2 className="mb-3 text-[22px] font-extrabold tracking-tight text-text-heading">
        {title}
      </h2>
      <p className="mb-7 text-[13.5px] leading-relaxed text-text-muted">{message}</p>

      <div className="flex flex-col gap-3">
        {/* Primary: logout and stay on this org's login page */}
        <button
          onClick={handleLogout}
          className="flex w-full items-center justify-center rounded-sm bg-primary px-4 py-[13px] text-sm font-bold text-text-on-primary transition-colors hover:bg-primary-dark"
        >
          {logoutLabel}
        </button>

        {/* Secondary: go to the session org's dashboard */}
        <button
          onClick={handleGoToDashboard}
          className="flex w-full items-center justify-center rounded-sm border border-border bg-bg-white px-4 py-[13px] text-sm font-bold text-text-body transition-colors hover:bg-primary-softer hover:text-text-heading"
        >
          {dashboardLabel}
        </button>
      </div>
    </div>
  );
}
