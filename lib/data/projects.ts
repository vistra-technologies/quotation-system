import { prisma } from "@/lib/prisma";
import type { SessionData } from "@/lib/session";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreateProjectInput {
  name: string;
  destinationCountry: string;
  currency: string;
  status: string;
  externalCompanyId?: string | null;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * List all projects for the session org, newest-first.
 * Includes externalCompany name (nullable) for the list table.
 */
export async function listProjects(session: SessionData) {
  return prisma.project.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { createdAt: "desc" },
    include: {
      externalCompany: { select: { id: true, name: true } },
    },
  });
}

/**
 * Get a single project by id, scoped to the session org (tenancy guard).
 * Returns null if not found or if it belongs to a different org.
 */
export async function getProjectById(session: SessionData, projectId: string) {
  return prisma.project.findFirst({
    where: { id: projectId, organizationId: session.organizationId },
    include: {
      externalCompany: { select: { id: true, name: true } },
      createdBy: { select: { id: true, username: true } },
    },
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Create a new project scoped to the session org.
 *
 * `projectNumber` is assigned as MAX(projectNumber) + 1 within the org,
 * inside a serializable transaction so concurrent creates don't duplicate a number.
 * The @@unique([organizationId, projectNumber]) DB constraint is the backstop —
 * a P2002 on that pair is surfaced as a { code: "SEQUENCE_CONFLICT" } error.
 *
 * Throws { code: "SEQUENCE_CONFLICT" } on a projectNumber race collision.
 * All other errors propagate to the caller.
 */
export async function createProject(
  session: SessionData,
  input: CreateProjectInput,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const max = await tx.project.aggregate({
        where: { organizationId: session.organizationId },
        _max: { projectNumber: true },
      });
      const projectNumber = (max._max.projectNumber ?? 0) + 1;

      return tx.project.create({
        data: {
          organizationId: session.organizationId,
          createdByUserId: session.userId,
          projectNumber,
          name: input.name,
          destinationCountry: input.destinationCountry,
          currency: input.currency,
          status: input.status,
          externalCompanyId: input.externalCompanyId ?? null,
        },
      });
    });
  } catch (err) {
    // P2002 on (organizationId, projectNumber) = concurrent race collision
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      throw Object.assign(new Error("Project number conflict — please try again."), {
        code: "SEQUENCE_CONFLICT",
      });
    }
    throw err;
  }
}
