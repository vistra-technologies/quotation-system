import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/data/session";
import { getProjectById } from "@/lib/data/projects";
import { listSelections } from "@/lib/data/selections";
import { listComponentTypes } from "@/lib/data/components";
import { AddSelectionForm } from "./add-selection-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Project detail page (Server Component).
 *
 * Auth gate: requireSession only — no special permission required.
 * Matches the existing createProject pattern: any authenticated org user
 * can view project details and add selections.
 *
 * Renders project metadata, the ordered list of existing Selections,
 * and the "Add component" form backed by the dynamic fieldsSchema renderer.
 */
export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const session = await requireSession(orgSlug);

  const [project, selections, allComponentTypes, tProjects, tSelections] = await Promise.all([
    getProjectById(session, projectId),
    listSelections(session, projectId),
    listComponentTypes(session),
    getTranslations("projects"),
    getTranslations("selections"),
  ]);

  // Tenancy guard: project not found or belongs to a different org.
  if (!project) notFound();

  // Only active ComponentTypes are offered in the "Add component" picker.
  const activeComponentTypes = allComponentTypes.filter((ct) => ct.active);

  return (
    <div>
      {/* Back link */}
      <Link
        href={`/${orgSlug}/projects`}
        className="mb-4 inline-block text-sm text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
      >
        {tSelections("backToProject")}
      </Link>

      {/* Project metadata */}
      <div className="mb-6">
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

      {/* Selections list */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {tSelections("sectionTitle")}
        </h2>
        <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          {selections.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {tSelections("noSelections")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                    <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">#</th>
                    <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                      {tSelections("fieldLabel")}
                    </th>
                    <th className="px-5 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                      {tSelections("stepPickType")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {selections.map((sel, i) => (
                    <tr
                      key={sel.id}
                      className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                    >
                      <td className="px-5 py-3 text-zinc-500 dark:text-zinc-400">{i + 1}</td>
                      <td className="px-5 py-3 font-medium text-zinc-900 dark:text-zinc-50">
                        {sel.label}
                      </td>
                      <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400">
                        {sel.componentType.name}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Add component section */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {tSelections("addComponent")}
        </h2>
        {activeComponentTypes.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No active component types available. Ask an admin to configure them under Component Types.
          </p>
        ) : (
          <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <AddSelectionForm
              orgSlug={orgSlug}
              projectId={projectId}
              orderIndex={selections.length}
              componentTypes={activeComponentTypes}
            />
          </div>
        )}
      </section>
    </div>
  );
}
