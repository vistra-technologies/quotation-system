import Link from "next/link";
import { internalFetch } from "@/lib/internal-fetch";
import { EditFormulaSetForm } from "../_edit-form";
import type { FormulaSetDetail, FormulaSetListItem } from "@/lib/data/superadmin/formula-sets";

// Always render live — reads the SuperAdminSession table (via guard layout) and live DB.
export const dynamic = "force-dynamic";

/**
 * SuperAdmin "new version" draft page (Server Component).
 *
 * Hotfix 2026-09-25 (H-4): opening this page writes nothing. It shows an edit
 * form pre-filled with the source set's body, labelled as an unsaved draft of
 * the next version. Save POSTs a new row under the same name (the API assigns
 * MAX(version)+1); Cancel or navigating away creates nothing.
 *
 * Auth: enforced by app/controls/(authenticated)/layout.tsx.
 */
export default async function NewFormulaSetVersionPage({
  params,
}: {
  params: Promise<{ setId: string }>;
}) {
  const { setId } = await params;
  const detailHref = `/controls/formula-sets/${encodeURIComponent(setId)}`;

  const [res, listRes] = await Promise.all([
    internalFetch(`/api/v1/superadmin/formula-sets/${encodeURIComponent(setId)}`),
    internalFetch("/api/v1/superadmin/formula-sets"),
  ]);

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

  if (!res.ok || !listRes.ok) {
    return (
      <p className="p-8 text-center text-sm text-status-failed-text">
        Failed to load formula set — please refresh.
      </p>
    );
  }

  const { formulaSet } = (await res.json()) as { formulaSet: Pick<FormulaSetDetail, "name" | "version" | "body"> };
  const { formulaSets } = (await listRes.json()) as {
    formulaSets: Pick<FormulaSetListItem, "name" | "version">[];
  };

  // Display only — the real number is assigned by the API at save time.
  const nextVersion =
    Math.max(
      formulaSet.version,
      ...formulaSets.filter((fs) => fs.name === formulaSet.name).map((fs) => fs.version),
    ) + 1;

  return (
    <div>
      <Link
        href={detailHref}
        className="mb-5 inline-flex items-center gap-1 text-sm font-semibold text-text-muted hover:text-text-heading"
      >
        ← Back to v{formulaSet.version}
      </Link>

      <div className="mb-5">
        <h1 className="flex flex-wrap items-baseline gap-2 text-xl font-extrabold text-text-heading">
          {formulaSet.name}
          <span className="rounded-sm bg-bg-subtle px-1.5 py-0.5 font-mono text-sm font-bold text-text-muted">
            v{nextVersion}
          </span>
          <span className="rounded-full border border-[#F0D9A0] bg-[#FFF4D6] px-2.5 py-0.5 text-xs font-bold text-[#8A5A00]">
            DRAFT — not saved
          </span>
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Copied from v{formulaSet.version}. Nothing is created until you save. The version number
          is assigned on save (next free number for this name).
        </p>
      </div>

      <EditFormulaSetForm
        mode="newVersion"
        setId={setId}
        initialName={formulaSet.name}
        version={nextVersion}
        initialBodyJson={JSON.stringify(formulaSet.body, null, 2)}
        cancelHref={detailHref}
      />
    </div>
  );
}
