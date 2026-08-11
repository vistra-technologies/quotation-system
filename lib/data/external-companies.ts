import { prisma } from "@/lib/prisma";
import type { SessionData } from "@/lib/session";

// ─── Reads ───────────────────────────────────────────────────────────────────

/**
 * List all external companies in the session org, A→Z by name.
 * Returns full rows including type, country, and defaultCurrency, for the admin list table.
 */
export async function listExternalCompanies(session: SessionData) {
  return prisma.externalCompany.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { name: "asc" },
  });
}

/**
 * Fetch a single external company by id, scoped to the session org.
 *
 * Returns full editable fields (name, type, country, defaultCurrency) for the edit
 * form, or null if not found or if it belongs to a different org.
 */
export async function getExternalCompanyById(
  session: SessionData,
  id: string,
): Promise<{
  id: string;
  name: string;
  type: string;
  country: string;
  defaultCurrency: string;
} | null> {
  return prisma.externalCompany.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true, name: true, type: true, country: true, defaultCurrency: true },
  });
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export type CreateExternalCompanyInput = {
  name: string;
  type: "DISTRIBUTOR" | "ARCHITECTURAL_FIRM";
  country: "INDIA" | "UAE";
  defaultCurrency: "INR" | "AED" | "USD";
};

/**
 * Create a new external company scoped to the session org.
 * No uniqueness constraint on name — duplicates are allowed by spec.
 */
export async function createExternalCompany(
  session: SessionData,
  input: CreateExternalCompanyInput,
): Promise<void> {
  await prisma.externalCompany.create({
    data: {
      organizationId: session.organizationId,
      name: input.name,
      type: input.type,
      country: input.country,
      defaultCurrency: input.defaultCurrency,
    },
  });
}

export type UpdateExternalCompanyInput = {
  name: string;
  type: "DISTRIBUTOR" | "ARCHITECTURAL_FIRM";
  country: "INDIA" | "UAE";
  defaultCurrency: "INR" | "AED" | "USD";
};

/**
 * Update an existing external company scoped to the session org.
 * Returns false if the company does not exist in this org (tenancy guard).
 */
export async function updateExternalCompany(
  session: SessionData,
  id: string,
  input: UpdateExternalCompanyInput,
): Promise<boolean> {
  const existing = await prisma.externalCompany.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!existing) return false;

  await prisma.externalCompany.update({
    where: { id },
    data: {
      name: input.name,
      type: input.type,
      country: input.country,
      defaultCurrency: input.defaultCurrency,
    },
  });
  return true;
}

/**
 * Delete an external company scoped to the session org.
 * FK references (User, Project, Inquiry) use ON DELETE SET NULL — clean cascade,
 * no dependent-records guard required.
 * Returns false if the company does not exist in this org (tenancy guard).
 */
export async function deleteExternalCompany(
  session: SessionData,
  id: string,
): Promise<boolean> {
  const existing = await prisma.externalCompany.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!existing) return false;

  await prisma.externalCompany.delete({ where: { id } });
  return true;
}
