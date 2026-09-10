import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { orgHref } from "@/lib/orgHref";
import { fetchProjectDetail } from "../_project-fetch";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Quotation page — Step 5 of the project wizard (Server Component).
 *
 * Inert placeholder. The Quotation pipeline arrives in a future stage.
 *
 * Stage 11 (Batch 6): outer chrome restyled to Sage Ease tokens (page
 * heading, card wrapper, empty-state placeholder, card-footer navigation).
 * No mockup exists yet — generic form-page pattern used. No logic changes.
 *
 * Stage 19 Batch 4: added step-gating — redirects to Project Details if the
 * project has 0 Partitions (nothing to quote yet). fetchProjectDetail is
 * React.cache()-shared with the layout — zero extra round-trips.
 */
export default async function QuotationPage({
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

  // Step-gating: Quotation requires ≥1 Partition to have content to price.
  if (project.partitionCount === 0) {
    redirect(await orgHref(orgSlug, `/projects/${projectId}`));
  }
  const t = await getTranslations("wizard");

  return (
    <div>
      {/* Page heading */}
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-extrabold text-text-heading">
          {t("step5")}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Review your priced quotation before placing an order
        </p>
      </div>

      {/* Content card */}
      <div className="mb-6 rounded-md border border-border bg-bg-card shadow-card">
        {/* Inert placeholder */}
        <div className="m-5 rounded-md border border-dashed border-border px-6 py-16 text-center">
          <div
            className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-[10px] bg-primary-softer text-primary"
            aria-hidden="true"
          >
            {/* Receipt / document icon */}
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
              <path d="M14 2.5H6.8a1.8 1.8 0 0 0-1.8 1.8v15.4a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8V8.3z" />
              <path d="M14 2.5v5.8h5.2" />
              <path d="M8 13h8M8 17h5" />
            </svg>
          </div>
          <p className="text-sm font-bold text-text-heading">
            {t("quotationPlaceholder")}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Complete the Design step to generate a quotation here.
          </p>
        </div>
      </div>

      {/* Card footer — wizard step navigation */}
      <div className="flex items-center justify-start">
        <Link
          href={`${base}/projects/${projectId}/summary`}
          className="inline-flex items-center rounded-sm border border-border bg-bg-white px-5 py-2.5 text-sm font-bold text-text-body hover:bg-primary-softer hover:text-text-heading"
        >
          ← Back
        </Link>
      </div>
    </div>
  );
}
