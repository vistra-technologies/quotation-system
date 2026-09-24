import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionData } from "@/lib/session";

// ─── Domain errors ────────────────────────────────────────────────────────────

/**
 * Thrown by createInventoryItem / updateInventoryItem when the (organizationId, code)
 * unique constraint is violated — maps to a 409 response in the route handler.
 */
export class DuplicateInventoryCodeError extends Error {
  constructor(code: string) {
    super(`An inventory item with code "${code}" already exists in this organization`);
    this.name = "DuplicateInventoryCodeError";
  }
}

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

// ── Inventory item CRUD (Stage 25 Batch 7) ───────────────────────────────────

export interface CreateInventoryItemData {
  code: string;
  name: string;
  measurementUnit: string;
  /**
   * Open-ended category string (WALL_TYPE | GLASS | DOOR_TYPE | …).
   * Not listed in the Batch 7 spec fields but required by the DB schema.
   * Defaults to "" when omitted; the Batch 8 popup will expose it as a field.
   */
  category?: string;
  perUnitQuantity?: number;
  active?: boolean;
  /** Untyped JSONB — defaults to {} when omitted. */
  attributes?: object;
}

export interface UpdateInventoryItemData {
  code?: string;
  name?: string;
  measurementUnit?: string;
  perUnitQuantity?: number;
  active?: boolean;
}

/**
 * Create a new InventoryItem for the session org.
 * Throws DuplicateInventoryCodeError if (organizationId, code) already exists.
 */
export async function createInventoryItem(
  session: SessionData,
  data: CreateInventoryItemData,
) {
  try {
    return await prisma.inventoryItem.create({
      data: {
        organizationId: session.organizationId,
        category: data.category ?? "",
        code: data.code.trim(),
        name: data.name,
        measurementUnit: data.measurementUnit,
        perUnitQuantity: data.perUnitQuantity ?? 1,
        active: data.active ?? true,
        attributes: (data.attributes ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new DuplicateInventoryCodeError(data.code);
    }
    throw err;
  }
}

/**
 * Update an existing InventoryItem that belongs to the session org.
 * Returns null if the item is not found or belongs to a different org (tenancy guard).
 * Throws DuplicateInventoryCodeError if the new code collides with an existing item.
 */
export async function updateInventoryItem(
  session: SessionData,
  itemId: string,
  data: UpdateInventoryItemData,
): Promise<object | null> {
  // Build the update payload — only include fields explicitly supplied.
  const update: Record<string, unknown> = {};
  if (data.code !== undefined) update.code = data.code.trim();
  if (data.name !== undefined) update.name = data.name;
  if (data.measurementUnit !== undefined) update.measurementUnit = data.measurementUnit;
  if (data.perUnitQuantity !== undefined) update.perUnitQuantity = data.perUnitQuantity;
  if (data.active !== undefined) update.active = data.active;

  try {
    const result = await prisma.inventoryItem.updateMany({
      where: { id: itemId, organizationId: session.organizationId },
      data: update,
    });
    if (result.count === 0) return null; // not found or wrong org
    // Re-read for the response (includes computed/defaulted fields).
    return getInventoryItemById(session, itemId);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new DuplicateInventoryCodeError(data.code ?? "");
    }
    throw err;
  }
}

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
