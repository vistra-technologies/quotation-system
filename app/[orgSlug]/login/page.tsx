import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getOrgBySlug, getOrgById } from "@/lib/data/admin";
import { CrossOrgNotice } from "./cross-org-notice";
import { LoginForm } from "./login-form";

// Always render live — reads DB for org name and session state.
export const dynamic = "force-dynamic";

/**
 * Per-org login page (Server Component shell).
 *
 * Stage 10 (Task 1.4): full UI rebuild to match login-page.html mockup.
 * Two-panel layout: left brand panel (static, server-rendered) + right form panel.
 *
 * orgSlug comes from the dynamic route segment — no header read required.
 * The proxy already returns 404 for unknown slugs before this page renders,
 * so the DB check below is a defensive last-resort guard only.
 *
 * Auth checks (Stage 4, unchanged):
 *
 *   1. Same-org: getSession() returns a session when x-org-id matches the
 *      session's organizationId.  If a session is present, the visitor is
 *      already signed in to THIS org — redirect to their dashboard immediately.
 *
 *   2. Cross-org: getSession() returns null because the cross-org guard in
 *      lib/session.ts rejects it (x-org-id ≠ session.organizationId).  To
 *      detect "there IS a session, just for a different org", we call
 *      auth.api.getSession directly — bypassing the org guard — and show a
 *      notice naming the SESSION'S org only.
 *
 * Security invariant: the notice ONLY names org X (the session org).  We
 * never expose, confirm, or deny anything about org Y (the URL's org).  The
 * org name is always read from rawSession.user.organizationId, never from the
 * orgSlug URL parameter.
 */
export default async function LoginPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const org = await getOrgBySlug(orgSlug);

  if (!org) {
    // Defensive guard — proxy should have returned 404 before reaching here.
    redirect("/");
  }

  // ── Auth check 1: same-org ────────────────────────────────────────────────
  const session = await getSession();
  if (session) {
    redirect(`/${orgSlug}/dashboard`);
  }

  // ── Auth check 2: cross-org ───────────────────────────────────────────────
  const rawSession = await auth.api.getSession({ headers: await headers() });

  // Determine right-panel content based on session state
  let rightPanelContent: React.ReactNode;

  if (rawSession?.session) {
    // Cast through any: TypeScript may not resolve better-auth's additionalFields
    // generic fully (same reason lib/session.ts uses `const u = user as any`).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawUser = rawSession.user as any;
    const sessionOrg = await getOrgById(rawUser.organizationId as string);

    const t = await getTranslations("login");
    const sessionOrgName = sessionOrg?.name ?? "your organization";
    const sessionOrgSlug = sessionOrg?.slug ?? "";

    rightPanelContent = (
      <CrossOrgNotice
        sessionOrgSlug={sessionOrgSlug}
        title={t("crossOrgTitle")}
        message={t("crossOrgMessage", { sessionOrgName })}
        logoutLabel={t("crossOrgLogout", { sessionOrgName })}
        dashboardLabel={t("crossOrgDashboard")}
      />
    );
  } else {
    rightPanelContent = (
      <>
        <p className="mb-[30px] text-[13.5px] text-text-muted">
          Sign in to continue to your account
        </p>
        <LoginForm orgSlug={orgSlug} />
      </>
    );
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* ── Left brand panel ── */}
      <div className="relative flex flex-1 flex-col justify-center overflow-hidden bg-primary-softer px-8 py-11 md:max-w-[640px] md:px-[72px] md:py-16">
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

        {/* Large decorative partition-grid SVG (bottom-right) */}
        <div
          className="pointer-events-none absolute bottom-[-12%] right-[-10%] z-0 w-[58%] opacity-[0.14]"
          aria-hidden="true"
        >
          <svg viewBox="0 0 480 480" fill="none" className="h-full w-full">
            <rect
              x="40"
              y="40"
              width="400"
              height="400"
              rx="24"
              stroke="#3E6647"
              strokeWidth="2.5"
            />
            <path d="M240 40v165" stroke="#3E6647" strokeWidth="2.5" />
            <path d="M240 275v165" stroke="#3E6647" strokeWidth="2.5" />
          </svg>
        </div>

        {/* Brand mark */}
        <div
          className="relative z-10 mb-7 flex h-14 w-14 items-center justify-center rounded-md bg-primary"
          style={{ boxShadow: "0 10px 24px -10px rgba(62, 102, 71, 0.55)" }}
          aria-hidden="true"
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
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

        {/* Heading */}
        <h1
          className="relative z-10 mb-4 max-w-[15ch] text-[34px] font-extrabold leading-[1.15] tracking-[-0.02em] text-text-heading md:text-[34px]"
          style={{ fontSize: "clamp(26px, 4vw, 34px)" }}
        >
          EaseeTool
        </h1>

        {/* Tagline */}
        <p className="relative z-10 mb-9 max-w-[42ch] text-[15px] leading-[1.65] text-text-muted">
          From a rough floor idea to a priced quotation and a placed order —
          design partitions, optimize materials, and self-serve the entire
          journey within your organization&apos;s own space.
        </p>

        {/* Feature checklist */}
        <ul className="relative z-10 flex flex-col gap-[13px]">
          {[
            "Design partitions visually, room by room",
            "Auto-optimize material cut lists",
            "Send priced quotations in minutes",
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

        {/* Stats */}
        <div className="relative z-10 mt-[52px] flex flex-wrap gap-x-9 gap-y-4 border-t border-border pt-[22px]">
          {[
            { value: "1,200+", label: "Partitions configured" },
            { value: "40%", label: "Faster quoting" },
            { value: "3", label: "Steps to a quote" },
          ].map((stat) => (
            <div key={stat.label}>
              <b className="block text-[19px] font-extrabold tracking-[-0.01em] text-text-heading">
                {stat.value}
              </b>
              <span className="text-[10.5px] font-bold uppercase tracking-[0.04em] text-text-muted">
                {stat.label}
              </span>
            </div>
          ))}
        </div>
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

          {rightPanelContent}
        </div>
      </div>
    </div>
  );
}
