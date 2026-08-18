import { cache } from "react";
import { internalFetch } from "@/lib/internal-fetch";

/**
 * Shape returned by GET /api/v1/orgs/[orgSlug]/projects/[projectId].
 *
 * Matches the Prisma include in lib/data/projects.ts getProjectById():
 * project fields + externalCompany + createdBy.
 */
export interface ProjectDetail {
  id: string;
  organizationId: string;
  projectNumber: number;
  companyProjectNumber: number | null;
  name: string;
  destinationCountry: string;
  currency: string;
  projectLocation: string | null;
  inquiryId: string | null;
  /**
   * Human-readable display numbers from the linked Inquiry, if any.
   * Null when the project was created directly (not converted from an inquiry).
   * Format: INQ-{companyInquiryNumber} when available, else #{inquiryNumber}.
   */
  inquiry: { inquiryNumber: number; companyInquiryNumber: number | null } | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  externalCompanyId: string | null;
  createdByUserId: string;
  externalCompany: { id: string; name: string; country: "INDIA" | "UAE" } | null;
  createdBy: { id: string; username: string };
  // Stage 14 Batch C — extended intake fields (all nullable)
  submissionDate: string | null;
  projectDeadline: string | null;
  projectBudget: string | null;
  mainContractorName: string | null;
  interiorContractorName: string | null;
  mainConsultantName: string | null;
  interiorConsultantName: string | null;
  endClientName: string | null;
  endClientPhone: string | null;
  endClientEmail: string | null;
  endClientAddressLine1: string | null;
  endClientAddressLine2: string | null;
  endClientCity: string | null;
  endClientState: string | null;
  endClientGstNumber: string | null;
}

export interface ProjectFetchResult {
  /** HTTP status code from the API route (200, 401, 403, 404, 500, …). */
  status: number;
  /** Populated on 200; null on any error. */
  project: ProjectDetail | null;
}

/**
 * React.cache()-wrapped fetcher for the project detail API route.
 *
 * Both `layout.tsx` and `page.tsx` under /projects/[projectId]/* import and
 * call this function.  Because it is wrapped in React.cache(), multiple calls
 * within the same server render pass (layout + child page) produce only ONE
 * HTTP round-trip to the route handler — the result is memoized per render tree.
 *
 * Always resolves (never throws); callers branch on `status`:
 *   401 → redirect to login
 *   404 → notFound()
 *   200 → render with `project`
 */
export const fetchProjectDetail = cache(
  async (orgSlug: string, projectId: string): Promise<ProjectFetchResult> => {
    const res = await internalFetch(
      `/api/v1/orgs/${orgSlug}/projects/${projectId}`,
    );

    if (!res.ok) {
      return { status: res.status, project: null };
    }

    const body = (await res.json()) as { project: ProjectDetail };
    return { status: res.status, project: body.project };
  },
);
