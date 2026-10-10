"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { authClient } from "@/lib/auth-client";
import { toAuthEmail } from "@/lib/auth-utils";
import { ORG_SUSPENDED_CODE, ORG_SUSPENDED_MESSAGE } from "@/lib/org-suspended";
import { useOrgHref } from "@/lib/useOrgHref";
import { deviceLabel, timeAgo } from "@/lib/session-display";
// Import order matters for CSS modules: shared brand styles first, so the form's
// own module can refine them.
import brand from "@/components/brand/brand.module.css";
import s from "./login-form.module.css";

// Hotfix 2026-10-02 (single-session-confirm): when on, a successful sign-in on an
// account that already has another active session asks before logging that one
// out. Build-time flag, set per Vercel environment (Production on, Preview off).
const SINGLE_SESSION_CONFIRM =
  process.env.NEXT_PUBLIC_SINGLE_SESSION_CONFIRM === "true";

interface LoginFormProps {
  orgSlug: string;
  /** True while the password field is focused AND masked (drives the scene's privacy glass). */
  onPasswordFocusChange?: (active: boolean) => void;
  /** True while the sign-in request is in flight (drives the scene's panes sliding together). */
  onSubmittingChange?: (submitting: boolean) => void;
  /** Opens the support popup, which lives in the page shell (the footer opens it too). */
  onOpenContact: () => void;
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
 *   password aren't required yet; "Contact here" opens a support popup
 *   with a phone number and email instead of a dead "#" link.
 *
 * Stage 28 B1: restyled to login-page-poc.html (CSS modules). Auth behaviour is
 * unchanged. New: the browser's native `required` bubble is replaced by inline
 * field errors (`noValidate` + a client-side empty check that returns before any
 * network call), and two callbacks tell the page's scene about password focus /
 * submitting. The support popup moved up to the page shell so the footer's
 * "Support" button can open the same one.
 *
 * Post-login navigation uses a hard redirect (window.location.href) rather than
 * router.push() — same rationale as before (forces full server render so the
 * org-shell layout re-runs getSession() and shows the nav chrome immediately).
 * There is deliberately no success screen or delay before that redirect.
 */
export function LoginForm({
  orgSlug,
  onPasswordFocusChange,
  onSubmittingChange,
  onOpenContact,
}: LoginFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [userIdMissing, setUserIdMissing] = useState(false);
  const [passwordMissing, setPasswordMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Seconds left before sign-in is allowed again after a 429; 0 = not rate-limited.
  const [cooldown, setCooldown] = useState(0);
  // Set once sign-in succeeded but the account has another active session.
  const [otherSession, setOtherSession] = useState<{
    device: string;
    lastActive: string;
  } | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const userIdRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
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

  // Keep the page's scene in sync: privacy glass while the (masked) password
  // field has focus, panes sliding together while a sign-in is in flight.
  useEffect(() => {
    onPasswordFocusChange?.(passwordFocused && !showPassword);
  }, [passwordFocused, showPassword, onPasswordFocusChange]);
  useEffect(() => {
    onSubmittingChange?.(loading);
  }, [loading, onSubmittingChange]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Enter in an input submits the form even while the button is disabled.
    if (cooldown > 0) return;

    // Drop any stale server error so it can't sit beside a new inline one.
    setError(null);

    // Empty fields: inline error + focus the first bad one, no network call.
    const userMissing = username.trim().length === 0;
    const pwMissing = password.length === 0;
    setUserIdMissing(userMissing);
    setPasswordMissing(pwMissing);
    if (userMissing) {
      userIdRef.current?.focus();
      return;
    }
    if (pwMissing) {
      passwordRef.current?.focus();
      return;
    }

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
        } else if (signInError.code === ORG_SUSPENDED_CODE) {
          // Stage 29 (S29-9): reachable inside the proxy's 60 s cache window after a suspension.
          setError(ORG_SUSPENDED_MESSAGE);
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
    <form onSubmit={handleSubmit} noValidate>
      {/* ── User ID ── */}
      <div className={`${s.field} ${userIdMissing ? s.hasError : ""}`}>
        <label htmlFor="userId" className={s.label}>
          User ID
        </label>
        <div className={s.inputWrap}>
          {/* Person icon */}
          <svg
            className={s.iconLeft}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
          <input
            ref={userIdRef}
            id="userId"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setUserIdMissing(false);
            }}
            placeholder="Enter your user ID"
            aria-invalid={userIdMissing || undefined}
            aria-describedby={userIdMissing ? "userId-error" : undefined}
            className={s.input}
          />
        </div>
        {userIdMissing && (
          <div id="userId-error" className={s.fieldError} aria-live="polite">
            Enter your user ID.
          </div>
        )}
      </div>

      {/* ── Password ── */}
      <div className={`${s.field} ${passwordMissing ? s.hasError : ""}`}>
        <label htmlFor="password" className={s.label}>
          Password
        </label>
        <div className={s.inputWrap}>
          {/* Lock icon */}
          <svg
            className={s.iconLeft}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <input
            ref={passwordRef}
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordMissing(false);
            }}
            onFocus={() => setPasswordFocused(true)}
            onBlur={() => setPasswordFocused(false)}
            placeholder="Enter your password"
            aria-invalid={passwordMissing || undefined}
            aria-describedby={passwordMissing ? "password-error" : undefined}
            className={`${s.input} ${s.inputPw}`}
          />
          {/* Password reveal toggle */}
          <button
            type="button"
            // Keep focus in the field so the privacy glass state stays honest.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setShowPassword((v) => !v);
              passwordRef.current?.focus();
            }}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className={s.pwToggle}
          >
            {showPassword ? (
              /* Eye-off (hide) icon */
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                <path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                <path d="m2 2 20 20" />
              </svg>
            ) : (
              /* Eye (show) icon */
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
        {passwordMissing && (
          <div id="password-error" className={s.fieldError} aria-live="polite">
            Enter your password.
          </div>
        )}
      </div>

      {/* ── Server error / rate limit ── */}
      {error && (
        <p className={s.formError} role="alert">
          {error}
        </p>
      )}

      {/* ── Submit ── */}
      <button
        type="submit"
        disabled={loading || cooldown > 0}
        className={`${brand.btn} ${brand.btnPrimary} ${brand.btnBlock} ${s.submit}`}
      >
        {loading ? (
          <>
            <span className={s.spinner} aria-hidden="true" />
            <span className={s.num}>Signing in…</span>
          </>
        ) : cooldown > 0 ? (
          // One string, not a number in its own element: the button is flex with
          // a gap, which would split "7" and "s" apart.
          <span className={s.num}>{`Try again in ${cooldown}s`}</span>
        ) : (
          <>
            <span className={s.num}>Sign in</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </>
        )}
      </button>

      {/* ── Footnote ── */}
      <p className={s.footnote}>
        Need access?{" "}
        <button type="button" onClick={onOpenContact} className={s.footnoteBtn}>
          Contact here
        </button>
      </p>

      {/* ── Another session is active (single-session-confirm) ──
          No backdrop/Escape dismissal: closing without choosing would leave this
          new session signed in alongside the other one.
          Portaled to <body>: the form sits in a `.authCol > *` element that runs a
          transform animation (fill-mode both), which makes it the containing block
          for position:fixed, so rendered in place the scrim covered only the form
          card (Stage 30 Batch 6). */}
      {otherSession && createPortal(
        <div className={s.scrim} data-testid="modal-scrim">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="other-session-title"
            className={s.modal}
          >
            <h2 id="other-session-title" className={s.modalTitle}>
              Log out the other session?
            </h2>
            <p className={s.modalText}>
              This account is already signed in somewhere else. Only one session
              can be active at a time.
            </p>
            <dl className={s.session}>
              <dt>Device</dt>
              <dd>{otherSession.device}</dd>
              <dt>Last active</dt>
              <dd>{otherSession.lastActive}</dd>
            </dl>
            {dialogError && (
              <p className={s.modalError} role="alert">
                {dialogError}
              </p>
            )}
            <div className={s.modalActions}>
              <button
                type="button"
                onClick={cancelSecondLogin}
                disabled={dialogBusy}
                className={`${brand.btn} ${brand.btnOutline} ${s.modalBtn}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={logOutOtherSessions}
                disabled={dialogBusy}
                className={`${brand.btn} ${brand.btnPrimary} ${s.modalBtn}`}
              >
                Log out other session
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </form>
  );
}
