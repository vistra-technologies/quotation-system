import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { orgHref } from "@/lib/orgHref";

// Always render live — reads headers via orgHref.
export const dynamic = "force-dynamic";

/**
 * Summary page — Step 4 of the project wizard (Server Component).
 *
 * Inert placeholder. Floor/Partition data rendering (shop drawings, cut-list
 * tables) is deferred to a later stage (human decision, 2026-07-24).
 *
 * Stage 11 (Batch 6): outer chrome restyled to Sage Ease tokens to match
 * summary-page-2026-07-23-v1.html — page heading, card wrapper, empty-state
 * placeholder, and card-footer navigation. No logic or data changes.
 */
export default async function SummaryPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const base = await orgHref(orgSlug, "");
  const t = await getTranslations("wizard");

  return (
    <div>
      {/* Page heading */}
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-extrabold text-text-heading">
          {t("step4")}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Shop drawing and cut list for every partition, grouped by floor — for
          print and factory use
        </p>
      </div>

      {/* Content card */}
      <div className="mb-6 rounded-md border border-border bg-bg-card shadow-card">
        {/* Inert placeholder — matches empty-state from mockup JS fallback */}
        <div className="m-5 rounded-md border border-dashed border-border px-6 py-16 text-center">
          <div
            className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-[10px] bg-primary-softer text-primary"
            aria-hidden="true"
          >
            {/* Blueprint / ruler icon */}
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
          <p className="text-sm font-bold text-text-heading">
            {t("summaryPlaceholder")}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Go back to Design and save a partition to see it summarized here.
          </p>
        </div>
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
