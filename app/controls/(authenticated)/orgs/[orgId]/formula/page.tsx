import { notFound } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { compatResultToWarnings } from "@/lib/data/superadmin/orgs";
import type { FormulaSetListItem } from "@/lib/data/superadmin/formula-sets";
import type { FormulaSetPickerItem } from "../../_formula-set-picker";
import { loadWorkspaceOrg } from "../_org";
import { FormulaForm } from "./formula-form";

// Always render live — computed mismatch state must be fresh every load.
export const dynamic = "force-dynamic";

/**
 * Workspace Formula & Pricing tab (Server Component).
 *
 * The org's formula-set assignment and its (computed, never stored) mismatch state — nothing else.
 *
 * Auth: enforced by app/controls/(authenticated)/layout.tsx.
 *
 * Moved from orgs/[orgId]/page.tsx (Stage 25 Batch 5) in Stage 29 Batch 1.
 */
export default async function OrgFormulaPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  // Load org detail and formula sets in parallel.
  const [org, formulaSetsRes] = await Promise.all([
    loadWorkspaceOrg(orgId),
    internalFetch("/api/v1/superadmin/formula-sets"),
  ]);

  if (!org) notFound();

  let formulaSets: FormulaSetPickerItem[] = [];
  if (formulaSetsRes.ok) {
    try {
      const data = (await formulaSetsRes.json()) as {
        formulaSets: (Omit<FormulaSetListItem, "publishedAt" | "createdAt"> & {
          publishedAt: string | null;
          createdAt: string;
        })[];
      };
      formulaSets = data.formulaSets.map((fs) => ({
        id: fs.id,
        name: fs.name,
        version: fs.version,
        locked: fs.locked,
      }));
    } catch {
      // Fall back to empty — picker will show no options
    }
  }

  // Compute initial mismatch warnings from the server-loaded data.
  const initialMismatches = compatResultToWarnings(
    org.mismatch,
    org.activeFormulaSet?.name ?? "",
    org.activeFormulaSet?.version ?? 0,
  );

  return (
    <FormulaForm
      orgId={org.id}
      activeFormulaSetId={org.activeFormulaSetId}
      formulaSets={formulaSets}
      initialMismatches={initialMismatches}
    />
  );
}
