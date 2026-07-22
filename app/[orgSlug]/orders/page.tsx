import { requireSession } from "@/lib/data/session";
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
 */
export default async function OrdersPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  // Redirects to login if no valid session exists for this org.
  await requireSession(orgSlug);

  return <OrdersPlaceholder />;
}
