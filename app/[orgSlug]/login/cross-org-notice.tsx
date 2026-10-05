"use client";

import { authClient } from "@/lib/auth-client";
import brand from "@/components/brand/brand.module.css";
import s from "./login-form.module.css";

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
 * owns its own full-page wrapper — the page layout (login-experience.tsx)
 * provides the scene + auth column; this component renders only the notice
 * that replaces the form inside the auth column. Stage 28 B1: restyled to the
 * login-page-poc.html mockup (CSS modules); props and handlers unchanged.
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
    // Cross-org case: the current hostname belongs to *another* org's subdomain,
    // so useOrgHref(sessionOrgSlug) cannot detect subdomain mode from hostname
    // equality. Resolve the target org's correct origin directly.
    const hostname = window.location.hostname;
    if (hostname.endsWith(".test.easeetool.com")) {
      window.location.href = `https://${sessionOrgSlug}.test.easeetool.com/dashboard`;
    } else if (hostname.endsWith(".easeetool.com")) {
      window.location.href = `https://${sessionOrgSlug}.easeetool.com/dashboard`;
    } else {
      // localhost / CI / Vercel preview → path-based fallback
      window.location.href = `/${sessionOrgSlug}/dashboard`;
    }
  }

  return (
    <div className={s.notice}>
      <h2 className={s.noticeTitle}>{title}</h2>
      <p className={s.noticeMsg}>{message}</p>

      <div className={s.noticeBtns}>
        {/* Primary: logout and stay on this org's login page */}
        <button
          type="button"
          onClick={handleLogout}
          className={`${brand.btn} ${brand.btnPrimary} ${brand.btnBlock}`}
        >
          {logoutLabel}
        </button>

        {/* Secondary: go to the session org's dashboard */}
        <button
          type="button"
          onClick={handleGoToDashboard}
          className={`${brand.btn} ${brand.btnOutline} ${brand.btnBlock}`}
        >
          {dashboardLabel}
        </button>
      </div>
    </div>
  );
}
