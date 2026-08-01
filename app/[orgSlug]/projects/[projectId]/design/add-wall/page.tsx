/* eslint-disable no-restricted-imports -- deferred per stage-12.md: add-wall page uses floors DAL; migration blocked until interactive canvas stage */
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/data/session";
import { getProjectById } from "@/lib/data/projects";
import { listFloorsByProject } from "@/lib/data/floors";
import { orgHref } from "@/lib/orgHref";
import { AddWallForm } from "./add-wall-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Add Wall page (Server Component).
 *
 * Fetches the project (tenancy guard / 404) and existing floor labels
 * (for the <datalist> suggestions in AddWallForm), then renders the form.
 *
 * The form lives at design/add-wall/ — consistent with the projects/new/
 * and inquiries/new/ pattern of dedicated sub-pages for create flows.
 *
 * After a successful save the server action redirects back to the design page.
 *
 * Batch 8: restyled zinc-* classes to Sage Ease tokens. Functional behavior
 * (floors DAL, canvas deferral) unchanged.
 */
export default async function AddWallPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const base = await orgHref(orgSlug, "");
  const session = await requireSession(orgSlug);

  const [project, floors, t] = await Promise.all([
    getProjectById(session, projectId),
    listFloorsByProject(projectId, session.organizationId),
    getTranslations("design"),
  ]);

  // Tenancy guard: project not found or belongs to a different org.
  if (!project) notFound();

  const existingFloorLabels = floors.map((f) => f.label);

  return (
    <div className="mx-auto max-w-lg px-6 py-8">
      <Link
        href={`${base}/projects/${projectId}/design`}
        className="mb-4 inline-block text-sm text-text-muted hover:text-text-heading"
      >
        {t("backToProject")}
      </Link>

      <h1 className="text-2xl font-extrabold tracking-tight text-text-heading">
        {t("addWall")}
      </h1>
      <p className="mt-1 text-sm text-text-muted">
        #{project.projectNumber} — {project.name}
      </p>

      <div className="mt-6 w-full rounded-md border border-border bg-bg-card p-5 shadow-card">
        <AddWallForm
          orgSlug={orgSlug}
          projectId={projectId}
          existingFloorLabels={existingFloorLabels}
        />
      </div>
    </div>
  );
}
