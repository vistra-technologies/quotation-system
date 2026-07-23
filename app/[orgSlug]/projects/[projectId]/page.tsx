import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/data/session";
import { getProjectById } from "@/lib/data/projects";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Project Details page — Step 1 of the project wizard (Server Component).
 *
 * Stage 9: stripped to read-only project metadata only. The Selections list
 * and AddSelectionForm have moved to [projectId]/configuration/page.tsx.
 * The "Design Walls" button has been removed (Design is Step 3 in the wizard).
 *
 * Stage 10 (Task 1.6): restyled to Sage Ease tokens — heading, metadata card,
 * status badge, and "Next" button. No logic changes.
 *
 * Auth gate: requireSession only — no special permission required.
 */
export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const session = await requireSession(orgSlug);

  const [project, tProjects] = await Promise.all([
    getProjectById(session, projectId),
    getTranslations("projects"),
  ]);

  // Tenancy guard: project not found or belongs to a different org.
  if (!project) notFound();

  return (
    <div>
      {/* Back link */}
      <Link
        href={`/${orgSlug}/projects`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-text-heading"
      >
        {tProjects("backToList")}
      </Link>

      {/* Page heading */}
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-extrabold text-text-heading">Project Details</h1>
        <p className="mt-1 text-sm text-text-muted">
          Review your project information to continue
        </p>
      </div>

      {/* Project metadata card */}
      <div className="mb-6 rounded-md border border-border bg-bg-card p-7 shadow-card">
        {/* Project number + name */}
        <h2 className="mb-4 text-xl font-extrabold text-primary-dark">
          #{project.projectNumber} — {project.name}
        </h2>

        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-3 text-sm text-text-muted">
          <span>{project.destinationCountry}</span>
          <span aria-hidden="true">·</span>
          <span>{project.currency}</span>
          <span aria-hidden="true">·</span>

          {/* Status badge */}
          <span className="inline-flex items-center rounded-pill bg-primary-softer px-3 py-0.5 text-xs font-bold text-primary-dark">
            {project.status}
          </span>

          {project.externalCompany && (
            <>
              <span aria-hidden="true">·</span>
              <span>{project.externalCompany.name}</span>
            </>
          )}

          <span aria-hidden="true">·</span>
          <span className="text-text-placeholder">
            {tProjects("colDate")}: {new Date(project.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>

      {/* Card footer: navigate to next step */}
      <div className="flex items-center justify-end gap-3">
        <Link
          href={`/${orgSlug}/projects`}
          className="inline-flex items-center rounded-sm border border-border bg-bg-white px-5 py-2.5 text-sm font-bold text-text-body hover:bg-primary-softer hover:text-text-heading"
        >
          Back to Projects
        </Link>
        <Link
          href={`/${orgSlug}/projects/${projectId}/configuration`}
          className="inline-flex items-center rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-text-on-primary hover:bg-primary-dark"
        >
          Next: Configuration →
        </Link>
      </div>
    </div>
  );
}
