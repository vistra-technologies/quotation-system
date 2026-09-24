import Link from "next/link";
import { notFound } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { getOrgForEdit } from "@/lib/data/superadmin/orgs";
import { compatResultToWarnings } from "@/lib/data/superadmin/orgs";
import type { FormulaSetListItem } from "@/lib/data/superadmin/formula-sets";
import type { FormulaSetPickerItem } from "../_formula-set-picker";
import { MismatchChip } from "../_mismatch-chip";
import { EditOrgForm } from "./edit-org-form";

// Always render live — computed mismatch state must be fresh every load.
export const dynamic = "force-dynamic";

interface OrgEditPageProps {
  params: Promise<{ orgId: string }>;
}

/**
 * SuperAdmin org edit page (Server Component).
 *
 * Allows editing an org's name and formula-set assignment (S25-12).
 * Slug is shown read-only (it is the subdomain — cannot be changed).
 * Computes the current formula-set mismatch on every render (not stored).
 * Suspend/reactivate controls coexist on this page.
 *
 * Auth: enforced by app/controls/(authenticated)/layout.tsx.
 *
 * Stage 25 Batch 5.
 */
export default async function OrgEditPage({ params }: OrgEditPageProps) {
  const { orgId } = await params;

  // Load org detail and formula sets in parallel.
  const [org, formulaSetsRes] = await Promise.all([
    getOrgForEdit(orgId),
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
  const hasMismatch = initialMismatches.length > 0;

  return (
    <div className="mx-auto max-w-lg">
      <Link
        href="/controls/orgs"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-text-heading"
      >
        ← Back to organizations
      </Link>

      {/* ── Page header ── */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold text-text-heading">
            Edit — {org.name}
            {hasMismatch && <MismatchChip show />}
          </h1>
          <p className="mt-1.5">
            <span className="rounded-sm bg-[rgba(27,40,30,0.06)] px-1.5 py-0.5 font-mono text-xs text-text-muted">
              {org.slug}.easeetool.com
            </span>
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-xs font-bold ${
            org.isSuspended
              ? "bg-status-failed-bg text-status-failed-text"
              : "bg-status-paid-bg text-status-paid-text"
          }`}
        >
          {org.isSuspended ? "Suspended" : "Active"}
        </span>
      </div>

      <EditOrgForm
        orgId={org.id}
        initialName={org.name}
        slug={org.slug}
        isSuspended={org.isSuspended}
        activeFormulaSetId={org.activeFormulaSetId}
        formulaSets={formulaSets}
        initialMismatches={initialMismatches}
      />
    </div>
  );
}
