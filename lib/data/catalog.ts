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

/**
 * Thrown by createInventoryItem / updateInventoryItem when the supplied componentTypeId
 * does not exist in the caller's org — maps to a 422 response in the route handler.
 *
 * The DB FK only checks that the row exists, not which org owns it; this guard prevents
 * org A from silently linking org B's ComponentType to its own InventoryItem.
 */
export class InvalidComponentTypeError extends Error {
  constructor() {
    super("ComponentType not found or belongs to a different org");
    this.name = "InvalidComponentTypeError";
  }
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/**
 * List ALL inventory items for the session org (active + inactive), with prices and
 * the linked ComponentType (H-17: componentTypeId FK).
 * Ordered category → code, then prices by currency within each item.
 *
 * Used by the inventory management page — admins need to see inactive items
 * so they can edit/reactivate them (Stage 25 Batch 8).
 */
export async function listAllInventoryItems(session: SessionData) {
  return prisma.inventoryItem.findMany({
    where: { organizationId: session.organizationId },
    include: {
      prices: { orderBy: { currency: "asc" } },
      // H-17: include the linked ComponentType for display in the list and modal pre-population.
      componentType: { select: { id: true, code: true, name: true } },
    },
    orderBy: [{ category: "asc" }, { code: "asc" }],
  });
}

/**
 * Get one inventory item with prices and ComponentType, org-scoped (tenancy guard).
 * Returns null if not found or if it belongs to a different org.
 */
export async function getInventoryItemById(session: SessionData, itemId: string) {
  return prisma.inventoryItem.findFirst({
    where: { id: itemId, organizationId: session.organizationId },
    include: {
      prices: { orderBy: { currency: "asc" } },
      // H-17: include linked ComponentType for API response and modal pre-population.
      componentType: { select: { id: true, code: true, name: true } },
    },
  });
}

// ─── Mutations ───────────────────────────────────────────────────────────────

// ── Inventory item CRUD (Stage 25 Batch 7) ───────────────────────────────────

export interface CreateInventoryItemData {
  code: string;
  name: string;
  measurementUnit: string;
  /**
   * H-17: FK to ComponentType.id (nullable — items with no ComponentType mapping stay NULL).
   * Replaces the free-text `category` field as the Component selector in the UI.
   * The legacy `category` String column is kept in the DB for audit trail but is no longer
   * written by the UI; createInventoryItem writes "" to it unconditionally for backward compat.
   */
  componentTypeId?: string | null;
  perUnitQuantity?: number;
  active?: boolean;
  /** Untyped JSONB — defaults to {} when omitted. */
  attributes?: object;
}

export interface UpdateInventoryItemData {
  code?: string;
  name?: string;
  /**
   * H-17: FK to ComponentType.id (nullable — send null to clear the link).
   * Replaces the free-text `category` field for the Component dropdown in the edit modal.
   */
  componentTypeId?: string | null;
  measurementUnit?: string;
  perUnitQuantity?: number;
  active?: boolean;
}

/**
 * Create a new InventoryItem for the session org.
 * Throws DuplicateInventoryCodeError if (organizationId, code) already exists.
 * H-17: accepts componentTypeId (FK) instead of category string.
 * The legacy category column is written as "" for audit trail backward compat.
 */
export async function createInventoryItem(
  session: SessionData,
  data: CreateInventoryItemData,
) {
  // Tenancy guard: ensure the supplied componentTypeId belongs to the caller's org.
  // The DB FK only checks row existence, not org ownership — without this check, org A
  // could silently link org B's ComponentType to its own InventoryItem.
  if (data.componentTypeId) {
    const ct = await prisma.componentType.findFirst({
      where: { id: data.componentTypeId, organizationId: session.organizationId },
      select: { id: true },
    });
    if (!ct) throw new InvalidComponentTypeError();
  }

  try {
    return await prisma.inventoryItem.create({
      data: {
        organizationId: session.organizationId,
        // H-17: category kept as "" (legacy column); UI now uses componentTypeId.
        category: "",
        code: data.code.trim(),
        name: data.name,
        measurementUnit: data.measurementUnit,
        perUnitQuantity: data.perUnitQuantity ?? 1,
        active: data.active ?? true,
        attributes: (data.attributes ?? {}) as Prisma.InputJsonValue,
        // H-17: real FK to ComponentType (nullable).
        componentTypeId: data.componentTypeId ?? null,
      },
      include: {
        componentType: { select: { id: true, code: true, name: true } },
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

  // H-17: componentTypeId is a nullable FK — explicitly include it in the sentinel
  // so `hasAnyField` checks still work correctly.
  if (data.componentTypeId !== undefined) update.componentTypeId = data.componentTypeId ?? null;

  // Tenancy guard: ensure the supplied componentTypeId belongs to the caller's org.
  // Null means "clear the FK" — skip the check. Undefined means "leave unchanged" — also skip.
  // Only check when a real ID is being set.
  if (data.componentTypeId) {
    const ct = await prisma.componentType.findFirst({
      where: { id: data.componentTypeId, organizationId: session.organizationId },
      select: { id: true },
    });
    if (!ct) throw new InvalidComponentTypeError();
  }

  try {
    const result = await prisma.inventoryItem.updateMany({
      where: { id: itemId, organizationId: session.organizationId },
      data: update,
    });
    if (result.count === 0) return null; // not found or wrong org
    // Re-read for the response (includes computed/defaulted fields and componentType relation).
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
 * Delete an InventoryItem that belongs to the session org.
 * Returns true if the item was deleted, false if it was not found or belongs
 * to a different org (tenancy guard — wrong-org items are indistinguishable
 * from missing ones).
 *
 * ItemPrice rows are removed automatically via the Cascade FK defined on
 * ItemPrice.inventoryItemId → no explicit child-delete needed.
 *
 * Hotfix 2026-09-27 H-6.
 */
export async function deleteInventoryItem(
  session: SessionData,
  itemId: string,
): Promise<boolean> {
  const result = await prisma.inventoryItem.deleteMany({
    where: { id: itemId, organizationId: session.organizationId },
  });
  return result.count > 0;
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
