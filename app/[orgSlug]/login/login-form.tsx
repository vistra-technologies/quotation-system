"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { toAuthEmail } from "@/lib/auth-utils";
import { useOrgHref } from "@/lib/useOrgHref";
import { deviceLabel, timeAgo } from "@/lib/session-display";

// Hotfix 2026-10-02 (single-session-confirm): when on, a successful sign-in on an
// account that already has another active session asks before logging that one
// out. Build-time flag, set per Vercel environment (Production on, Preview off).
const SINGLE_SESSION_CONFIRM =
  process.env.NEXT_PUBLIC_SINGLE_SESSION_CONFIRM === "true";

interface LoginFormProps {
  orgSlug: string;
}

// better-auth rate-limits /sign-in* at 3 requests per 10s (its default window).
// The client doesn't surface the X-Retry-After header, so the cooldown is the
// fixed window length. Hotfix 2026-10-02 (login-rate-limit-countdown).
const RATE_LIMIT_COOLDOWN_SECONDS = 10;
const RATE_LIMIT_MESSAGE = `Too many requests. Please try again after ${RATE_LIMIT_COOLDOWN_SECONDS} secs.`;

/**
 * Client Component login form for a specific org.
 *
 * Stage 10 (Task 1.4): rebuilt to match login-page.html mockup.
 * - "User ID" label (was "Username"); same autocomplete="username" attribute.
 * - Icon-prefixed inputs (person icon for user ID, lock icon for password).
 * - Password reveal toggle: type toggles "password"↔"text", aria-label
 *   updates "Show password"↔"Hide password".
 * - Submit button with arrow icon.
 * - Remember-me / forgot-password row and the "Contact here" link are hidden/
 *   repurposed per direct human request (2026-07-23): remember-me + forgot-
 *   password aren't required yet; "Contact here" now opens a support popup
 *   with a phone number and email instead of a dead "#" link.
 *
 * Post-login navigation uses a hard redirect (window.location.href) rather than
 * router.push() — same rationale as before (forces full server render so the
 * org-shell layout re-runs getSession() and shows the nav chrome immediately).
 */
