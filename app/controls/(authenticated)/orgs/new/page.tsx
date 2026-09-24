import Link from "next/link";
import { internalFetch } from "@/lib/internal-fetch";
import { CreateOrgForm } from "./create-org-form";
import type { FormulaSetListItem } from "@/lib/data/superadmin/formula-sets";
import type { FormulaSetPickerItem } from "../_formula-set-picker";

// Always render live — auth enforced by the guard layout.
export const dynamic = "force-dynamic";

/**
 * Create-org page (Server Component shell).
 *
 * Auth: enforced by app/controls/(authenticated)/layout.tsx — do not re-call
 * requireSuperAdmin() here.
 *
 * Fetches formula sets server-side and passes them to CreateOrgForm so the
 * two-step picker is populated without an extra client-side request.
 *
 * Stage 16 Batch C — F4; updated Stage 25 Batch 5.
 */
export default async function NewOrgPage() {
  // Fetch formula sets for the picker. On failure fall back to an empty list —
  // the form will still render (picker has no options) so the user can see the
  // error rather than a blank page.
  let formulaSets: FormulaSetPickerItem[] = [];
  try {
    const res = await internalFetch("/api/v1/superadmin/formula-sets");
    if (res.ok) {
      const data = (await res.json()) as {
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
    }
  } catch {
    // Silently fall back to empty list; the form will surface the "no options" state.
  }

  return (
    <div className="mx-auto max-w-lg">
      <Link
        href="/controls/orgs"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-text-heading"
      >
        ← Back to organizations
      </Link>

      <h1 className="mt-2 text-2xl font-bold text-text-heading">
        Create organization
      </h1>
      <p className="mt-1 text-sm text-text-muted">
        A new organization with default roles will be created immediately.
      </p>

      {formulaSets.length === 0 && (
        <div className="mt-4 rounded-sm border border-status-pending-border bg-status-pending-bg px-4 py-3">
          <p className="text-sm text-status-pending-text">
            No formula sets found. Create at least one formula set before creating an organization.
          </p>
        </div>
      )}

      <div className="mt-6 rounded-md border border-border bg-bg-card p-6 shadow-card">
        <CreateOrgForm formulaSets={formulaSets} />
      </div>
    </div>
  );
}
