import { redirect } from "next/navigation";
import {
  requireSuperAdmin,
  SuperAdminUnauthorizedError,
} from "@/lib/superadmin-guard";

// Always render live — reads the SuperAdminSession table on every request.
export const dynamic = "force-dynamic";

/**
 * Guard layout for all protected /controls/** routes (Batches C–E pages).
 *
 * This layout lives in a Next.js App Router route group — app/controls/(authenticated)/ —
 * so it wraps only the pages inside this group without affecting the URL.
 * The login page (app/controls/login/) is deliberately OUTSIDE this group
 * so it is NOT gated by this layout.
 *
 * If no valid SuperAdmin session is present: redirect to /controls/login.
 * If a valid session is present: render the page unchanged (children pass-through).
 *
 * Future dashboard nav/shell chrome (Batches C–E) can be added here once
 * the authenticated pages exist.
 */
export default async function ControlsAuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requireSuperAdmin();
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      redirect("/controls/login");
    }
    // Re-throw unexpected errors (DB failures, etc.)
    throw err;
  }

  // Authenticated — render the page.
  return <>{children}</>;
}
