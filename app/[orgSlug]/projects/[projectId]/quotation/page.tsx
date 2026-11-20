import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { orgHref, detectIsSubdomain } from "@/lib/orgHref";
import { internalFetch } from "@/lib/internal-fetch";
import type { Summary } from "@/lib/summary/types";
import { kpisOf, type QuotationDto } from "@/lib/quotation/present";
import { fetchProjectDetail } from "../_project-fetch";
import { NoAccessState } from "./_parts";
import { QuotationPage } from "./quotation-page";

// Always render live: reads the session cookie and the DB.
export const dynamic = "force-dynamic";

/** The slice of GET .../calculation this page reads (the Summary page reads the rest). */
interface CalculationResult {
  status: "OK" | "FAILED";
  summary: Summary;
}

/**
 * Quotation page, Step 5 of the project wizard (Server Component). Stage 38 Batch 4, mockup B rev 3.
 *
 * Gating (Q-D33, amends S38-D3): open while the project has a quotation, even when the design was edited after it
 * (the stored quotation and its "design changed" banner stay reachable); with no quotation it needs a submitted
 * design, else it redirects to Project Details as before. A user without `QUOTE` (an architect) gets the no-access
 * state; the API enforces the same (S38-1). `fetchProjectDetail` is React.cache()-shared with the layout.
 */
export default async function QuotationRoute({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const base = await orgHref(orgSlug, "");

  const [{ status, project }, isSubdomain, meRes] = await Promise.all([
    fetchProjectDetail(orgSlug, projectId),
    detectIsSubdomain(orgSlug),
    internalFetch(`/api/v1/orgs/${orgSlug}/me`),
  ]);

  if (status === 401 || status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }
  if (!project) notFound();

  const designSubmitted = project.partitionCount > 0 && !!project.designSubmittedAt;
  if (!project.hasQuotation && !designSubmitted) {
    redirect(await orgHref(orgSlug, `/projects/${projectId}`));
  }

  const me = meRes.ok
    ? ((await meRes.json()) as { orgName?: string; permissionCodes?: string[]; externalCompanyId?: string | null })
    : null;
  const permissions = new Set(me?.permissionCodes ?? []);

  if (!permissions.has("QUOTE")) {
    return (
      <div className="py-8">
        <div className="mb-6 rounded-md border border-border bg-bg-card p-5 shadow-card">
          <NoAccessState summaryHref={`${base}/projects/${projectId}/summary`} />
        </div>
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

  const [quotationRes, calcRes] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/projects/${projectId}/quotation`),
    internalFetch(`/api/v1/orgs/${orgSlug}/projects/${projectId}/calculation`),
  ]);
  // 404 NO_QUOTATION means none yet; anything else that is not 200 is a real failure (the error boundary shows it).
  if (!quotationRes.ok && quotationRes.status !== 404) {
    throw new Error(`Failed to load the quotation (status ${quotationRes.status})`);
  }
  const quotation = quotationRes.ok ? ((await quotationRes.json()) as { quotation: QuotationDto }).quotation : null;
  // No calculation (404) or a FAILED row is "no calculation yet" here: KPIs are left out, Create stays disabled.
  const calc = calcRes.ok ? ((await calcRes.json()) as CalculationResult) : null;
  const calcOk = calc?.status === "OK" ? calc : null;

  return (
    <QuotationPage
      orgSlug={orgSlug}
      projectId={projectId}
      isSubdomain={isSubdomain}
      base={base}
      orgName={me?.orgName ?? orgSlug}
      projectName={project.name}
      projectNumber={project.projectNumber}
      projectLocation={project.projectLocation}
      company={project.externalCompany?.name ?? null}
      endClient={project.endClientName}
      initial={quotation}
      canCreate={designSubmitted && calcOk !== null}
      designSubmitted={designSubmitted}
      kpis={calcOk ? kpisOf(calcOk.summary) : null}
      snapshot={project.configSnapshot}
      canApplyDiscount={permissions.has("APPLY_DISCOUNT")}
      canExtend={permissions.has("EXTEND_QUOTE")}
      external={!!me?.externalCompanyId}
    />
  );
}
