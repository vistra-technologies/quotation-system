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
  status: string;
  createdAt: string;
  updatedAt: string;
  externalCompanyId: string | null;
  createdByUserId: string;
  externalCompany: { id: string; name: string } | null;
  createdBy: { id: string; username: string };
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
