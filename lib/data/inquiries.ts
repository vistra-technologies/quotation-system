import { prisma } from "@/lib/prisma";
import type { SessionData } from "@/lib/session";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreateInquiryInput {
  name: string;
  destinationCountry: string;
  currency: string;
  projectLocation?: string | null;
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

export interface UpdateInquiryInput {
  name?: string;
  destinationCountry?: string;
  currency?: string;
  projectLocation?: string | null;
  // externalCompanyId is intentionally excluded — it is locked for the life
  // of an Inquiry record so the per-company sequence number never needs
  // recomputing (see stage-13.md "Decisions made during scoping").
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

export interface ListInquiriesParams {
  /** "mine" = current user's own; "all" = scoped by role (see below). */
  scope: "mine" | "all";
  /** Full-text search across inquiry name and external company name. */
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
   * When set, narrows results to inquiries with this externalCompanyId, within
   * the session's org. Ignored for external users (they're already scoped to
   * their own company by the scope=all condition).
   */
  externalCompanyId?: string;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * List all inquiries for the session org, newest-first.
 * Includes externalCompany name (nullable) for the list table.
 *
 * @deprecated Use listInquiriesPaginated for all new callers.
 */
export async function listInquiries(session: SessionData) {
  return prisma.inquiry.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { createdAt: "desc" },
    include: {
      externalCompany: { select: { id: true, name: true } },
    },
  });
}

/**
 * Paginated, filtered inquiry list with RBAC visibility rules.
 *
 * Visibility rules (enforced server-side from session — never from URL params):
 *   scope="mine"  — always filters to createdByUserId = session.userId
 *   scope="all"   — external user (externalCompanyId != null): own company only
 *                 — internal user (externalCompanyId === null): full org scope
 *
 * Returns { inquiries, total } — total is the count before pagination, used
 * by the caller to compute page count.
 *
 * Tenancy: organizationId always scoped to session.organizationId.
 */
// Extract Prisma's InquiryWhereInput type without explicitly importing from @prisma/client.
// NonNullable strips the `| undefined` from the optional `where` property.
type InquiryWhereInput = NonNullable<
  NonNullable<Parameters<typeof prisma.inquiry.findMany>[0]>["where"]
>;

