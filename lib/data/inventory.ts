/**
 * Inventory DAL loader for the material-list engine (Stage 24 Batch 5).
 *
 * Loads all InventoryItems (including inactive — the resolver needs them to detect INACTIVE_ITEM)
 * for one org and returns them as an O(1) lookup map keyed by `code`.
 *
 * Converts Prisma's `Decimal` type for `perUnitQuantity` to a plain JS `number` so the pure
 * resolver never imports the Prisma Decimal class. The conversion is safe: perUnitQuantity is a
 * small positive number (e.g. 3.0, 1.0) with at most a handful of decimal places.
 */
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * One InventoryItem as seen by the pure resolver. `perUnitQuantity` is a plain `number`
 * (Prisma Decimal has been stripped by the loader).
 */
export interface InventoryRow {
  name: string;
  measurementUnit: string;
  perUnitQuantity: number;
  active: boolean;
}

/**
 * Load all InventoryItems for `organizationId` and return a Map keyed by `code`.
 * Inactive items are included — the resolver needs them to emit INACTIVE_ITEM problems.
 * Works against either the plain client or an open transaction client.
 */
export async function loadInventoryMap(
  db: Db,
  organizationId: string,
): Promise<Map<string, InventoryRow>> {
  const items = await db.inventoryItem.findMany({
    where: { organizationId },
    select: {
      code: true,
      name: true,
      measurementUnit: true,
      perUnitQuantity: true,
      active: true,
    },
  });

  const map = new Map<string, InventoryRow>();
  for (const item of items) {
    map.set(item.code, {
      name: item.name,
      measurementUnit: item.measurementUnit,
      // Convert Decimal → number here so the pure resolver never imports Prisma types.
      perUnitQuantity: Number(item.perUnitQuantity),
      active: item.active,
    });
  }
  return map;
}
