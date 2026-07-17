import { prisma } from "@/lib/prisma";
import type { SessionData } from "@/lib/session";

// ─── Reads ───────────────────────────────────────────────────────────────────

/**
 * List all external companies in the session org, A→Z by name.
 * Returns full rows including type, for the admin list table.
 */
export async function listExternalCompanies(session: SessionData) {
  return prisma.externalCompany.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { name: "asc" },
  });
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export type CreateExternalCompanyInput = {
  name: string;
  type: "DISTRIBUTOR" | "ARCHITECTURAL_FIRM";
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
    },
  });
}
