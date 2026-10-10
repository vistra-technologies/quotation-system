import type { SessionData } from "@/lib/session";

/**
 * Company-ownership scope for Project / Inquiry `where` clauses (Hotfix 2026-10-05, HF-3).
 *
 * - internal user            -> whole org
 * - external, has a company  -> that company only
 * - external, no company     -> matches nothing (fail closed; company was deleted)
 *
 * "External" comes from the role (session.isExternal), never from the company id.
 * These helpers MUST NOT emit an `id` key, so callers can spread them next to
 * `{ id }` without the id being overwritten.
 */
type OwnedWhere = { organizationId: string; externalCompanyId?: string | { in: never[] } };

function owned(session: SessionData): OwnedWhere {
  if (!session.isExternal) return { organizationId: session.organizationId };
  if (session.externalCompanyId === null) {
    return { organizationId: session.organizationId, externalCompanyId: { in: [] } };
  }
  return { organizationId: session.organizationId, externalCompanyId: session.externalCompanyId };
}

export function ownedProjectWhere(session: SessionData): OwnedWhere {
  return owned(session);
}

export function ownedInquiryWhere(session: SessionData): OwnedWhere {
  return owned(session);
}

/**
 * `where` fragment matching Project/Inquiry rows an EXTERNAL user of `companyId` could NOT access
 * (Stage 31 S31-4a, reassign-work): rows of another company or of no company. A target with no
 * company can access nothing, so every row is "outside" (empty fragment).
 */
export function recordsOutsideCompanyWhere(companyId: string | null) {
  if (companyId === null) return {};
  return { OR: [{ externalCompanyId: null }, { externalCompanyId: { not: companyId } }] };
}
