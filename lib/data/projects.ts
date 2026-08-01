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

export interface ListProjectsParams {
  /** "mine" = current user's own; "all" = scoped by role (see below). */
  scope: "mine" | "all";
  /** Full-text search across project name and external company name. */
  search?: string;
  /** Earliest createdAt to include (inclusive). */
  dateFrom?: Date;
  /** Latest createdAt to include (inclusive). */
  dateTo?: Date;
  /** 1-based page number. */
  page: number;
  /** Records per page. */
  pageSize: number;
  /**
   * Additional external-company filter for internal users viewing "All" scope.
   * When set, narrows results to projects with this externalCompanyId, within
   * the session's org. Ignored for external users (they're already scoped to
   * their own company by the scope=all condition).
   */
  externalCompanyId?: string;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * List all projects for the session org, newest-first.
 * Includes externalCompany name (nullable) for the list table.
 *
 * @deprecated Use listProjectsPaginated for all new callers.
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
 * Paginated, filtered project list with RBAC visibility rules.
 *
 * Visibility rules (enforced server-side from session — never from URL params):
 *   scope="mine"  — always filters to createdByUserId = session.userId
 *   scope="all"   — external user (externalCompanyId != null): own company only
 *                 — internal user (externalCompanyId === null): full org scope
 *
 * Returns { projects, total } — total is the count before pagination, used
 * by the caller to compute page count.
 *
 * Tenancy: organizationId always scoped to session.organizationId.
 */
// Extract Prisma's ProjectWhereInput type without explicitly importing from @prisma/client.
// NonNullable strips the `| undefined` from the optional `where` property.
type ProjectWhereInput = NonNullable<
  NonNullable<Parameters<typeof prisma.project.findMany>[0]>["where"]
>;

export async function listProjectsPaginated(
  session: SessionData,
  params: ListProjectsParams,
) {
  const { scope, search, dateFrom, dateTo, page, pageSize } = params;

  // Build AND conditions incrementally to keep the where clause type-safe
  // without explicitly importing Prisma namespace types.
  const andConditions: ProjectWhereInput[] = [
    { organizationId: session.organizationId },
  ];

  // Scope: my own vs. role-scoped "all"
  if (scope === "mine") {
    andConditions.push({ createdByUserId: session.userId });
  } else if (session.externalCompanyId !== null) {
    // External user: "all" = only their external company's projects.
    // Value from server-side session — cannot be spoofed by URL params.
    andConditions.push({ externalCompanyId: session.externalCompanyId });
  }
  // Internal user + scope=all: no extra condition — sees all org projects.

  // Optional external-company filter — internal users only.
  // Narrows within the org; never replaces the org-level scope above.
  // Ignored for external users (their externalCompanyId is already enforced above).
  if (params.externalCompanyId && session.externalCompanyId === null) {
    andConditions.push({ externalCompanyId: params.externalCompanyId });
  }

  // Date range filter on createdAt
  if (dateFrom || dateTo) {
    andConditions.push({
      createdAt: {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {}),
      },
    });
  }

  // Full-text search across name and external company name
  if (search && search.trim()) {
    andConditions.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { externalCompany: { name: { contains: search, mode: "insensitive" } } },
      ],
    });
  }

  const where: ProjectWhereInput = { AND: andConditions };

  const [total, projects] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        externalCompany: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, username: true } },
      },
    }),
  ]);

  return { projects, total };
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
 * `projectNumber` is assigned as MAX(projectNumber) + 1 within the org, inside a
 * transaction. The @@unique([organizationId, projectNumber]) DB constraint is the
 * real guard against concurrent creates duplicating a number — a P2002 on that
 * pair is surfaced as a { code: "SEQUENCE_CONFLICT" } error.
 *
 * Also verifies `externalCompanyId` (if given) belongs to the session's org before
 * inserting, to prevent cross-tenant references.
 *
 * Throws { code: "SEQUENCE_CONFLICT" } on a projectNumber race collision, or
 * { code: "INVALID_EXTERNAL_COMPANY" } if externalCompanyId doesn't resolve within
 * the org. All other errors propagate to the caller.
 */
export async function createProject(
  session: SessionData,
  input: CreateProjectInput,
) {
  // Defense in depth: if the session user is tied to a fixed company,
  // always use that — ignore whatever the client submitted.  Only when
  // session.externalCompanyId is null does the caller-supplied value apply.
  const resolvedExternalCompanyId =
    session.externalCompanyId !== null
      ? session.externalCompanyId
      : (input.externalCompanyId ?? null);

  try {
    return await prisma.$transaction(async (tx) => {
      if (resolvedExternalCompanyId) {
        const company = await tx.externalCompany.findFirst({
          where: { id: resolvedExternalCompanyId, organizationId: session.organizationId },
          select: { id: true },
        });
        if (!company) {
          throw Object.assign(new Error("External company not found."), {
            code: "INVALID_EXTERNAL_COMPANY",
          });
        }
      }

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
          externalCompanyId: resolvedExternalCompanyId,
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
