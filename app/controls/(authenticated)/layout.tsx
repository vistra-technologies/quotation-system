import { redirect } from "next/navigation";
import {
  requireSuperAdmin,
  SuperAdminUnauthorizedError,
} from "@/lib/superadmin-guard";
import { internalFetch } from "@/lib/internal-fetch";
import { ControlsShell } from "./controls-shell";
import type { ControlsOrg } from "./_org-switcher";

// Always render live — reads the SuperAdminSession table on every request.
export const dynamic = "force-dynamic";

/**
 * Guard layout for all protected /controls/** routes.
 *
 * This layout lives in a Next.js App Router route group — app/controls/(authenticated)/ —
 * so it wraps only the pages inside this group without affecting the URL.
 * The login page (app/controls/login/) is deliberately OUTSIDE this group
 * so it is NOT gated by this layout.
 *
 * If no valid SuperAdmin session is present: redirect to /controls/login.
 * If a valid session is present: render the page inside the SuperAdmin console
 * shell (sidebar + top bar + padded content area).
 *
 * Stage 16 (post-implement nav fix): replaced the bare pass-through with
 * <ControlsShell> so SuperAdmins can navigate between pages without typing URLs by hand.
 *
 * Stage 29 (S29-6): also fetches the org list ONCE here (GET /api/v1/superadmin/orgs, suspended
 * orgs included) and hands it to the shell for the top-bar org dropdown. A failed fetch degrades
 * to an empty dropdown rather than taking the whole console down.
 */
export default async function ControlsAuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let username = "";

  try {
    const session = await requireSuperAdmin();
    username = session.username;
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      redirect("/controls/login");
    }
    // Re-throw unexpected errors (DB failures, etc.)
    throw err;
  }

  const orgsRes = await internalFetch("/api/v1/superadmin/orgs");
  const orgs: ControlsOrg[] = orgsRes.ok
    ? ((await orgsRes.json()) as { orgs: ControlsOrg[] }).orgs.map((o) => ({
        id: o.id,
        slug: o.slug,
        name: o.name,
        isSuspended: o.isSuspended,
        userCount: o.userCount,
        userLimit: o.userLimit,
      }))
    : [];

  // Authenticated — render inside the SuperAdmin console shell.
  return (
    <ControlsShell username={username} orgs={orgs}>
      {children}
    </ControlsShell>
  );
}
