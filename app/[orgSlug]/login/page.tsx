import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { CrossOrgNotice } from "./cross-org-notice";
import { LoginExperience } from "./login-experience";

// Always render live — reads DB for org name and session state.
export const dynamic = "force-dynamic";

/**
 * Per-org login page (Server Component shell).
 *
 * Stage 10 (Task 1.4): full UI rebuild to match login-page.html mockup.
 * Stage 28 B1: restyled to login-page-poc.html — the layout (animated scene +
 * auth column + footer) lives in login-experience.tsx; this shell only does the
 * data/auth work and decides form vs. cross-org notice.
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

  // Resolve this org through the public single-org lookup (GET /api/v1/orgs?slug=...).
  // The proxy returns 404 for unknown slugs before reaching here, so a missing
  // org after the API call is a defensive guard only.
  //
  // Stage 12 Batch 6: internalFetch against the public GET /api/v1/orgs endpoint (plan D6).
  // Stage 31 S31-6: the endpoint no longer lists every tenant; one targeted lookup per need.
  const orgRes = await internalFetch(`/api/v1/orgs?slug=${encodeURIComponent(orgSlug)}`);
  const org = orgRes.ok
    ? ((await orgRes.json()) as { org: { id: string; slug: string; name: string } }).org
    : null;
  if (!org) {
    // Defensive guard — proxy should have returned 404 before reaching here.
    redirect("/");
  }

  // ── Auth check 1: same-org ────────────────────────────────────────────────
  const session = await getSession();
  if (session) {
    redirect(await orgHref(orgSlug, "/dashboard"));
  }

  // ── Auth check 2: cross-org ───────────────────────────────────────────────
  const rawSession = await auth.api.getSession({ headers: await headers() });

  // Cross-org: swap the form for the notice (the scene + logo stay).
  let notice: React.ReactNode;

  if (rawSession?.session) {
    // Cast through any: TypeScript may not resolve better-auth's additionalFields
    // generic fully (same reason lib/session.ts uses `const u = user as any`).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawUser = rawSession.user as any;
    // Second lookup only for a cross-org session, by id, for the notice. A 404/error keeps the
    // "your organization" fallback below.
    const sessionOrgRes = await internalFetch(
      `/api/v1/orgs?id=${encodeURIComponent(rawUser.organizationId as string)}`,
    );
    const sessionOrg = sessionOrgRes.ok
      ? ((await sessionOrgRes.json()) as { org: { id: string; slug: string; name: string } }).org
      : null;

    const t = await getTranslations("login");
    const sessionOrgName = sessionOrg?.name ?? "your organization";
    const sessionOrgSlug = sessionOrg?.slug ?? "";

    notice = (
      <CrossOrgNotice
        sessionOrgSlug={sessionOrgSlug}
        title={t("crossOrgTitle")}
        message={t("crossOrgMessage", { sessionOrgName })}
        logoutLabel={t("crossOrgLogout", { sessionOrgName })}
        dashboardLabel={t("crossOrgDashboard")}
      />
    );
  }

  return <LoginExperience orgSlug={orgSlug} notice={notice} />;
}
