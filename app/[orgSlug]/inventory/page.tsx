import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { InventoryList } from "./_inventory-list";
import type { InventoryItemRow } from "./_inventory-list";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * Inventory management list page (Server Component).
 *
 * Fetches all inventory items for the org (active + inactive) via the
 * MANAGE_PRICING-gated GET /api/v1/orgs/[orgSlug]/inventory route, then
 * delegates the interactive table + CRUD popup to the <InventoryList> client
 * component. Wrong-role requests (403) redirect to /login.
 *
 * Stage 11 (Batch 9): restyled to Sage Ease tokens.
 * Stage 12: switched from direct requireSession + DAL calls to internalFetch.
 * Stage 25 Batch 6 (S25-4): renamed from /pricing to /inventory; prices column
 * removed (S25-7); API route moved to /inventory.
 * Stage 25 Batch 8: table + CRUD buttons moved to <InventoryList> client
 * component; page now fetches all items (active + inactive) for management.
 */
export default async function InventoryPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [inventoryRes, t] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/inventory`),
    getTranslations("inventory"),
  ]);

  if (inventoryRes.status === 401 || inventoryRes.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  const items: InventoryItemRow[] = inventoryRes.ok
    ? ((await inventoryRes.json()) as { items: InventoryItemRow[] }).items
    : [];

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-extrabold tracking-tight text-text-heading">
        {t("pageTitle")}
      </h1>
      <p className="mt-1 text-sm text-text-muted">{t("pageSubtitle")}</p>

      <div className="mt-6">
        <InventoryList items={items} orgSlug={orgSlug} />
      </div>
    </div>
  );
}
