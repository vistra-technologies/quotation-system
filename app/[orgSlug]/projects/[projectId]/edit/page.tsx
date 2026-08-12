import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { orgHref } from "@/lib/orgHref";
import { fetchProjectDetail } from "../_project-fetch";
import { EditProjectForm } from "./edit-project-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Project Edit page (Server Component).
 *
 * Reachable from the Project Details page via an "Edit" link that is only
 * rendered when the project's status is "DRAFT". Navigating here directly
 * for a non-DRAFT project renders a "not editable" notice rather than the form.
 *
 * Auth gate: fetchProjectDetail returns 401/403 → redirect to login;
 *            404 → notFound().
 *
 * Data: shares the React.cache()-wrapped fetchProjectDetail helper with the
 * wizard layout and the project detail page — one HTTP round-trip for all three.
 */
export default async function ProjectEditPage({
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

  if (!project) notFound();

  const isDraft = project.status === "DRAFT";

  return (
    <div>
      {/* Page heading */}
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-extrabold text-text-heading">
          {tProjects("editPageTitle")}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {tProjects("editPageSubtitle")}
        </p>
      </div>

      {/* Non-DRAFT guard — shown instead of the form if the project can't be edited */}
      {!isDraft ? (
        <div className="rounded-md border border-border bg-bg-card p-7 shadow-card text-center">
          <p className="text-sm text-text-muted">
            This project is in <strong>{project.status}</strong> status and cannot be
            edited. Only DRAFT projects are editable.
          </p>
          <a
            href={`${base}/projects/${projectId}`}
            className="mt-4 inline-flex items-center rounded-sm border border-border bg-bg-white px-5 py-2.5 text-sm font-bold text-text-body hover:bg-primary-softer hover:text-text-heading"
          >
            {tProjects("backToList").replace("Projects", "Project")}
          </a>
        </div>
      ) : (
        <div className="rounded-md border border-border bg-bg-card p-7 shadow-card">
          <EditProjectForm
            orgSlug={orgSlug}
            projectId={projectId}
            initialName={project.name}
            initialDestinationCountry={project.destinationCountry}
            initialCurrency={project.currency}
            initialProjectLocation={project.projectLocation}
            lockedCompany={project.externalCompany}
          />
        </div>
      )}
    </div>
  );
}
