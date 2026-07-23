"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { toAuthEmail } from "@/lib/auth-utils";

interface LoginFormProps {
  orgSlug: string;
}

/**
 * Client Component login form for a specific org.
 *
 * Stage 10 (Task 1.4): rebuilt to match login-page.html mockup.
 * - "User ID" label (was "Username"); same autocomplete="username" attribute.
 * - Icon-prefixed inputs (person icon for user ID, lock icon for password).
 * - Password reveal toggle: type toggles "password"↔"text", aria-label
 *   updates "Show password"↔"Hide password".
 * - Remember-me checkbox: present, checked by default. Visual-only this batch
 *   (the authClient.signIn.email call does not yet wire rememberMe to cookie
 *   duration — TODO: pass rememberMe when that behavior is required).
 * - Submit button with arrow icon.
 *
 * Post-login navigation uses a hard redirect (window.location.href) rather than
 * router.push() — same rationale as before (forces full server render so the
 * org-shell layout re-runs getSession() and shows the nav chrome immediately).
 */
export function LoginForm({ orgSlug }: LoginFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Remember-me is UI-only this batch; default checked per mockup.
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { error: signInError } = await authClient.signIn.email({
        email: toAuthEmail(username, orgSlug),
        password,
      });

      if (signInError) {
        setError(signInError.message ?? "Sign in failed. Check your credentials.");
      } else {
        // Hard redirect so the [orgSlug] layout re-renders server-side with the
        // new session cookie, making the nav chrome appear immediately.
        window.location.href = `/${orgSlug}/dashboard`;
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

      {/* ── Remember me + Forgot password ── */}
      <div className="-mt-1 flex items-center justify-between text-[12.5px]">
        <label className="flex cursor-pointer select-none items-center gap-2 font-semibold text-text-muted">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="h-[15px] w-[15px] accent-primary"
          />
          Remember me
        </label>
        <a
          href="#"
          className="font-bold text-primary-dark hover:underline"
          tabIndex={-1}
        >
          Forgot password?
        </a>
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
        disabled={loading}
        className="flex items-center justify-center gap-2 rounded-sm bg-primary px-4 py-[13px] text-sm font-bold text-text-on-primary transition-colors hover:bg-primary-dark disabled:opacity-50"
      >
        {loading ? (
          "Signing in…"
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
        <a href="#" className="font-bold text-primary-dark hover:underline">
          Contact here
        </a>
      </p>
    </form>
  );
}
