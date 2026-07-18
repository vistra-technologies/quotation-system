import { prisma } from "@/lib/prisma";
import type { SessionData } from "@/lib/session";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreateInquiryInput {
  name: string;
  destinationCountry: string;
  currency: string;
  externalCompanyId?: string | null;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * List all inquiries for the session org, newest-first.
 * Includes externalCompany name (nullable) for the list table.
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
 * Also verifies `externalCompanyId` (if given) belongs to the session's org before
 * inserting, to prevent cross-tenant references.
 *
 * Throws { code: "SEQUENCE_CONFLICT" } on an inquiryNumber race collision, or
 * { code: "INVALID_EXTERNAL_COMPANY" } if externalCompanyId doesn't resolve within
 * the org. All other errors propagate to the caller.
 */
export async function createInquiry(
  session: SessionData,
  input: CreateInquiryInput,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      if (input.externalCompanyId) {
        const company = await tx.externalCompany.findFirst({
          where: { id: input.externalCompanyId, organizationId: session.organizationId },
          select: { id: true },
        });
        if (!company) {
          throw Object.assign(new Error("External company not found."), {
            code: "INVALID_EXTERNAL_COMPANY",
          });
        }
      }

      const max = await tx.inquiry.aggregate({
        where: { organizationId: session.organizationId },
        _max: { inquiryNumber: true },
      });
      const inquiryNumber = (max._max.inquiryNumber ?? 0) + 1;

      return tx.inquiry.create({
        data: {
          organizationId: session.organizationId,
          createdByUserId: session.userId,
          inquiryNumber,
          name: input.name,
          destinationCountry: input.destinationCountry,
          currency: input.currency,
          status: "NEW",
          externalCompanyId: input.externalCompanyId ?? null,
        },
      });
    });
  } catch (err) {
    // P2002 on (organizationId, inquiryNumber) = concurrent race collision
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
 *   3. Create the Project with the inquiry's 4 fields + `inquiryId`.
 *   4. Flip `Inquiry.status → "CONVERTED"`.
 *
 * Returns the newly created Project.
 *
 * Throws { code: "NOT_FOUND" } if the inquiry doesn't exist or is from another org.
 * Throws { code: "ALREADY_CLOSED" } if already DISMISSED or CONVERTED.
 * Throws { code: "SEQUENCE_CONFLICT" } on a concurrent projectNumber P2002.
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
      const max = await tx.project.aggregate({
        where: { organizationId: session.organizationId },
        _max: { projectNumber: true },
      });
      const projectNumber = (max._max.projectNumber ?? 0) + 1;

      // Step 3: create the Project populated from the Inquiry's fields
      const project = await tx.project.create({
        data: {
          organizationId: session.organizationId,
          createdByUserId: session.userId,
          projectNumber,
          name: inquiry.name,
          destinationCountry: inquiry.destinationCountry,
          currency: inquiry.currency,
          status: "DRAFT",
          externalCompanyId: inquiry.externalCompanyId ?? null,
          inquiryId: inquiry.id,
        },
      });

      // Step 4: mark the inquiry as converted
      await tx.inquiry.update({
        where: { id: inquiryId },
        data: { status: "CONVERTED" },
      });

      return project;
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
