import { redirect } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { OrdersPlaceholder } from "./orders-placeholder";

// Always render live — reads session cookie.
export const dynamic = "force-dynamic";

/**
 * Orders list page (Server Component).
 *
 * Auth-protected: any authenticated user may view the inert placeholder.
 * No permission gate (stage-10.md §1.3: "No permission gate on it for now").
 * No Prisma queries beyond the session check — no Order entity exists yet.
 *
 * Stage 10 — Task 1.8: new route, inert placeholder matching order-list-
 * page.html. All interactive elements in <OrdersPlaceholder> show the
 * "Coming Soon" toast. The Orders pipeline arrives in a future stage.
 *
 * Stage 12 Batch 6: switched requireSession from lib/data/session to
 * internalFetch /me (auth-only, no RBAC gate needed).
 */
export default async function OrdersPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  // Auth-only gate — redirect to login if no valid session.
  const meRes = await internalFetch(`/api/v1/orgs/${orgSlug}/me`);
  if (!meRes.ok) redirect(await orgHref(orgSlug, "/login"));

  return <OrdersPlaceholder />;
}