export async function listInquiriesPaginated(
  session: SessionData,
  params: ListInquiriesParams,
) {
  const { scope, search, dateFrom, dateTo, page, pageSize } = params;

  // Build AND conditions incrementally to keep the where clause type-safe
  // without explicitly importing Prisma namespace types.
  const andConditions: InquiryWhereInput[] = [
    { organizationId: session.organizationId },
  ];

  // Scope: my own vs. role-scoped "all"
  if (scope === "mine") {
    andConditions.push({ createdByUserId: session.userId });
  } else if (session.externalCompanyId !== null) {
    // External user: "all" = only their external company's inquiries.
    // Value from server-side session — cannot be spoofed by URL params.
    andConditions.push({ externalCompanyId: session.externalCompanyId });
  }
  // Internal user + scope=all: no extra condition — sees all org inquiries.

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

  const where: InquiryWhereInput = { AND: andConditions };

  const [total, inquiries] = await Promise.all([
    prisma.inquiry.count({ where }),
    prisma.inquiry.findMany({
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

  return { inquiries, total };
}

/**
 * Get a single inquiry by id, scoped to the session org (tenancy guard).
 * Returns null if not found or if it belongs to a different org.
 */
export async function getInquiryById(session: SessionData, inquiryId: string) {
  return prisma.inquiry.findFirst({
    where: { id: inquiryId, organizationId: session.organizationId },
    include: {
      externalCompany: { select: { id: true, name: true } },
      createdBy: { select: { id: true, username: true } },
    },
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Create a new inquiry scoped to the session org.
 *
 * `inquiryNumber` is assigned as MAX(inquiryNumber) + 1 within the org, inside a
 * transaction. The @@unique([organizationId, inquiryNumber]) DB constraint is the
 * real guard against concurrent creates duplicating a number — a P2002 on that
 * pair is surfaced as a { code: "SEQUENCE_CONFLICT" } error.
 *
 * When `externalCompanyId` is resolved to a non-null value, `companyInquiryNumber`
 * is additionally assigned as MAX(companyInquiryNumber) + 1 scoped to that company,
 * inside the same transaction. The @@unique([externalCompanyId, companyInquiryNumber])
 * DB constraint guards against concurrent per-company race collisions (also P2002 →
 * SEQUENCE_CONFLICT). When no company is linked, `companyInquiryNumber` is left null.
 *
 * Also verifies `externalCompanyId` (if given) belongs to the session's org before
 * inserting, to prevent cross-tenant references.
 *
 * Throws { code: "SEQUENCE_CONFLICT" } on an inquiryNumber or companyInquiryNumber
 * race collision, or { code: "INVALID_EXTERNAL_COMPANY" } if externalCompanyId
 * doesn't resolve within the org. All other errors propagate to the caller.
 */
export async function createInquiry(
  session: SessionData,
  input: CreateInquiryInput,
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
      const orgMax = await tx.inquiry.aggregate({
        where: { organizationId: session.organizationId },
        _max: { inquiryNumber: true },
      });
      const inquiryNumber = (orgMax._max.inquiryNumber ?? 0) + 1;

      // Per-company sequence number — only when a company is linked
      let companyInquiryNumber: number | null = null;
      if (resolvedExternalCompanyId) {
        const companyMax = await tx.inquiry.aggregate({
          where: { externalCompanyId: resolvedExternalCompanyId },
          _max: { companyInquiryNumber: true },
        });
        companyInquiryNumber = (companyMax._max.companyInquiryNumber ?? 0) + 1;
      }

      return tx.inquiry.create({
        data: {
          organizationId: session.organizationId,
          createdByUserId: session.userId,
          inquiryNumber,
          companyInquiryNumber,
          name: input.name,
          destinationCountry: input.destinationCountry,
          currency: input.currency,
          projectLocation: input.projectLocation ?? null,
          status: "NEW",
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
    // P2002 on (organizationId, inquiryNumber) or (externalCompanyId, companyInquiryNumber)
    // = concurrent race collision on either sequence
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      throw Object.assign(new Error("Inquiry number conflict — please try again."), {
        code: "SEQUENCE_CONFLICT",
      });
    }
    throw err;
  }
}

/**
 * Update editable fields on an inquiry.
 *
 * Only inquiries with status === "NEW" are editable.
 * Throws { code: "NOT_FOUND" } if the inquiry doesn't exist or belongs to a
 * different org. Throws { code: "NOT_EDITABLE" } if status !== "NEW".
 *
 * `externalCompanyId` is never touched — it is locked for the life of the
 * record (see stage-13.md "Decisions made during scoping").
 */
export async function updateInquiry(
  session: SessionData,
  inquiryId: string,
  input: UpdateInquiryInput,
) {
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, organizationId: session.organizationId },
    select: { id: true, status: true },
  });

  if (!inquiry) {
    throw Object.assign(new Error("Inquiry not found."), { code: "NOT_FOUND" });
  }
  if (inquiry.status !== "NEW") {
    throw Object.assign(
      new Error("Only NEW inquiries can be edited."),
      { code: "NOT_EDITABLE" },
    );
  }

  // Build the update data from only the provided (non-undefined) fields.
  // externalCompanyId is explicitly excluded.
  const data: {
    name?: string;
    destinationCountry?: string;
    currency?: string;
    projectLocation?: string | null;
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
  } = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.destinationCountry !== undefined)
    data.destinationCountry = input.destinationCountry;
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.projectLocation !== undefined)
    data.projectLocation = input.projectLocation;
  // Stage 14 Batch A — extended intake fields
  if (input.submissionDate !== undefined) data.submissionDate = input.submissionDate;
  if (input.projectDeadline !== undefined) data.projectDeadline = input.projectDeadline;
  if (input.projectBudget !== undefined) data.projectBudget = input.projectBudget;
  if (input.mainContractorName !== undefined) data.mainContractorName = input.mainContractorName;
  if (input.interiorContractorName !== undefined) data.interiorContractorName = input.interiorContractorName;
  if (input.mainConsultantName !== undefined) data.mainConsultantName = input.mainConsultantName;
  if (input.interiorConsultantName !== undefined) data.interiorConsultantName = input.interiorConsultantName;
  if (input.endClientName !== undefined) data.endClientName = input.endClientName;
  if (input.endClientPhone !== undefined) data.endClientPhone = input.endClientPhone;
  if (input.endClientEmail !== undefined) data.endClientEmail = input.endClientEmail;
  if (input.endClientAddressLine1 !== undefined) data.endClientAddressLine1 = input.endClientAddressLine1;
  if (input.endClientAddressLine2 !== undefined) data.endClientAddressLine2 = input.endClientAddressLine2;
  if (input.endClientCity !== undefined) data.endClientCity = input.endClientCity;
  if (input.endClientState !== undefined) data.endClientState = input.endClientState;
  if (input.endClientGstNumber !== undefined) data.endClientGstNumber = input.endClientGstNumber;

  return prisma.inquiry.update({
    where: { id: inquiryId },
    data,
    include: {
      externalCompany: { select: { id: true, name: true } },
    },
  });
}

/**
 * Dismiss an inquiry: set status → "DISMISSED".
 *
 * Tenancy guard via findFirst. Throws { code: "ALREADY_CLOSED" } if the inquiry
 * is already DISMISSED or CONVERTED (idempotency guard). Throws { code: "NOT_FOUND" }
 * if the inquiry doesn't exist or belongs to a different org.
 */
export async function dismissInquiry(session: SessionData, inquiryId: string) {
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, organizationId: session.organizationId },
    select: { id: true, status: true },
  });

  if (!inquiry) {
    throw Object.assign(new Error("Inquiry not found."), { code: "NOT_FOUND" });
  }
  if (inquiry.status === "DISMISSED" || inquiry.status === "CONVERTED") {
    throw Object.assign(new Error("Inquiry is already closed."), {
      code: "ALREADY_CLOSED",
    });
  }

  return prisma.inquiry.update({
    where: { id: inquiryId },
    data: { status: "DISMISSED" },
  });
}

