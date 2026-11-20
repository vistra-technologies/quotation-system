import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionData } from "@/lib/session";
import { parseFieldsSchema, parseFieldOptionsConfig } from "@/lib/parse-field-config";
import { validateMatchAttributes } from "@/lib/inventory-matches";
import type { ItemPriceRow } from "@/lib/item-price";

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

/**
 * Thrown by createInventoryItem / updateInventoryItem when `partKey` is not the key of an
 * `inventoryLinked` field of the item's component type (Stage 37 Q-D21): maps to a 400.
 */
export class InvalidPartKeyError extends Error {
  constructor() {
    super("partKey must be the key of an inventory-linked field of the item's component type");
    this.name = "InvalidPartKeyError";
  }
}

/**
 * Thrown by createInventoryItem / updateInventoryItem when `attributes` (the Matches rows) fail the save checks
 * (Stage 37 S37-2): unknown field key, a value the org does not offer, empty, non-canonical, a checkbox other than
 * Yes/No, a non-string value, rows without a component type. Maps to a 400; `errors[0]` is the response text.
 */
export class InvalidAttributesError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors[0] ?? "Invalid Matches rows");
    this.name = "InvalidAttributesError";
    this.errors = errors;
  }
}

/**
 * The S37-2 save check: `attributes` against the LIVE schema and org options of the item's component type
 * (S37-6). No rows is always valid. Throws InvalidAttributesError.
 */
async function assertValidAttributes(
  organizationId: string,
  componentTypeId: string | null,
  attributes: unknown,
): Promise<void> {
  const isObject = typeof attributes === "object" && attributes !== null && !Array.isArray(attributes);
  if (isObject && Object.keys(attributes as object).length === 0) return;
  if (!isObject) throw new InvalidAttributesError(["attributes must be an object of Matches rows"]);
  if (!componentTypeId) throw new InvalidAttributesError(["Matches rows need a component type"]);
  const ct = await prisma.componentType.findFirst({
    where: { id: componentTypeId, organizationId },
    select: { fieldsSchema: true, orgConfig: { select: { fieldOptionsConfig: true } } },
  });
  if (!ct) throw new InvalidAttributesError(["Matches rows need a component type of this organization"]);
  const errors = validateMatchAttributes(
    attributes,
    parseFieldsSchema(ct.fieldsSchema),
    ct.orgConfig ? parseFieldOptionsConfig(ct.orgConfig.fieldOptionsConfig) : null,
  );
  if (errors.length > 0) throw new InvalidAttributesError(errors);
}

/** Keys of the `inventoryLinked` fields of one org-owned ComponentType (null if the type is not in the org). */
async function loadLinkedFieldKeys(
  organizationId: string,
  componentTypeId: string,
): Promise<string[] | null> {
  const ct = await prisma.componentType.findFirst({
    where: { id: componentTypeId, organizationId },
    select: { fieldsSchema: true },
  });
  if (!ct) return null;
  return parseFieldsSchema(ct.fieldsSchema)
    .filter((f) => f.inventoryLinked === true)
    .map((f) => f.key);
}

/** Throws InvalidPartKeyError unless `partKey` is an inventory-linked field key of `componentTypeId`. */
async function assertValidPartKey(
  organizationId: string,
  componentTypeId: string | null,
  partKey: string,
): Promise<void> {
  if (!componentTypeId) throw new InvalidPartKeyError();
  const keys = await loadLinkedFieldKeys(organizationId, componentTypeId);
  if (!keys || !keys.includes(partKey)) throw new InvalidPartKeyError();
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
  /** Matches rows (Stage 37): fieldKey -> value, validated by assertValidAttributes. Defaults to {} when omitted. */
  attributes?: object;
  /** Stage 37 Q-D16: whole packs (default true) or exact quantity. */
  soldInWholePacks?: boolean;
  /** Stage 37 Q-D21: inventory-linked field key this item is a value of; null/undefined = Other. */
  partKey?: string | null;
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
  soldInWholePacks?: boolean;
  /** Send null to clear. Cleared automatically when componentTypeId changes and partKey is not supplied. */
  partKey?: string | null;
  /**
   * Matches rows (Stage 37 S37-2). Omitted + same type = untouched and not re-validated; omitted + type changed =
   * cleared to {} (S37-5); supplied = validated against the item's (new) type.
   */
  attributes?: object;
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

  // Stage 37 Q-D21: partKey only against the item's own component type's inventory-linked fields.
  if (data.partKey) {
    await assertValidPartKey(session.organizationId, data.componentTypeId ?? null, data.partKey);
  }

  // Stage 37 S37-2: Matches rows are checked against the live schema before anything is written.
  if (data.attributes !== undefined) {
    await assertValidAttributes(session.organizationId, data.componentTypeId ?? null, data.attributes);
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
        soldInWholePacks: data.soldInWholePacks ?? true,
        partKey: data.partKey ?? null,
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
  if (data.soldInWholePacks !== undefined) update.soldInWholePacks = data.soldInWholePacks;

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

  // Stage 37 Q-D21 / S37-5: partKey is validated against the NEW type; a type change without an explicit
  // partKey clears it, and clears the Matches rows in `attributes` unless new rows are supplied (S37-2 check).
  if (data.partKey !== undefined || data.componentTypeId !== undefined || data.attributes !== undefined) {
    const current = await prisma.inventoryItem.findFirst({
      where: { id: itemId, organizationId: session.organizationId },
      select: { componentTypeId: true },
    });
    if (!current) return null; // not found or wrong org
    const newTypeId = data.componentTypeId !== undefined ? data.componentTypeId : current.componentTypeId;
    const typeChanged = data.componentTypeId !== undefined && data.componentTypeId !== current.componentTypeId;
    if (data.partKey) {
      await assertValidPartKey(session.organizationId, newTypeId ?? null, data.partKey);
      update.partKey = data.partKey;
    } else if (data.partKey === null || typeChanged) {
      update.partKey = null;
    }
    if (data.attributes !== undefined) {
      await assertValidAttributes(session.organizationId, newTypeId ?? null, data.attributes);
      update.attributes = data.attributes as Prisma.InputJsonValue;
    } else if (typeChanged) {
      update.attributes = {};
    }
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
 * Replace the full price list of one InventoryItem (Stage 38, S38-3). Rows are upserted by
 * (inventoryItemId, currency) so ItemPrice.id and createdAt stay stable; currencies absent from `rows`
 * are deleted. One transaction. Tenancy guard: returns null when the item is missing or belongs to another org.
 * Money arrives as validated 2 dp strings (lib/item-price.ts), never floats.
 */
export async function replaceItemPrices(
  session: SessionData,
  itemId: string,
  rows: ItemPriceRow[],
) {
  const owned = await prisma.inventoryItem.findFirst({
    where: { id: itemId, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!owned) return null;
  return prisma.$transaction(async (tx) => {
    for (const r of rows) {
      await tx.itemPrice.upsert({
        where: { inventoryItemId_currency: { inventoryItemId: itemId, currency: r.currency } },
        update: { price: r.price, minPrice: r.minPrice, allowAbove: r.allowAbove },
        create: {
          organizationId: session.organizationId,
          inventoryItemId: itemId,
          currency: r.currency,
          price: r.price,
          minPrice: r.minPrice,
          allowAbove: r.allowAbove,
        },
      });
    }
    await tx.itemPrice.deleteMany({
      where: { inventoryItemId: itemId, currency: { notIn: rows.map((r) => r.currency) } },
    });
    return tx.itemPrice.findMany({
      where: { inventoryItemId: itemId },
      orderBy: { currency: "asc" },
    });
  });
}
