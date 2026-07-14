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
 * Security constraint: this component ONLY renders information about org X
 * (the session org). It receives no information about org Y and cannot expose
 * or confirm anything about the visited org.
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
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 dark:bg-zinc-950">
      <main className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {title}
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{message}</p>

        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={handleLogout}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {logoutLabel}
          </button>

          <button
            onClick={handleGoToDashboard}
            className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {dashboardLabel}
          </button>
        </div>

      </main>
    </div>
  );
}
