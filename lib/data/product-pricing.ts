import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionData } from "@/lib/session";
import type { PriceEntry } from "@/lib/product-pricing/price-entries";

/**
 * Stage 36 (S36-5, S36-8): ProductPricing data access. Every query takes organizationId from the session.
 * Narrow select, no join (the layout read in Batch 4 runs on every org page render).
 */

const ROW_SELECT = {
  id: true,
  componentTypeId: true,
  combinationKey: true,
  combinationLabel: true,
  prices: true,
  description: true,
  updatedAt: true,
} as const;

export async function listProductPricing(session: SessionData, opts: { componentTypeId?: string } = {}) {
  return prisma.productPricing.findMany({
    where: {
      organizationId: session.organizationId,
      ...(opts.componentTypeId ? { componentTypeId: opts.componentTypeId } : {}),
    },
    select: ROW_SELECT,
    orderBy: [{ componentTypeId: "asc" }, { combinationLabel: "asc" }],
  });
}

/** Org-scoped type lookup (tenancy guard): null when missing or another org's. `code` drives area vs piece. */
export async function getComponentTypeForPricing(session: SessionData, componentTypeId: string) {
  return prisma.componentType.findFirst({
    where: { id: componentTypeId, organizationId: session.organizationId },
    select: { id: true, code: true },
  });
}

export interface UpsertInput {
  componentTypeId: string;
  combinationKey: string;
  combinationLabel: string;
  prices: PriceEntry[];
  description: string | null;
}

/**
 * Upsert on (organizationId, componentTypeId, combinationKey). No prices and no description deletes the row
 * (only rows with content exist) and returns null.
 */
export async function upsertProductPricing(session: SessionData, input: UpsertInput) {
  if (input.prices.length === 0 && input.description === null) {
    await prisma.productPricing.deleteMany({
      where: {
        organizationId: session.organizationId,
        componentTypeId: input.componentTypeId,
        combinationKey: input.combinationKey,
      },
    });
    return null;
  }
  return prisma.productPricing.upsert({
    where: {
      organizationId_componentTypeId_combinationKey: {
        organizationId: session.organizationId,
        componentTypeId: input.componentTypeId,
        combinationKey: input.combinationKey,
      },
    },
    create: {
      organizationId: session.organizationId,
      componentTypeId: input.componentTypeId,
      combinationKey: input.combinationKey,
      combinationLabel: input.combinationLabel,
      prices: input.prices as unknown as Prisma.InputJsonValue,
      description: input.description,
    },
    update: {
      combinationLabel: input.combinationLabel,
      prices: input.prices as unknown as Prisma.InputJsonValue,
      description: input.description,
    },
    select: ROW_SELECT,
  });
}

/** Delete one row of the session org. Returns false when the id is missing or belongs to another org. */
export async function deleteProductPricing(session: SessionData, id: string): Promise<boolean> {
  const res = await prisma.productPricing.deleteMany({ where: { id, organizationId: session.organizationId } });
  return res.count > 0;
}
