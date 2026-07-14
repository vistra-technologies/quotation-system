import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { CrossOrgNotice } from "./cross-org-notice";
import { LoginForm } from "./login-form";

// Always render live — reads DB for org name and session state.
export const dynamic = "force-dynamic";

/**
 * Per-org login page (Server Component shell).
 *
 * orgSlug comes from the dynamic route segment — no header read required.
 * The proxy already returns 404 for unknown slugs before this page renders,
 * so the DB check below is a defensive last-resort guard only.
 *
 * Auth checks (added Stage 4):
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

  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: { name: true },
  });

  if (!org) {
    // Defensive guard — proxy should have returned 404 before reaching here.
    redirect("/");
  }

  // ── Auth check 1: same-org ────────────────────────────────────────────────
  // getSession() applies the cross-org guard internally.  A non-null result
  // means the visitor is logged in to THIS org specifically.
  const session = await getSession();
  if (session) {
    redirect(`/${orgSlug}/dashboard`);
  }

  // ── Auth check 2: cross-org ───────────────────────────────────────────────
  // If getSession() returned null, there may still be a valid better-auth
  // session for a DIFFERENT org.  Call auth.api.getSession directly, which
  // reads the cookie without the org-mismatch check.
  //
  // IMPORTANT: we use this raw session ONLY to identify org X so we can name
  // it in the notice.  We do NOT use it to authorize anything, and we do NOT
  // let it grant any access to org Y.
  const rawSession = await auth.api.getSession({ headers: await headers() });

  if (rawSession?.session) {
    // Resolve the session org's name from the DB using the session's
    // organizationId — never from the URL slug.
    //
    // Cast through any: TypeScript may not resolve better-auth's additionalFields
    // generic fully (same reason lib/session.ts uses `const u = user as any`).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawUser = rawSession.user as any;
    const sessionOrg = await prisma.organization.findUnique({
      where: { id: rawUser.organizationId as string },
      select: { name: true, slug: true },
    });

    // Translate only the new cross-org notice strings (deviation 5: existing
    // hardcoded strings on this page are Stage 3 output and stay as-is).
    const t = await getTranslations("login");

    const sessionOrgName = sessionOrg?.name ?? "your organization";
    const sessionOrgSlug = sessionOrg?.slug ?? "";

    return (
      <CrossOrgNotice
        sessionOrgSlug={sessionOrgSlug}
        title={t("crossOrgTitle")}
        message={t("crossOrgMessage", { sessionOrgName })}
        logoutLabel={t("crossOrgLogout", { sessionOrgName })}
        dashboardLabel={t("crossOrgDashboard")}
      />
    );
  }

  // ── No session: render the normal login form ──────────────────────────────
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 dark:bg-zinc-950">
      <main className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Sign in to {org.name}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Enter your username and password.
        </p>

        <LoginForm orgSlug={orgSlug} />
      </main>
    </div>
  );
}
