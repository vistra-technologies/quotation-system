import { cache } from "react";
import { getOrgForEdit } from "@/lib/data/superadmin/orgs";

/**
 * The workspace org, loaded once per request.
 *
 * orgs/[orgId]/layout.tsx and the overview / formula pages all need the same row; React's
 * cache() dedupes the three calls inside one render pass, so the DB is read once.
 */
export const loadWorkspaceOrg = cache((orgId: string) => getOrgForEdit(orgId));
