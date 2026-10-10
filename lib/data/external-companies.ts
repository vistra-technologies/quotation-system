import { prisma } from "@/lib/prisma";
import type { SessionData } from "@/lib/session";
import type { CompanyRecordCounts } from "@/lib/company-records";
import { companyHasRecords } from "@/lib/company-records";

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

export type DeleteExternalCompanyResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "has_records"; counts: CompanyRecordCounts };

/**
 * Delete an external company scoped to the session org (Stage 31 S31-5).
 * Refused while the company still has users (active or deactivated), projects or inquiries: those
 * FKs are ON DELETE SET NULL, which would silently detach the records (invisible to external
 * users afterwards). The counts and the delete share one transaction. The FKs stay SET NULL as a
 * backstop for a row created between the count and the delete.
 * Tenancy guard: not_found if the company is not in this org.
 */
export async function deleteExternalCompany(
  session: SessionData,
  id: string,
): Promise<DeleteExternalCompanyResult> {
  const organizationId = session.organizationId;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.externalCompany.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!existing) return { ok: false as const, reason: "not_found" as const };

    const [users, projects, inquiries] = await Promise.all([
      tx.user.count({ where: { organizationId, externalCompanyId: id } }),
      tx.project.count({ where: { organizationId, externalCompanyId: id } }),
      tx.inquiry.count({ where: { organizationId, externalCompanyId: id } }),
    ]);
    const counts = { users, projects, inquiries };
    if (companyHasRecords(counts)) {
      return { ok: false as const, reason: "has_records" as const, counts };
    }

    await tx.externalCompany.delete({ where: { id } });
    return { ok: true as const };
  });
}