/**
 * Convert an inquiry into a Project.
 *
 * Runs as a single `$transaction`:
 *   1. Fetch + tenancy-guard the inquiry (must be NEW).
 *   2. MAX+1 `projectNumber` for the org (inlined from createProject pattern to
 *      keep the entire operation in one atomic transaction).
 *   3. If the inquiry has a linked company, MAX+1 `companyProjectNumber` scoped
 *      to that company — independently assigned for the new Project (not copied
 *      from the Inquiry's companyInquiryNumber, which is a different sequence).
 *   4. Create the Project with the inquiry's fields + `inquiryId`.
 *   5. Flip `Inquiry.status → "CONVERTED"`.
 *
 * Returns the newly created Project.
 *
 * Throws { code: "NOT_FOUND" } if the inquiry doesn't exist or is from another org.
 * Throws { code: "ALREADY_CLOSED" } if already DISMISSED or CONVERTED.
 * Throws { code: "SEQUENCE_CONFLICT" } on a concurrent projectNumber or
 * companyProjectNumber P2002.
 */
export async function convertInquiryToProject(
  session: SessionData,
  inquiryId: string,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      // Step 1: fetch + tenancy guard
      const inquiry = await tx.inquiry.findFirst({
        where: { id: inquiryId, organizationId: session.organizationId },
      });
      if (!inquiry) {
        throw Object.assign(new Error("Inquiry not found."), { code: "NOT_FOUND" });
      }
      if (inquiry.status === "DISMISSED" || inquiry.status === "CONVERTED") {
        throw Object.assign(new Error("Inquiry is already closed."), {
          code: "ALREADY_CLOSED",
        });
      }

      // Step 2: MAX+1 projectNumber for this org (mirrors createProject pattern)
      const orgMax = await tx.project.aggregate({
        where: { organizationId: session.organizationId },
        _max: { projectNumber: true },
      });
      const projectNumber = (orgMax._max.projectNumber ?? 0) + 1;

      // Step 3: per-company sequence number for the new Project — independently assigned,
      // not copied from the Inquiry's companyInquiryNumber (those are separate sequences).
      let companyProjectNumber: number | null = null;
      if (inquiry.externalCompanyId) {
        const companyMax = await tx.project.aggregate({
          where: { externalCompanyId: inquiry.externalCompanyId },
          _max: { companyProjectNumber: true },
        });
        companyProjectNumber = (companyMax._max.companyProjectNumber ?? 0) + 1;
      }

      // Step 4: create the Project populated from the Inquiry's fields
      const project = await tx.project.create({
        data: {
          organizationId: session.organizationId,
          createdByUserId: session.userId,
          projectNumber,
          companyProjectNumber,
          name: inquiry.name,
          destinationCountry: inquiry.destinationCountry,
          currency: inquiry.currency,
          projectLocation: inquiry.projectLocation ?? null,
          status: "DRAFT",
          externalCompanyId: inquiry.externalCompanyId ?? null,
          inquiryId: inquiry.id,
          // Stage 14 Batch A — propagate all extended intake fields from Inquiry to Project
          submissionDate: inquiry.submissionDate ?? null,
          projectDeadline: inquiry.projectDeadline ?? null,
          projectBudget: inquiry.projectBudget ?? null,
          mainContractorName: inquiry.mainContractorName ?? null,
          interiorContractorName: inquiry.interiorContractorName ?? null,
          mainConsultantName: inquiry.mainConsultantName ?? null,
          interiorConsultantName: inquiry.interiorConsultantName ?? null,
          endClientName: inquiry.endClientName ?? null,
          endClientPhone: inquiry.endClientPhone ?? null,
          endClientEmail: inquiry.endClientEmail ?? null,
          endClientAddressLine1: inquiry.endClientAddressLine1 ?? null,
          endClientAddressLine2: inquiry.endClientAddressLine2 ?? null,
          endClientCity: inquiry.endClientCity ?? null,
          endClientState: inquiry.endClientState ?? null,
          endClientGstNumber: inquiry.endClientGstNumber ?? null,
        },
      });

      // Step 5: mark the inquiry as converted
      await tx.inquiry.update({
        where: { id: inquiryId },
        data: { status: "CONVERTED" },
      });

      return project;
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
