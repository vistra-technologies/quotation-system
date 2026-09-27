import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { InventoryList } from "./_inventory-list";
import type { InventoryItemRow } from "./_inventory-list";
import type { ComponentTypeOption } from "./_item-form-modal";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

// ─── Page ────────────────────────────────────────────────────────────────────

/**
 * Inventory management list page (Server Component).
 *
 * Fetches all inventory items (MANAGE_PRICING-gated) and the org's
 * ComponentType list (ungated beyond auth) for the Component dropdown in the
 * New/Edit modal. Delegates the interactive table + CRUD popup to the
 * <InventoryList> client component.
 *
 * Hotfix 2026-09-27 H-1: moved from /inventory to /admin/inventory.
 * Hotfix 2026-09-27 H-5: also fetches component-types for the modal dropdown.
 */
export default async function InventoryPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [inventoryRes, componentTypesRes, t] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/inventory`),
    internalFetch(`/api/v1/orgs/${orgSlug}/component-types`),
    getTranslations("inventory"),
  ]);

  if (inventoryRes.status === 401 || inventoryRes.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  const items: InventoryItemRow[] = inventoryRes.ok
    ? ((await inventoryRes.json()) as { items: InventoryItemRow[] }).items
    : [];

  const componentTypes: ComponentTypeOption[] = componentTypesRes.ok
    ? ((await componentTypesRes.json()) as {
        componentTypes: ComponentTypeOption[];
      }).componentTypes
    : [];

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-extrabold tracking-tight text-text-heading">
        {t("pageTitle")}
      </h1>
      <p className="mt-1 text-sm text-text-muted">{t("pageSubtitle")}</p>

      <div className="mt-6">
        <InventoryList
          items={items}
          orgSlug={orgSlug}
          componentTypes={componentTypes}
        />
      </div>
    </div>
  );
}
