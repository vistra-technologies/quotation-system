import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { orgHref } from "@/lib/orgHref";
import { internalFetch } from "@/lib/internal-fetch";
import { fetchProjectDetail } from "../_project-fetch";
import type { Summary, MaterialListLine } from "@/lib/summary/types";
import { ActionRow } from "./action-row";
import { SummaryTables } from "./summary-tables";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/** Response shape from GET /api/v1/orgs/[orgSlug]/projects/[projectId]/calculation (Stage 26 Batch 1). */
interface CalculationResult {
  computedAt: string;
  status: "OK" | "FAILED";
  errorDetail?: string;
  summary: Summary;
  materialList: MaterialListLine[];
  formulaSet: { name: string; version: number };
}

const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * Summary page — Step 4 of the project wizard (Server Component).
 *
 * Stage 26 Batch 2: replaces the inert placeholder with the finalized mockup's KPI + Material List
 * tables (rendered by the client-island `SummaryTables`), an `ActionRow` (Export/Recompute — inert in
 * this batch, wired in Batch 3/4), a meta-footer with the real formula-set name/version + Computed at,
 * and the restored Back/Next wizard footer. Branches on the Batch 1 `GET .../calculation` route into
 * three renderable states (404 "no calc yet", 200 FAILED, 200 OK) — see stage-26.md Batch 2.
 *
 * fetchProjectDetail is React.cache()-shared with the layout — zero extra round-trips for project data.
 */
export default async function SummaryPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const base = await orgHref(orgSlug, "");

  const { status, project } = await fetchProjectDetail(orgSlug, projectId);

  if (status === 401 || status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  if (!project) notFound();

  // Step-gating: Summary requires the design to have been explicitly
  // submitted (Design page's "Submit Design" button), not just partitionCount>0.
  if (project.partitionCount === 0 || !project.designSubmittedAt) {
    redirect(await orgHref(orgSlug, `/projects/${projectId}`));
  }

  const calcRes = await internalFetch(
    `/api/v1/orgs/${orgSlug}/projects/${projectId}/calculation`,
  );
  const calc: CalculationResult | null = calcRes.ok
    ? ((await calcRes.json()) as CalculationResult)
    : null;

  const isDraft = project.status === "DRAFT";

  return (
    <div className="py-8">
      <div className="mb-6 rounded-md border border-border bg-bg-card p-5 shadow-card">
        {!calc ? (
          // 404 — design submitted, but no ProjectCalculation row stored yet.
          <div className="rounded-md border border-dashed border-border bg-bg-white px-6 py-16 text-center">
            <div
              className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-[10px] bg-primary-softer text-primary"
              aria-hidden="true"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M9 3v18M13 9v3M17 9v5" />
              </svg>
            </div>
            <p className="text-sm font-bold text-text-heading">No calculation yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-text-muted">
              The design was submitted, but nothing has been computed for it. Go back to Design and
              submit again to generate the material list.
            </p>
            <Link
              href={`${base}/projects/${projectId}/design`}
              className="mt-4 inline-flex items-center rounded-sm border border-border bg-bg-white px-4 py-2 text-xs font-bold text-text-body hover:bg-primary-softer"
            >
              ‹ Back to Design
            </Link>
          </div>
        ) : calc.status === "FAILED" ? (
          // 200, status: FAILED — an old calculation row that failed. Error banner + Recompute only.
          <>
            <div className="flex gap-3 rounded-md bg-status-failed-bg p-4 text-status-failed-text">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mt-0.5 h-[22px] w-[22px] flex-shrink-0"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v5M12 16h.01" />
              </svg>
              <div className="flex-1">
                <div className="mb-1 text-sm font-extrabold">Calculation failed</div>
                <div className="whitespace-pre-wrap break-words rounded-md bg-white/50 px-2.5 py-2 font-mono text-xs">
                  {calc.errorDetail}
                </div>
              </div>
            </div>
            <div className="mt-3.5">
              <ActionRow isDraft={isDraft} showExport={false} />
            </div>
          </>
        ) : (
          // 200, status: OK — the real page.
          <>
            <ActionRow isDraft={isDraft} showExport={true} />
            <SummaryTables
              summary={calc.summary}
              materialList={calc.materialList}
              configSnapshot={project.configSnapshot}
            />
            <div className="mt-6 flex flex-wrap items-center gap-5 rounded-md border border-border bg-bg-card px-5 py-3.5">
              <div className="flex flex-col gap-px">
                <span className="text-[10.5px] font-extrabold uppercase tracking-wide text-text-muted">
                  Formula Set
                </span>
                <span className="text-xs font-bold text-text-heading">{calc.formulaSet.name}</span>
              </div>
              <div className="h-[30px] w-px flex-shrink-0 bg-border" />
              <div className="flex flex-col gap-px">
                <span className="text-[10.5px] font-extrabold uppercase tracking-wide text-text-muted">
                  Version
                </span>
                <span className="text-xs font-bold text-text-heading">v{calc.formulaSet.version}</span>
              </div>
              <div className="h-[30px] w-px flex-shrink-0 bg-border" />
              <div className="flex flex-col gap-px">
                <span className="text-[10.5px] font-extrabold uppercase tracking-wide text-text-muted">
                  Computed at
                </span>
                <span className="text-xs font-bold text-text-heading">
                  {dateTimeFmt.format(new Date(calc.computedAt))}
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Card footer — wizard step navigation */}
      <div className="flex items-center justify-between">
        <Link
          href={`${base}/projects/${projectId}/design`}
          className="inline-flex items-center rounded-sm border border-border bg-bg-white px-5 py-2.5 text-sm font-bold text-text-body hover:bg-primary-softer hover:text-text-heading"
        >
          ← Back
        </Link>
        <Link
          href={`${base}/projects/${projectId}/quotation`}
          className="inline-flex items-center rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-text-on-primary hover:bg-primary-dark"
        >
          Next: Quotation →
        </Link>
      </div>
    </div>
  );
}
