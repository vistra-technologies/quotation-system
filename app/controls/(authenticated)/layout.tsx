import { redirect } from "next/navigation";
import {
  requireSuperAdmin,
  SuperAdminUnauthorizedError,
} from "@/lib/superadmin-guard";
import { ControlsShell } from "./controls-shell";

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
 * <ControlsShell> so SuperAdmins can navigate between /controls/orgs and
 * /controls/roles without typing URLs by hand.
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

  // Authenticated — render inside the SuperAdmin console shell.
  return <ControlsShell username={username}>{children}</ControlsShell>;
}
