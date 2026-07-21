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
        className="mb-4 inline-block text-sm text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
      >
        {tProjects("backToList")}
      </Link>

      {/* Project metadata */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          #{project.projectNumber} — {project.name}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-zinc-500 dark:text-zinc-400">
          <span>{project.destinationCountry}</span>
          <span>{project.currency}</span>
          <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {project.status}
          </span>
          {project.externalCompany && (
            <span>{project.externalCompany.name}</span>
          )}
          <span className="text-zinc-400 dark:text-zinc-600">
            {tProjects("colDate")}: {new Date(project.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>

      {/* Next step link */}
      <Link
        href={`/${orgSlug}/projects/${projectId}/configuration`}
        className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Next: Configuration →
      </Link>
    </div>
  );
}
