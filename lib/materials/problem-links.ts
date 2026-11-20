/**
 * Problem popup "Go" link builder (Stage 25 Batch 9, Stage 37 Batch 3). PURE: no React, so it is unit-tested.
 * Returns the href for a problem's "Go" link, or null when the problem has no navigable locus.
 */
import type { CalculationProblem } from "@/lib/materials/problems";

export function orgPath(isSubdomain: boolean, orgSlug: string, subpath: string): string {
  return isSubdomain ? subpath : `/${orgSlug}${subpath}`;
}

export function resolveGoHref(
  problem: CalculationProblem,
  orgSlug: string,
  projectId: string,
  isSubdomain: boolean,
): string | null {
  switch (problem.scope) {
    case "DESIGN": {
      const partitionId = problem.locus?.partitionId;
      if (!partitionId) return null;
      return orgPath(isSubdomain, orgSlug, `/projects/${projectId}/design?partition=${partitionId}`);
    }
    case "SELECTION": {
      // selectionId present → has a navigable partition in locus
      const partitionId = problem.locus?.partitionId;
      const selectionId = problem.locus?.selectionId;
      if (!selectionId || !partitionId) return null;
      return orgPath(isSubdomain, orgSlug, `/projects/${projectId}/design?partition=${partitionId}`);
    }
    case "INVENTORY": {
      if (problem.kind === "UNRESOLVED_MATCH") {
        const typeCode = problem.locus?.componentTypeCode;
        return orgPath(isSubdomain, orgSlug, typeCode ? `/admin/inventory?type=${encodeURIComponent(typeCode)}` : "/admin/inventory");
      }
      if (!problem.code) return null;
      return orgPath(isSubdomain, orgSlug, "/admin/inventory");
    }
    case "FORMULA_SET":
      return null;
  }
}
