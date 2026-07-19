import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/data/session";
import { getProjectById } from "@/lib/data/projects";
import { listFloorsByProject } from "@/lib/data/floors";
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
 */
export default async function AddWallPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
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
    <div className="px-6 py-8">
      <Link
        href={`/${orgSlug}/projects/${projectId}/design`}
        className="mb-4 inline-block text-sm text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
      >
        {t("backToProject")}
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {t("addWall")}
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        #{project.projectNumber} — {project.name}
      </p>

      <div className="mt-6 w-full max-w-md rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <AddWallForm
          orgSlug={orgSlug}
          projectId={projectId}
          existingFloorLabels={existingFloorLabels}
        />
      </div>
    </div>
  );
}
