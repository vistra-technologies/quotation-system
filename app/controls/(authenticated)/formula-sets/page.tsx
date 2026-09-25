import Link from "next/link";
import { internalFetch } from "@/lib/internal-fetch";
import { NewSetSection } from "./_new-set-section";
import { DeleteFormulaSetButton } from "./_delete-button";
import type { FormulaSetListItem } from "@/lib/data/superadmin/formula-sets";

// Always render live — reads the SuperAdminSession table (via guard layout) and live DB.
export const dynamic = "force-dynamic";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * SuperAdmin Formula Sets list page (Server Component).
 *
 * Renders a table of all formula sets (newest first) with status pill, in-use
 * breakdown chips, and Edit/View action links. Below the table is an inline
 * "Create new formula set" form (name + JSON body, no version field — version
 * is auto-computed by the API).
 *
 * Auth: enforced by app/controls/(authenticated)/layout.tsx.
 *
 * Stage 25 Batch 4 — Formula Sets SuperAdmin screens.
 */
export default async function FormulaSetsPage() {
  const res = await internalFetch("/api/v1/superadmin/formula-sets");

  if (!res.ok) {
    return (
      <p className="p-8 text-center text-sm text-status-failed-text">
        Failed to load formula sets — please refresh.
      </p>
    );
  }

  // The API returns FormulaSetListItem[] — serialized, so dates are strings.
  const { formulaSets } = (await res.json()) as {
    formulaSets: (Omit<FormulaSetListItem, "publishedAt" | "createdAt"> & {
      publishedAt: string | null;
      createdAt: string;
    })[];
  };

  // Unique names for the datalist autocomplete in the create form.
  const existingNames = [...new Set(formulaSets.map((fs) => fs.name))].sort();

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-heading">Formula Sets</h1>
          <p className="mt-1 text-sm text-text-muted">
            Author and manage formula sets used to compute material quantities from project
            partition designs. Assign formula sets to organizations on their create or edit pages.
          </p>
        </div>
        {/* Anchor to the create form below */}
        <a
          href="#create-form"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-sm bg-primary px-4 py-2.5 text-sm font-bold text-text-on-primary hover:bg-primary-dark"
        >
          + New Formula Set
        </a>
      </div>

      {/* ── Section header ── */}
      <div className="mt-8">
        <h2 className="text-base font-extrabold text-text-heading">All Formula Sets</h2>
        <p className="mt-0.5 text-xs text-text-muted">
          Newest first. Body JSON is only loaded in the detail view.
        </p>
      </div>

      {/* ── Table ── */}
      {formulaSets.length > 0 ? (
        <div className="mt-3 overflow-hidden rounded-md border border-border bg-bg-card shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-5 py-3.5 text-left text-xs font-extrabold uppercase tracking-wider text-text-muted">
                    Name
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-extrabold uppercase tracking-wider text-text-muted">
                    Version
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-extrabold uppercase tracking-wider text-text-muted">
                    Status
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-extrabold uppercase tracking-wider text-text-muted">
                    In use by
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-extrabold uppercase tracking-wider text-text-muted">
                    Created
                  </th>
                  <th className="px-5 py-3.5 text-right text-xs font-extrabold uppercase tracking-wider text-text-muted">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {formulaSets.map((fs) => (
                  <tr key={fs.id} className="hover:bg-primary-softer/20">
                    <td className="px-5 py-4 font-bold text-text-heading">{fs.name}</td>
                    <td className="px-5 py-4">
                      <span className="rounded-sm bg-bg-subtle px-1.5 py-0.5 font-mono text-xs font-bold text-text-heading">
                        v{fs.version}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {fs.locked ? (
                        <span className="rounded-full bg-status-failed-bg px-2 py-0.5 text-xs font-bold text-status-failed-text">
                          Locked
                        </span>
                      ) : (
                        <span className="rounded-full bg-status-success-bg px-2 py-0.5 text-xs font-bold text-status-success-text">
                          Unlocked
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        <InUseChip count={fs.inUseBy.orgCount} label="org" active={fs.inUseBy.orgCount > 0} />
                        <InUseChip count={fs.inUseBy.projectCount} label="project" active={fs.inUseBy.projectCount > 0} />
                        <InUseChip count={fs.inUseBy.calculationCount} label="calc" active={fs.inUseBy.calculationCount > 0} />
                      </div>
                    </td>
                    <td className="px-5 py-4 text-xs text-text-muted">
                      {formatDate(fs.createdAt)}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-4">
                        <Link
                          href={`/controls/formula-sets/${encodeURIComponent(fs.id)}`}
                          className="text-sm font-bold text-primary hover:text-primary-dark"
                        >
                          {fs.locked ? "View" : "Edit"}
                        </Link>
                        {/* Hotfix 2026-09-25 H-1: delete only offered for unused sets. */}
                        {!fs.locked && (
                          <DeleteFormulaSetButton
                            setId={fs.id}
                            name={fs.name}
                            version={fs.version}
                            variant="link"
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-text-muted">
          No formula sets yet. Create the first one below.
        </p>
      )}

      {/* ── Create form (always visible below table) ── */}
      <NewSetSection existingNames={existingNames} />
    </div>
  );
}

// ─── In-use chip ──────────────────────────────────────────────────────────────

function InUseChip({ count, label, active }: { count: number; label: string; active: boolean }) {
  const plural = count !== 1 ? "s" : "";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-bold ${
        active
          ? "bg-[#C7EFFF] text-[#0B6E99]"
          : "bg-bg-subtle text-text-muted"
      }`}
    >
      {count} {label}{plural}
    </span>
  );
}
