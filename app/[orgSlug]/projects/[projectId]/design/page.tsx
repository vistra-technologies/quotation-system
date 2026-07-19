import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/data/session";
import { getProjectById } from "@/lib/data/projects";
import { listFloorsByProject } from "@/lib/data/floors";
import { listPartitionsByFloor } from "@/lib/data/partitions";
import { listSelections } from "@/lib/data/selections";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Design page (Server Component).
 *
 * Three-column layout:
 *   Left rail  — floor-grouped wall list + "Add Wall" button
 *   Center     — canvas placeholder (interactive canvas comes in Stage 9)
 *   Right      — read-only Selections palette (component types already on the project)
 *
 * Auth gate: requireSession (any authenticated org user).
 * Tenancy guard: getProjectById returns null → 404 if project belongs to another org.
 */
export default async function DesignPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const session = await requireSession(orgSlug);

  const [project, floors, selections, t] = await Promise.all([
    getProjectById(session, projectId),
    listFloorsByProject(projectId, session.organizationId),
    listSelections(session, projectId),
    getTranslations("design"),
  ]);

  // Tenancy guard: project not found or belongs to a different org.
  if (!project) notFound();

  // Fetch partitions for each floor (sequential — small N per project).
  const floorsWithPartitions = await Promise.all(
    floors.map(async (floor) => ({
      ...floor,
      partitions: await listPartitionsByFloor(floor.id, session.organizationId),
    })),
  );

  return (
    <div className="flex h-full flex-col">
      {/* Page header */}
      <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <Link
          href={`/${orgSlug}/projects/${projectId}`}
          className="mb-2 inline-block text-sm text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
        >
          {t("backToProject")}
        </Link>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t("pageTitle")} — #{project.projectNumber} {project.name}
        </h1>
      </div>

      {/* Three-column body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left rail — floor-grouped walls */}
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-zinc-200 bg-white px-4 py-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {t("wallsTitle")}
          </h2>

          {floorsWithPartitions.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t("noWalls")}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {floorsWithPartitions.map((floor) => (
                <div key={floor.id}>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                    {floor.label}
                  </h3>
                  <ul className="flex flex-col gap-1">
                    {floor.partitions.map((partition) => (
                      <li
                        key={partition.id}
                        className="rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-300"
                      >
                        {partition.location} — {partition.heightMm} &times;{" "}
                        {partition.widthMm} mm
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          <div className="mt-5">
            <Link
              href={`/${orgSlug}/projects/${projectId}/design/add-wall`}
              className="block w-full rounded-md bg-zinc-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {t("addWall")}
            </Link>
          </div>
        </aside>

        {/* Center — canvas placeholder */}
        <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-zinc-950">
          <p className="text-sm text-zinc-400 dark:text-zinc-600">
            {t("canvasPlaceholder")}
          </p>
        </div>

        {/* Right — read-only Selections palette */}
        <aside className="w-64 shrink-0 overflow-y-auto border-l border-zinc-200 bg-white px-4 py-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {t("selectionsTitle")}
          </h2>
          {selections.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No components added yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {selections.map((sel) => (
                <li
                  key={sel.id}
                  className="rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-800/50"
                >
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {sel.label}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {sel.componentType.name}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
