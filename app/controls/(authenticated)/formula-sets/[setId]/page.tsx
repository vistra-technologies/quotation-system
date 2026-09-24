import Link from "next/link";
import { internalFetch } from "@/lib/internal-fetch";
import { EditFormulaSetForm } from "./_edit-form";
import { NewVersionButton } from "./_new-version-button";
import type { FormulaSetDetail } from "@/lib/data/superadmin/formula-sets";

// Always render live — reads the SuperAdminSession table (via guard layout) and live DB.
export const dynamic = "force-dynamic";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * SuperAdmin Formula Set detail page (Server Component).
 *
 * For an unlocked set: renders an editable form (name, version shown read-only,
 * JSON textarea) with inline validation errors.
 *
 * For a locked set: renders read-only fields (disabled inputs + <pre> JSON
 * display) with a "Create new version" primary button.
 *
 * Auth: enforced by app/controls/(authenticated)/layout.tsx.
 *
 * Stage 25 Batch 4 — Formula Sets SuperAdmin screens.
 */
export default async function FormulaSetDetailPage({
  params,
}: {
  params: Promise<{ setId: string }>;
}) {
  const { setId } = await params;

  const res = await internalFetch(`/api/v1/superadmin/formula-sets/${encodeURIComponent(setId)}`);

  if (res.status === 404) {
    return (
      <div>
        <Link
          href="/controls/formula-sets"
          className="mb-5 inline-flex items-center gap-1 text-sm font-semibold text-text-muted hover:text-text-heading"
        >
          ← Back to Formula Sets
        </Link>
        <p className="mt-4 text-sm text-status-failed-text">Formula set not found.</p>
      </div>
    );
  }

  if (!res.ok) {
    return (
      <p className="p-8 text-center text-sm text-status-failed-text">
        Failed to load formula set — please refresh.
      </p>
    );
  }

  // API returns FormulaSetDetail — serialized, so dates are strings.
  const { formulaSet } = (await res.json()) as {
    formulaSet: Omit<FormulaSetDetail, "publishedAt" | "createdAt" | "updatedAt"> & {
      publishedAt: string | null;
      createdAt: string;
      updatedAt: string;
    };
  };

  const bodyJson = JSON.stringify(formulaSet.body, null, 2);

  return (
    <div>
      {/* ── Back link ── */}
      <Link
        href="/controls/formula-sets"
        className="mb-5 inline-flex items-center gap-1 text-sm font-semibold text-text-muted hover:text-text-heading"
      >
        ← Back to Formula Sets
      </Link>

      {/* ── Section header ── */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-baseline gap-2 text-xl font-extrabold text-text-heading">
            {formulaSet.name}
            <span className="rounded-sm bg-bg-subtle px-1.5 py-0.5 font-mono text-sm font-bold text-text-muted">
              v{formulaSet.version}
            </span>
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {formulaSet.locked
              ? "Read-only — this set is in use."
              : "Unlocked — editable in place."}
          </p>
        </div>
        {/* "Create new version" CTA visible in header for locked sets */}
        {formulaSet.locked && (
          <NewVersionButton setId={formulaSet.id} currentVersion={formulaSet.version} />
        )}
      </div>

      {/* ── Locked banner ── */}
      {formulaSet.locked && (
        <div className="mb-5 flex items-start gap-3 rounded-sm border border-status-failed-border bg-status-failed-bg px-4 py-3 text-sm font-semibold text-status-failed-text">
          <span aria-hidden="true" className="mt-0.5 shrink-0">🔒</span>
          <div>
            <strong className="block font-extrabold">
              This formula set is locked and cannot be edited.
            </strong>
            <p className="mt-0.5 text-xs opacity-90">
              It is currently assigned to {formulaSet.inUseBy.orgCount} organization
              {formulaSet.inUseBy.orgCount !== 1 ? "s" : ""} and referenced by{" "}
              {formulaSet.inUseBy.projectCount} project
              {formulaSet.inUseBy.projectCount !== 1 ? "s" : ""} and{" "}
              {formulaSet.inUseBy.calculationCount} calculation
              {formulaSet.inUseBy.calculationCount !== 1 ? "s" : ""}.
              To make changes, create a new version — the existing records will keep
              their pinned version.
            </p>
          </div>
        </div>
      )}

      {/* ── Metadata strip ── */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        <MetaItem label="Status">
          {formulaSet.locked ? (
            <span className="rounded-full bg-status-failed-bg px-2 py-0.5 text-xs font-bold text-status-failed-text">
              Locked
            </span>
          ) : (
            <span className="rounded-full bg-status-success-bg px-2 py-0.5 text-xs font-bold text-status-success-text">
              Unlocked
            </span>
          )}
        </MetaItem>
        <MetaItem label="In use by">
          {formulaSet.locked ? (
            <div className="flex flex-wrap gap-1 pt-0.5">
              <InUseChip count={formulaSet.inUseBy.orgCount} label="org" />
              <InUseChip count={formulaSet.inUseBy.projectCount} label="project" />
              <InUseChip count={formulaSet.inUseBy.calculationCount} label="calc" />
            </div>
          ) : (
            <span className="text-sm font-bold text-text-heading">—</span>
          )}
        </MetaItem>
        <MetaItem label="Created">
          <span className="text-sm font-bold text-text-heading">
            {formatDate(formulaSet.createdAt)}
          </span>
        </MetaItem>
        <MetaItem
          label={formulaSet.publishedAt ? "Published" : "Last updated"}
        >
          <span className="text-sm font-bold text-text-heading">
            {formulaSet.publishedAt
              ? formatDate(formulaSet.publishedAt)
              : formatDate(formulaSet.updatedAt)}
          </span>
        </MetaItem>
      </div>

      {/* ── Unlocked: editable form ── */}
      {!formulaSet.locked && (
        <EditFormulaSetForm
          setId={formulaSet.id}
          initialName={formulaSet.name}
          version={formulaSet.version}
          initialBodyJson={bodyJson}
        />
      )}

      {/* ── Locked: read-only card ── */}
      {formulaSet.locked && (
        <div className="rounded-md border border-border bg-bg-card px-5 py-5 shadow-card">
          {/* Name + Version row — disabled inputs */}
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-extrabold uppercase tracking-wider text-text-muted">
                Name
              </label>
              <input
                type="text"
                value={formulaSet.name}
                disabled
                className="w-full rounded-sm border border-border bg-bg-subtle px-3 py-2 text-sm text-text-muted"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-extrabold uppercase tracking-wider text-text-muted">
                Version
              </label>
              <input
                type="text"
                value={`v${formulaSet.version}`}
                disabled
                className="w-full max-w-[120px] rounded-sm border border-border bg-bg-subtle px-3 py-2 text-sm text-text-muted"
              />
            </div>
          </div>

          {/* Body — read-only <pre> */}
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-extrabold uppercase tracking-wider text-text-muted">
              Formula Set Body (JSON)
            </label>
            <pre className="max-h-96 overflow-auto rounded-sm border border-border bg-bg-subtle p-4 font-mono text-xs text-text-muted" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {bodyJson}
            </pre>
            <p className="mt-1.5 text-xs text-text-muted">
              This body is read-only. To modify it, create a new version above.
            </p>
          </div>

          {/* Footer: only "Create new version", no Save */}
          <div className="flex items-center gap-3 border-t border-border pt-5">
            <NewVersionButton setId={formulaSet.id} currentVersion={formulaSet.version} />
            <Link
              href="/controls/formula-sets"
              className="rounded-sm border border-border bg-bg-white px-4 py-2.5 text-sm font-bold text-text-body hover:bg-primary-softer"
            >
              Back to list
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-extrabold uppercase tracking-[.05em] text-text-muted">
        {label}
      </p>
      {children}
    </div>
  );
}

function InUseChip({ count, label }: { count: number; label: string }) {
  const plural = count !== 1 ? "s" : "";
  return (
    <span className="rounded-full bg-[#C7EFFF] px-2 py-0.5 text-xs font-bold text-[#0B6E99]">
      {count} {label}{plural}
    </span>
  );
}