export function LoginForm({ orgSlug }: LoginFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showContact, setShowContact] = useState(false);
  // Seconds left before sign-in is allowed again after a 429; 0 = not rate-limited.
  const [cooldown, setCooldown] = useState(0);
  // Set once sign-in succeeded but the account has another active session.
  const [otherSession, setOtherSession] = useState<{
    device: string;
    lastActive: string;
  } | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const orgHref = useOrgHref(orgSlug);

  // Called after a successful sign-in. Fails open: any problem checking for other
  // sessions must never block a valid login.
  async function continueAfterSignIn() {
    if (SINGLE_SESSION_CONFIRM) {
      try {
        const [current, list] = await Promise.all([
          authClient.getSession(),
          authClient.listSessions(),
        ]);
        const currentId = current.data?.session.id;
        const others = (list.data ?? []).filter((s) => s.id !== currentId);
        if (currentId && others.length > 0) {
          const latest = others.reduce((a, b) =>
            new Date(a.updatedAt) > new Date(b.updatedAt) ? a : b,
          );
          setOtherSession({
            device: deviceLabel(latest.userAgent),
            lastActive: timeAgo(latest.updatedAt),
          });
          return;
        }
      } catch {
        // fall through to the normal redirect
      }
    }
    // Hard redirect so the [orgSlug] layout re-renders server-side with the
    // new session cookie, making the nav chrome appear immediately.
    // orgHref resolves to bare subpath on subdomain hosts, /{orgSlug}/... otherwise.
    window.location.href = orgHref("/dashboard");
  }

  async function logOutOtherSessions() {
    setDialogBusy(true);
    setDialogError(null);
    try {
      const { error: revokeError } = await authClient.revokeOtherSessions();
      if (revokeError) {
        setDialogError("Couldn't log out the other session. Please try again.");
        return;
      }
      window.location.href = orgHref("/dashboard");
    } catch {
      setDialogError("Couldn't log out the other session. Please try again.");
    } finally {
      setDialogBusy(false);
    }
  }

  // Cancel: sign this new session back out; the other user is left untouched.
  async function cancelSecondLogin() {
    setDialogBusy(true);
    try {
      await authClient.signOut();
    } finally {
      setDialogBusy(false);
      setDialogError(null);
      setOtherSession(null);
    }
  }

  // Tick the cooldown down once a second; clear the rate-limit error at 0.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => {
      setCooldown(cooldown - 1);
      if (cooldown === 1) setError(null);
    }, 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Enter in an input submits the form even while the button is disabled.
    if (cooldown > 0) return;
    setError(null);
    setLoading(true);

    try {
      const { error: signInError } = await authClient.signIn.email({
        email: toAuthEmail(username, orgSlug),
        password,
      });

      if (signInError) {
        if (signInError.status === 429) {
          setError(RATE_LIMIT_MESSAGE);
          setCooldown(RATE_LIMIT_COOLDOWN_SECONDS);
        } else {
          setError(signInError.message ?? "Sign in failed. Check your credentials.");
        }
      } else {
        await continueAfterSignIn();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
      {/* ── User ID ── */}
      <div>
        <label
          htmlFor="userId"
          className="mb-1.5 block text-sm font-semibold text-text-heading"
        >
          User ID
        </label>
        <div className="relative flex items-center">
          {/* Person icon */}
          <svg
            className="pointer-events-none absolute left-[14px] h-4 w-4 text-text-placeholder"
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
          <input
            id="userId"
            type="text"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter your user ID"
            className="w-full rounded-sm border border-border bg-bg-white py-[13px] pl-[42px] pr-[14px] text-sm text-text-body placeholder:text-text-placeholder transition-[border-color,box-shadow] duration-150 focus:border-primary focus:outline-none focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
          />
        </div>
      </div>

      {/* ── Password ── */}
      <div>
        <label
          htmlFor="password"
          className="mb-1.5 block text-sm font-semibold text-text-heading"
        >
          Password
        </label>
        <div className="relative flex items-center">
          {/* Lock icon */}
          <svg
            className="pointer-events-none absolute left-[14px] h-4 w-4 text-text-placeholder"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="5" y="10" width="14" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 018 0v3" />
          </svg>
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            className="w-full rounded-sm border border-border bg-bg-white py-[13px] pl-[42px] pr-[42px] text-sm text-text-body placeholder:text-text-placeholder transition-[border-color,box-shadow] duration-150 focus:border-primary focus:outline-none focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]"
          />
          {/* Password reveal toggle */}
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-[6px] flex h-8 w-8 items-center justify-center rounded-sm border-none bg-transparent text-text-placeholder transition-colors hover:bg-primary-softer hover:text-text-heading"
          >
            {showPassword ? (
              /* Eye-off (hide) icon */
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              /* Eye (show) icon */
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <p className="-mt-1 text-sm text-red-500" role="alert">
          {error}
        </p>
      )}

      {/* ── Submit ── */}
      <button
        type="submit"
        disabled={loading || cooldown > 0}
        className="flex items-center justify-center gap-2 rounded-sm bg-primary px-4 py-[13px] text-sm font-bold text-text-on-primary transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? (
          "Signing in…"
        ) : cooldown > 0 ? (
          // One string, not a number in its own element: the button is flex with
          // gap-2, which would split "7" and "s" apart.
          `Try again in ${cooldown}s`
        ) : (
          <>
            Sign in
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </>
        )}
      </button>

      {/* ── Footnote ── */}
      <p className="mt-[8px] text-center text-[12.5px] text-text-muted">
        Need access?{" "}
        <button
          type="button"
          onClick={() => setShowContact(true)}
          className="font-bold text-primary-dark hover:underline"
        >
          Contact here
        </button>
      </p>

      {/* ── Support contact popup ── */}
      {showContact && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowContact(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-popup-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-md bg-bg-white p-6 shadow-card"
          >
            <div className="flex items-start justify-between">
              <h2
                id="contact-popup-title"
                className="text-base font-semibold text-text-heading"
              >
                Contact support
              </h2>
              <button
                type="button"
                onClick={() => setShowContact(false)}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-sm text-text-muted hover:bg-primary-softer hover:text-text-heading"
              >
                ✕
              </button>
            </div>
            <div className="mt-4 flex flex-col gap-2 text-sm text-text-body">
              <a
                href="tel:+918149007006"
                className="font-semibold text-primary-dark hover:underline"
              >
                +91 8149007006
              </a>
              <a
                href="mailto:support@easeetool.com"
                className="font-semibold text-primary-dark hover:underline"
              >
                support@easeetool.com
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ── Another session is active (single-session-confirm) ──
          No backdrop/Escape dismissal: closing without choosing would leave this
          new session signed in alongside the other one. */}
      {otherSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="other-session-title"
            className="w-full max-w-sm rounded-md bg-bg-white p-6 shadow-card"
          >
            <h2
              id="other-session-title"
              className="text-base font-semibold text-text-heading"
            >
              Log out the other session?
            </h2>
            <p className="mt-2 text-sm text-text-body">
              This account is already signed in somewhere else. Only one session
              can be active at a time.
            </p>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-sm bg-primary-softer px-3.5 py-3 text-sm">
              <dt className="text-text-muted">Device</dt>
              <dd className="font-semibold text-text-heading">
                {otherSession.device}
              </dd>
              <dt className="text-text-muted">Last active</dt>
              <dd className="font-semibold text-text-heading">
                {otherSession.lastActive}
              </dd>
            </dl>
            {dialogError && (
              <p className="mt-3 text-sm text-red-500" role="alert">
                {dialogError}
              </p>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2.5">
              <button
                type="button"
                onClick={cancelSecondLogin}
                disabled={dialogBusy}
                className="rounded-sm border border-border px-4 py-3 text-sm font-bold text-text-heading transition-colors hover:bg-primary-softer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={logOutOtherSessions}
                disabled={dialogBusy}
                className="rounded-sm bg-primary px-4 py-3 text-sm font-bold text-text-on-primary transition-colors hover:bg-primary-dark disabled:opacity-50"
              >
                Log out other session
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
