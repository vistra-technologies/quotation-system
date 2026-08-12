import { prisma } from "@/lib/prisma";
import type { SessionData } from "@/lib/session";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreateProjectInput {
  name: string;
  destinationCountry: string;
  currency: string;
  projectLocation?: string | null;
  status: string;
  externalCompanyId?: string | null;
  // Stage 14 Batch A — extended intake fields
  submissionDate?: Date | null;
  projectDeadline?: Date | null;
  projectBudget?: string | null;
  mainContractorName?: string | null;
  interiorContractorName?: string | null;
  mainConsultantName?: string | null;
  interiorConsultantName?: string | null;
  endClientName?: string | null;
  endClientPhone?: string | null;
  endClientEmail?: string | null;
  endClientAddressLine1?: string | null;
  endClientAddressLine2?: string | null;
  endClientCity?: string | null;
  endClientState?: string | null;
  endClientGstNumber?: string | null;
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

export interface UpdateProjectInput {
  name?: string;
  destinationCountry?: string;
  currency?: string;
  projectLocation?: string | null;
  // externalCompanyId is intentionally absent — it is never updatable after creation.
  // Stage 14 Batch A — extended intake fields
  submissionDate?: Date | null;
  projectDeadline?: Date | null;
  projectBudget?: string | null;
  mainContractorName?: string | null;
  interiorContractorName?: string | null;
  mainConsultantName?: string | null;
  interiorConsultantName?: string | null;
  endClientName?: string | null;
  endClientPhone?: string | null;
  endClientEmail?: string | null;
  endClientAddressLine1?: string | null;
  endClientAddressLine2?: string | null;
  endClientCity?: string | null;
  endClientState?: string | null;
  endClientGstNumber?: string | null;
}

/**
 * Create a new project scoped to the session org.
 *
 * `projectNumber` is assigned as MAX(projectNumber) + 1 within the org, inside a
 * transaction. The @@unique([organizationId, projectNumber]) DB constraint is the
 * real guard against concurrent creates duplicating a number — a P2002 on that
 * pair is surfaced as a { code: "SEQUENCE_CONFLICT" } error.
 *
 * When `externalCompanyId` is resolved to a non-null value, `companyProjectNumber`
 * is additionally assigned as MAX(companyProjectNumber) + 1 scoped to that company,
 * inside the same transaction. The @@unique([externalCompanyId, companyProjectNumber])
 * DB constraint guards against concurrent per-company race collisions (also P2002 →
 * SEQUENCE_CONFLICT). When no company is linked, `companyProjectNumber` is left null.
 *
 * Also verifies `externalCompanyId` (if given) belongs to the session's org before
 * inserting, to prevent cross-tenant references.
 *
 * Throws { code: "SEQUENCE_CONFLICT" } on a projectNumber or companyProjectNumber
 * race collision, or { code: "INVALID_EXTERNAL_COMPANY" } if externalCompanyId
 * doesn't resolve within the org. All other errors propagate to the caller.
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

      // Org-wide sequence number (existing pattern)
      const orgMax = await tx.project.aggregate({
        where: { organizationId: session.organizationId },
        _max: { projectNumber: true },
      });
      const projectNumber = (orgMax._max.projectNumber ?? 0) + 1;

      // Per-company sequence number — only when a company is linked
      let companyProjectNumber: number | null = null;
      if (resolvedExternalCompanyId) {
        const companyMax = await tx.project.aggregate({
          where: { externalCompanyId: resolvedExternalCompanyId },
          _max: { companyProjectNumber: true },
        });
        companyProjectNumber = (companyMax._max.companyProjectNumber ?? 0) + 1;
      }

      return tx.project.create({
        data: {
          organizationId: session.organizationId,
          createdByUserId: session.userId,
          projectNumber,
          companyProjectNumber,
          name: input.name,
          destinationCountry: input.destinationCountry,
          currency: input.currency,
          projectLocation: input.projectLocation ?? null,
          status: input.status,
          externalCompanyId: resolvedExternalCompanyId,
          // Stage 14 Batch A — extended intake fields
          submissionDate: input.submissionDate ?? null,
          projectDeadline: input.projectDeadline ?? null,
          projectBudget: input.projectBudget ?? null,
          mainContractorName: input.mainContractorName ?? null,
          interiorContractorName: input.interiorContractorName ?? null,
          mainConsultantName: input.mainConsultantName ?? null,
          interiorConsultantName: input.interiorConsultantName ?? null,
          endClientName: input.endClientName ?? null,
          endClientPhone: input.endClientPhone ?? null,
          endClientEmail: input.endClientEmail ?? null,
          endClientAddressLine1: input.endClientAddressLine1 ?? null,
          endClientAddressLine2: input.endClientAddressLine2 ?? null,
          endClientCity: input.endClientCity ?? null,
          endClientState: input.endClientState ?? null,
          endClientGstNumber: input.endClientGstNumber ?? null,
        },
      });
    });
  } catch (err) {
    // P2002 on (organizationId, projectNumber) or (externalCompanyId, companyProjectNumber)
    // = concurrent race collision on either sequence
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

/**
 * Update editable fields on an existing project.
 *
 * Only DRAFT projects are editable — callers must check status before calling,
 * but this function also enforces it server-side (returns null on wrong status
 * so the route handler can surface a 409).
 *
 * `externalCompanyId` is never included in the update — the field is locked for
 * the life of the record so the per-company sequence never needs recomputing.
 *
 * Tenancy: scoped by organizationId from the session — a project belonging to a
 * different org will not be found and null is returned.
 *
 * Returns the updated project, or null if the project does not exist, belongs to
 * a different org, or is not in DRAFT status.
 */
export async function updateProject(
  session: SessionData,
  projectId: string,
  input: UpdateProjectInput,
) {
  // Verify the project exists, belongs to this org, and is still DRAFT.
  const existing = await prisma.project.findFirst({
    where: { id: projectId, organizationId: session.organizationId },
    select: { id: true, status: true },
  });

  if (!existing) return null;
  if (existing.status !== "DRAFT") return { notEditable: true as const };

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.destinationCountry !== undefined
        ? { destinationCountry: input.destinationCountry }
        : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.projectLocation !== undefined
        ? { projectLocation: input.projectLocation }
        : {}),
      // Stage 14 Batch A — extended intake fields
      ...(input.submissionDate !== undefined ? { submissionDate: input.submissionDate } : {}),
      ...(input.projectDeadline !== undefined ? { projectDeadline: input.projectDeadline } : {}),
      ...(input.projectBudget !== undefined ? { projectBudget: input.projectBudget } : {}),
      ...(input.mainContractorName !== undefined ? { mainContractorName: input.mainContractorName } : {}),
      ...(input.interiorContractorName !== undefined ? { interiorContractorName: input.interiorContractorName } : {}),
      ...(input.mainConsultantName !== undefined ? { mainConsultantName: input.mainConsultantName } : {}),
      ...(input.interiorConsultantName !== undefined ? { interiorConsultantName: input.interiorConsultantName } : {}),
      ...(input.endClientName !== undefined ? { endClientName: input.endClientName } : {}),
      ...(input.endClientPhone !== undefined ? { endClientPhone: input.endClientPhone } : {}),
      ...(input.endClientEmail !== undefined ? { endClientEmail: input.endClientEmail } : {}),
      ...(input.endClientAddressLine1 !== undefined ? { endClientAddressLine1: input.endClientAddressLine1 } : {}),
      ...(input.endClientAddressLine2 !== undefined ? { endClientAddressLine2: input.endClientAddressLine2 } : {}),
      ...(input.endClientCity !== undefined ? { endClientCity: input.endClientCity } : {}),
      ...(input.endClientState !== undefined ? { endClientState: input.endClientState } : {}),
      ...(input.endClientGstNumber !== undefined ? { endClientGstNumber: input.endClientGstNumber } : {}),
    },
    include: {
      externalCompany: { select: { id: true, name: true } },
      createdBy: { select: { id: true, username: true } },
    },
  });

  return { project: updated };
}
