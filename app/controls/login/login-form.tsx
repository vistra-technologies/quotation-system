"use client";

import { useState } from "react";

/**
 * Client Component login form for the SuperAdmin console (/controls/login).
 *
 * Mirrors the org login-form.tsx pattern (useState, error/loading state,
 * password reveal toggle, arrow-button submit) but posts to the SuperAdmin
 * endpoint instead of better-auth's /api/auth/sign-in/email route.
 *
 * Uses window.location.href for post-login navigation (same rationale as the
 * org form: forces a full server render so the guard layout re-runs
 * requireSuperAdmin() and the new session cookie is visible).
 */
export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/v1/superadmin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        credentials: "same-origin",
      });

      if (res.ok) {
        // Hard redirect so the guard layout re-runs requireSuperAdmin() with
        // the newly-issued qs-sa-token cookie visible server-side.
        window.location.href = "/controls/orgs";
      } else {
        const data = await res.json().catch(() => ({}));
        setError(
          (data as { error?: string }).error ??
            "Sign in failed. Check your credentials.",
        );
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
      {/* ── Username ── */}
      <div>
        <label
          htmlFor="saUserId"
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
            id="saUserId"
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
          htmlFor="saPassword"
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
            id="saPassword"
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
    </form>
  );
}
