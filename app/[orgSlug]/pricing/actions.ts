"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

/**
 * Upsert (add or update) an ItemPrice for a specific CatalogItem + currency.
 * Server-side RBAC gate: requires MANAGE_PRICING.
 * Tenancy guard: verifies the CatalogItem belongs to the session's org before writing.
 */
export async function upsertItemPrice(formData: FormData): Promise<void> {
  const orgSlug = formData.get("orgSlug") as string | null;
  const session = await getSession();
  if (!session) {
    redirect(orgSlug ? `/${orgSlug}/login` : "/");
  }

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

  // Tenancy check: ensure the CatalogItem belongs to the session's org
  const catalogItem = await prisma.catalogItem.findFirst({
    where: { id: itemId, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!catalogItem) {
    throw new Error("Catalog item not found or access denied");
  }

  await prisma.itemPrice.upsert({
    where: {
      catalogItemId_currency: { catalogItemId: itemId, currency },
    },
    update: { price: price.toFixed(2), organizationId: session.organizationId },
    create: {
      organizationId: session.organizationId,
      catalogItemId: itemId,
      currency,
      price: price.toFixed(2),
    },
  });

  revalidatePath(`/${orgSlug}/pricing/${itemId}`);
}

/**
 * Delete a single ItemPrice row.
 * Server-side RBAC gate: requires MANAGE_PRICING.
 * Tenancy guard: verifies the ItemPrice belongs to the session's org before deleting.
 */
export async function deleteItemPrice(itemPriceId: string, orgSlug: string): Promise<void> {
  const session = await getSession();
  if (!session) {
    redirect(`/${orgSlug}/login`);
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_PRICING);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      throw new Error("Forbidden: missing MANAGE_PRICING permission");
    }
    throw e;
  }

  // Tenancy guard: only delete if the price belongs to the session's org
  const existing = await prisma.itemPrice.findFirst({
    where: { id: itemPriceId, organizationId: session.organizationId },
    select: { id: true, catalogItemId: true },
  });
  if (!existing) {
    throw new Error("ItemPrice not found or access denied");
  }

  await prisma.itemPrice.delete({ where: { id: itemPriceId } });

  revalidatePath(`/${orgSlug}/pricing`);
  revalidatePath(`/${orgSlug}/pricing/${existing.catalogItemId}`);
}
