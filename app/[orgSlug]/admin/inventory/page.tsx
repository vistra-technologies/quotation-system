import { redirect } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import type { ListItem, ListType } from "@/lib/inventory-list";
import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";
import { InventoryList } from "./_inventory-list";

// Always render live: reads session cookie and DB.
export const dynamic = "force-dynamic";

/** The GET .../inventory row (full Prisma row plus joins); only the fields the page reads are kept. */
interface ApiItem extends Omit<ListItem, "perUnitQuantity"> {
  perUnitQuantity: string | number;
}

interface ApiType {
  id: string;
  code: string;
  name: string;
  fieldsSchema: FieldEntry[];
  fieldOptionsConfig: FieldOptionsConfig | null;
}

/**
 * Inventory page (Server Component, Stage 37 Batch 3, mockup A rev 7).
 *
 * Fetches every inventory item (MANAGE_PRICING gated) and the org's component types (fields schema and option
 * values, which the Part and Matches editors need) and hands both to the interactive <InventoryList>. The page
 * title lives in the client component (it shares the header row with the "New item" button).
 *
 * Hotfix 2026-09-27 H-1: moved from /inventory to /admin/inventory.
 */
export default async function InventoryPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [inventoryRes, componentTypesRes] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/inventory`),
    internalFetch(`/api/v1/orgs/${orgSlug}/component-types`),
  ]);

  if (inventoryRes.status === 401 || inventoryRes.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  const apiItems: ApiItem[] = inventoryRes.ok
    ? ((await inventoryRes.json()) as { items: ApiItem[] }).items
    : [];
  // Keep the payload to what the client reads (the API rows also carry price rows, ignored here).
  const items: ListItem[] = apiItems.map((i) => ({
    id: i.id,
    code: i.code,
    name: i.name,
    componentTypeId: i.componentTypeId,
    measurementUnit: i.measurementUnit,
    perUnitQuantity: i.perUnitQuantity,
    soldInWholePacks: i.soldInWholePacks,
    partKey: i.partKey,
    attributes: i.attributes,
    active: i.active,
    createdAt: i.createdAt,
  }));

  const types: ListType[] = componentTypesRes.ok
    ? ((await componentTypesRes.json()) as { componentTypes: ApiType[] }).componentTypes.map((x) => ({
        id: x.id,
        code: x.code,
        name: x.name,
        fieldsSchema: x.fieldsSchema,
        fieldOptionsConfig: x.fieldOptionsConfig,
      }))
    : [];

  return <InventoryList items={items} types={types} orgSlug={orgSlug} />;
}
