import { redirect } from "next/navigation";
import {
  requireSuperAdmin,
  SuperAdminUnauthorizedError,
} from "@/lib/superadmin-guard";
import { LoginForm } from "./login-form";

// Always render live — reads the SuperAdminSession table to check current auth.
export const dynamic = "force-dynamic";

/**
 * SuperAdmin login page (Server Component shell).
 *
 * Auth logic:
 *   1. If a valid qs-sa-token session exists → redirect to /controls/orgs
 *      (already authenticated; show the dashboard instead of the login form).
 *   2. If no valid session (SuperAdminUnauthorizedError thrown) → render the
 *      login form so the user can authenticate.
 *
 * Note on try/catch + redirect(): Next.js implements redirect() by throwing a
 * special REDIRECT error internally.  If requireSuperAdmin() succeeds and we
 * call redirect(), the redirect error propagates through the catch block
 * because it is NOT an instance of SuperAdminUnauthorizedError — the `throw err`
 * branch re-throws it correctly.
 */
export default async function ControlsLoginPage() {
  try {
    await requireSuperAdmin();
    // Already authenticated — go to the dashboard.
    redirect("/controls/orgs");
  } catch (err) {
    // SuperAdminUnauthorizedError = not authenticated → fall through to form.
    // Any other error (including the redirect thrown above) is re-thrown.
    if (!(err instanceof SuperAdminUnauthorizedError)) throw err;
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* ── Left brand panel ── */}
      <div className="relative flex flex-1 flex-col justify-center overflow-hidden bg-primary-softer px-8 py-11 md:max-w-[540px] md:px-[64px] md:py-16">
        {/* Dot-grid decorative background */}
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            backgroundImage:
              "radial-gradient(rgba(78, 127, 88, 0.15) 1px, transparent 1.4px)",
            backgroundSize: "22px 22px",
          }}
          aria-hidden="true"
        />

        {/* Brand mark */}
        <div
          className="relative z-10 mb-7 flex h-14 w-14 items-center justify-center rounded-md bg-primary"
          style={{ boxShadow: "0 10px 24px -10px rgba(62, 102, 71, 0.55)" }}
          aria-hidden="true"
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
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

        {/* Heading */}
        <h1
          className="relative z-10 mb-4 max-w-[18ch] text-[34px] font-extrabold leading-[1.15] tracking-[-0.02em] text-text-heading"
          style={{ fontSize: "clamp(24px, 4vw, 34px)" }}
        >
          EaseeTool Controls
        </h1>

        {/* Subtitle */}
        <p className="relative z-10 mb-9 max-w-[38ch] text-[15px] leading-[1.65] text-text-muted">
          Platform-level administration — manage organizations, roles, and
          permissions across all tenants.
        </p>

        {/* Info list */}
        <ul className="relative z-10 flex flex-col gap-[13px]">
          {[
            "View and manage all organizations",
            "Assign and audit platform roles",
            "Suspend or reactivate tenants",
          ].map((text) => (
            <li key={text} className="flex items-center gap-[11px]">
              <span className="shrink-0 text-primary-dark" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </span>
              <span className="text-[13.5px] font-semibold text-text-heading">
                {text}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex flex-1 items-center justify-center bg-bg-page px-6 py-10 md:px-10">
        <div className="w-full max-w-[360px]">
          {/* EaseeTool logo mark + wordmark */}
          <div className="mb-7 flex items-center gap-2" aria-label="EaseeTool">
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
            <span className="text-sm font-extrabold text-text-heading">
              EaseeTool
            </span>
          </div>

          <p className="mb-[30px] text-[13.5px] text-text-muted">
            Sign in with your SuperAdmin credentials
          </p>

          <LoginForm />
        </div>
      </div>
    </div>
  );
}
