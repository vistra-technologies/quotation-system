"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import {
  upsertItemPrice as dalUpsertItemPrice,
  deleteItemPrice as dalDeleteItemPrice,
} from "@/lib/data/catalog";
import { requireSession } from "@/lib/data/session";

/**
 * Upsert (add or update) an ItemPrice for a specific CatalogItem + currency.
 * Server-side RBAC gate: requires MANAGE_PRICING.
 * All DB work and tenancy checks are delegated to lib/data/catalog.ts.
 */
export async function upsertItemPrice(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const session = await requireSession(orgSlug ?? "");

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_PRICING);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      throw new Error("Forbidden: missing MANAGE_PRICING permission");
    }
    throw e;
  }

  const itemId = formData.get("itemId") as string | null;
  const currency = (formData.get("currency") as string | null)?.trim().toUpperCase();
  const priceRaw = formData.get("price") as string | null;

  if (!itemId || !currency || !priceRaw) {
    throw new Error("Invalid form data: itemId, currency, and price are required");
  }

  const price = parseFloat(priceRaw);
  if (isNaN(price) || price < 0) {
    throw new Error("Invalid price value");
  }

  await dalUpsertItemPrice(session, itemId, currency, price);

  revalidatePath(`/${orgSlug}/pricing/${itemId}`);
}

/**
 * Delete a single ItemPrice row.
 * Server-side RBAC gate: requires MANAGE_PRICING.
 * All DB work and tenancy checks are delegated to lib/data/catalog.ts.
 */
export async function deleteItemPrice(itemPriceId: string, orgSlug: string): Promise<void> {
  const session = await requireSession(orgSlug);

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_PRICING);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      throw new Error("Forbidden: missing MANAGE_PRICING permission");
    }
    throw e;
  }

  const { catalogItemId } = await dalDeleteItemPrice(session, itemPriceId);

  revalidatePath(`/${orgSlug}/pricing`);
  revalidatePath(`/${orgSlug}/pricing/${catalogItemId}`);
}
