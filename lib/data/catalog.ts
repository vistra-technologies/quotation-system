import { prisma } from "@/lib/prisma";
import type { SessionData } from "@/lib/session";

// ─── Reads ───────────────────────────────────────────────────────────────────

/**
 * List active inventory items for the session org, with their prices.
 * Ordered category → code, then prices by currency within each item.
 */
export async function listInventoryItems(session: SessionData) {
  return prisma.inventoryItem.findMany({
    where: { organizationId: session.organizationId, active: true },
    include: { prices: { orderBy: { currency: "asc" } } },
    orderBy: [{ category: "asc" }, { code: "asc" }],
  });
}

/**
 * Get one inventory item with prices, org-scoped (tenancy guard).
 * Returns null if not found or if it belongs to a different org.
 */
export async function getInventoryItemById(session: SessionData, itemId: string) {
  return prisma.inventoryItem.findFirst({
    where: { id: itemId, organizationId: session.organizationId },
    include: { prices: { orderBy: { currency: "asc" } } },
  });
}

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * Tenancy guard: assert an InventoryItem belongs to the given org.
 * Throws a generic error on failure to prevent enumeration of other orgs' items.
 */
export async function assertInventoryItemInOrg(
  itemId: string,
  organizationId: string,
): Promise<void> {
  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, organizationId },
    select: { id: true },
  });
  if (!item) throw new Error("Inventory item not found or access denied");
}

/**
 * Upsert (add or update) an ItemPrice for an InventoryItem + currency pair.
 * Tenancy guard: verifies the InventoryItem belongs to the session org before writing.
 */
export async function upsertItemPrice(
  session: SessionData,
  itemId: string,
  currency: string,
  price: number,
): Promise<void> {
  await assertInventoryItemInOrg(itemId, session.organizationId);
  await prisma.itemPrice.upsert({
    where: {
      inventoryItemId_currency: { inventoryItemId: itemId, currency },
    },
    update: { price: price.toFixed(2), organizationId: session.organizationId },
    create: {
      organizationId: session.organizationId,
      inventoryItemId: itemId,
      currency,
      price: price.toFixed(2),
    },
  });
}

/**
 * Delete a single ItemPrice row.
 * Tenancy guard: verifies the ItemPrice belongs to the session org before deleting.
 * Returns the inventoryItemId so the caller can revalidate the correct item page.
 */
export async function deleteItemPrice(
  session: SessionData,
  itemPriceId: string,
): Promise<{ inventoryItemId: string }> {
  const existing = await prisma.itemPrice.findFirst({
    where: { id: itemPriceId, organizationId: session.organizationId },
    select: { id: true, inventoryItemId: true },
  });
  if (!existing) throw new Error("ItemPrice not found or access denied");
  await prisma.itemPrice.delete({ where: { id: itemPriceId } });
  return { inventoryItemId: existing.inventoryItemId };
}
