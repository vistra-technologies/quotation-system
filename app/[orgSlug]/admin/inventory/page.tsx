import { redirect } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { resolveDefaultCurrency } from "@/lib/currency";
import type { ListItem, ListType } from "@/lib/inventory-list";
import type { StoredPrice } from "@/lib/inventory-prices";
import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";
import { InventoryList } from "./_inventory-list";

// Always render live: reads session cookie and DB.
export const dynamic = "force-dynamic";

/** The GET .../inventory row (full Prisma row plus joins); only the fields the page reads are kept. */
interface ApiItem extends Omit<ListItem, "perUnitQuantity" | "prices"> {
  perUnitQuantity: string | number;
  prices?: Array<StoredPrice & { id?: string }>;
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
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ type?: string | string[] }>;
}) {
  const { orgSlug } = await params;
  const { type: typeParam } = await searchParams;

  const [inventoryRes, componentTypesRes, meRes] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/inventory`),
    internalFetch(`/api/v1/orgs/${orgSlug}/component-types`),
    internalFetch(`/api/v1/orgs/${orgSlug}/me`),
  ]);

  if (inventoryRes.status === 401 || inventoryRes.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  const apiItems: ApiItem[] = inventoryRes.ok
    ? ((await inventoryRes.json()) as { items: ApiItem[] }).items
    : [];
  // Stage 38: the list shows the org's default currency only (Q-D24); /me carries it for every user.
  const me = meRes.ok ? ((await meRes.json()) as { orgDefaultCurrency?: unknown }) : null;
  const defaultCurrency = resolveDefaultCurrency(null, me?.orgDefaultCurrency);

  // Keep the payload to what the client reads (price rows trimmed to the four fields the UI uses).
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
    prices: (i.prices ?? []).map((p) => ({ currency: p.currency, price: p.price, minPrice: p.minPrice, allowAbove: p.allowAbove })),
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

  // ?type=<ComponentType code> preselects that tab (the Submit Design problem popup link); unknown codes mean All.
  const typeCode = Array.isArray(typeParam) ? typeParam[0] : typeParam;
  const initialTab = types.find((x) => x.code === typeCode)?.id ?? "all";

  return <InventoryList items={items} types={types} orgSlug={orgSlug} initialTab={initialTab} defaultCurrency={defaultCurrency} />;
}
