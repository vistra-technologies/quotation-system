import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { orgHref } from "@/lib/orgHref";
import { fetchProjectDetail } from "./_project-fetch";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/** Read-only field display for the 3-card detail layout. */
function ReadOnlyField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="mb-[14px]">
      <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">{label}</p>
      <p className="mt-1 text-sm text-text-body">
        {value ? value : <span className="text-text-placeholder">—</span>}
      </p>
    </div>
  );
}

/**
 * Project Details page — Step 1 of the project wizard (Server Component).
 *
 * Stage 9: stripped to read-only project metadata only. The Selections list
 * and AddSelectionForm have moved to [projectId]/configuration/page.tsx.
 *
 * Stage 14 Batch C: restructured to 3-card read-only layout matching the
 * finalized project-details-page.html mockup:
 *   Card 1 — Project Information (core fields + company)
 *   Card 2 — Contractor & Consultant Details
 *   Card 3 — End Client Details + action footer
 *
 * Auth gate: fetchProjectDetail returns 401 → redirect to login; 404 → notFound().
 */
export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const base = await orgHref(orgSlug, "");

  const [{ status, project }, tProjects] = await Promise.all([
    fetchProjectDetail(orgSlug, projectId),
    getTranslations("projects"),
  ]);

  if (status === 401 || status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  // Tenancy guard: project not found or belongs to a different org.
  if (!project) notFound();

  const formatDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString() : null;

  const projectLabel =
    project.companyProjectNumber != null
      ? `JOB-${project.companyProjectNumber}`
      : `#${project.projectNumber}`;

  // Format the linked inquiry's display number identically to how the inquiry
  // detail page formats it (app/[orgSlug]/inquiries/[inquiryId]/page.tsx).
  // Null when the project was not converted from an inquiry (renders "—" in ReadOnlyField).
  const formattedInquiryNumber = project.inquiry
    ? project.inquiry.companyInquiryNumber != null
      ? `INQ-${project.inquiry.companyInquiryNumber}`
      : `#${project.inquiry.inquiryNumber}`
    : null;

  return (
    <div>
      {/* Page heading */}
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-extrabold text-text-heading">Project Details</h1>
        <p className="mt-1 text-sm text-text-muted">
          Review your project information to continue
        </p>
      </div>

      {/* ── Card 1: Project Information ───────────────────────────────────── */}
      <div className="mb-5 rounded-md border border-border bg-bg-card shadow-card overflow-hidden">
        <div className="bg-primary-softer px-5 py-3.5">
          <p className="text-base font-extrabold text-primary-dark">
            {tProjects("sectionProjectInfo")}
          </p>
          <p className="mt-0.5 text-xs font-medium text-text-muted">
            Core details about this project
          </p>
        </div>

        <div className="p-5">
          {/* Company — full width above grid */}
          <div className="mb-[14px]">
            <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
              {tProjects("fieldExternalCompany")}
            </p>
            <p className="mt-1 text-sm text-text-body">
              {project.externalCompany ? (
                project.externalCompany.name
              ) : (
                <span className="text-text-placeholder">—</span>
              )}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">
            <ReadOnlyField label={tProjects("colNumber")} value={projectLabel} />
            <ReadOnlyField label="Inquiry No." value={formattedInquiryNumber} />
            <ReadOnlyField label={tProjects("fieldName")} value={project.name} />
            <ReadOnlyField label={tProjects("fieldProjectBudget")} value={project.projectBudget} />
            <ReadOnlyField label={tProjects("fieldCurrency")} value={project.currency} />
            <ReadOnlyField label={tProjects("fieldProjectLocation")} value={project.projectLocation} />
            <ReadOnlyField label={tProjects("fieldSubmissionDate")} value={formatDate(project.submissionDate)} />
            <ReadOnlyField label={tProjects("fieldProjectDeadline")} value={formatDate(project.projectDeadline)} />

            {/* Status badge */}
            <div className="mb-[14px]">
              <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Status</p>
              <span className="mt-1 inline-flex items-center rounded-pill bg-primary-softer px-3 py-0.5 text-xs font-bold text-primary-dark">
                {project.status}
              </span>
            </div>

            <ReadOnlyField
              label={tProjects("fieldDestinationCountry")}
              value={project.destinationCountry || null}
            />
          </div>
        </div>
      </div>

      {/* ── Card 2: Contractor & Consultant Details ──────────────────────── */}
      <div className="mb-5 rounded-md border border-border bg-bg-card shadow-card overflow-hidden">
        <div className="bg-primary-softer px-5 py-3.5">
          <p className="text-base font-extrabold text-primary-dark">
            {tProjects("sectionContractorDetails")}
          </p>
          <p className="mt-0.5 text-xs font-medium text-text-muted">
            Contractors and consultants tied to this project
          </p>
        </div>

        <div className="p-5">
          <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">
            <ReadOnlyField label={tProjects("fieldMainContractorName")} value={project.mainContractorName} />
            <ReadOnlyField label={tProjects("fieldInteriorContractorName")} value={project.interiorContractorName} />
            <ReadOnlyField label={tProjects("fieldMainConsultantName")} value={project.mainConsultantName} />
            <ReadOnlyField label={tProjects("fieldInteriorConsultantName")} value={project.interiorConsultantName} />
          </div>
        </div>
      </div>

      {/* ── Card 3: End Client Details + action footer ───────────────────── */}
      <div className="mb-5 rounded-md border border-border bg-bg-card shadow-card overflow-hidden">
        <div className="bg-primary-softer px-5 py-3.5">
          <p className="text-base font-extrabold text-primary-dark">
            {tProjects("sectionEndClientDetails")}
          </p>
          <p className="mt-0.5 text-xs font-medium text-text-muted">
            Contact and billing details for the end client
          </p>
        </div>

        <div className="p-5">
          <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">
            <ReadOnlyField label={tProjects("fieldEndClientName")} value={project.endClientName} />
            <ReadOnlyField label={tProjects("fieldEndClientPhone")} value={project.endClientPhone} />
            <ReadOnlyField label={tProjects("fieldEndClientEmail")} value={project.endClientEmail} />
            <ReadOnlyField label={tProjects("fieldEndClientGstNumber")} value={project.endClientGstNumber} />
            <ReadOnlyField label={tProjects("fieldEndClientAddressLine1")} value={project.endClientAddressLine1} />
            <ReadOnlyField label={tProjects("fieldEndClientAddressLine2")} value={project.endClientAddressLine2} />
            <ReadOnlyField label={tProjects("fieldEndClientCity")} value={project.endClientCity} />
            <ReadOnlyField label={tProjects("fieldEndClientState")} value={project.endClientState} />
          </div>
        </div>

        {/* Footer: actions — moved inside Card 3 per D16 / mockup */}
        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
          <Link
            href={`${base}/projects`}
            className="inline-flex items-center rounded-sm border border-border bg-bg-white px-5 py-2.5 text-sm font-bold text-text-body hover:bg-primary-softer hover:text-text-heading"
          >
            Back to Projects
          </Link>

          {/* Edit link — only shown while the project is still DRAFT */}
          {project.status === "DRAFT" && (
            <Link
              href={`${base}/projects/${projectId}/edit`}
              className="inline-flex items-center rounded-sm border border-border bg-bg-white px-5 py-2.5 text-sm font-bold text-text-body hover:bg-primary-softer hover:text-text-heading"
            >
              Edit
            </Link>
          )}

          <Link
            href={`${base}/projects/${projectId}/configuration`}
            className="inline-flex items-center rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-text-on-primary hover:bg-primary-dark"
          >
            Next: Configuration →
          </Link>
        </div>
      </div>
    </div>
  );
}
