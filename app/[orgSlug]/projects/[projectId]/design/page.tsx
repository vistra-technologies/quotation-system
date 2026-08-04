/* eslint-disable no-restricted-imports -- deferred per stage-12.md: design page uses floors/partitions DAL; migration blocked until interactive canvas stage */
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/data/session";
import { getProjectById } from "@/lib/data/projects";
import { listFloorsByProject } from "@/lib/data/floors";
import { listPartitionsByFloor } from "@/lib/data/partitions";
import { listSelections } from "@/lib/data/selections";
import { orgHref } from "@/lib/orgHref";

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
 *
 * Batch 8: restyled zinc-* classes to Sage Ease tokens. Functional behavior
 * (floors/partitions DAL, canvas deferral) unchanged.
 */
export default async function DesignPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const base = await orgHref(orgSlug, "");
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
      <div className="border-b border-border px-6 py-4">
        <Link
          href={`${base}/projects/${projectId}`}
          className="mb-2 inline-block text-sm text-text-muted hover:text-text-heading"
        >
          {t("backToProject")}
        </Link>
        <h1 className="text-xl font-extrabold tracking-tight text-text-heading">
          {t("pageTitle")} — #{project.projectNumber} {project.name}
        </h1>
      </div>

      {/* Three-column body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left rail — floor-grouped walls */}
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-border bg-bg-card px-4 py-5">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-text-muted">
            {t("wallsTitle")}
          </h2>

          {floorsWithPartitions.length === 0 ? (
            <p className="text-sm text-text-muted">
              {t("noWalls")}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {floorsWithPartitions.map((floor) => (
                <div key={floor.id}>
                  <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-text-body">
                    {floor.label}
                  </h3>
                  <ul className="flex flex-col gap-1">
                    {floor.partitions.map((partition) => (
                      <li
                        key={partition.id}
                        className="rounded-sm border border-border bg-primary-softer px-3 py-2 text-xs text-text-body"
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
              href={`${base}/projects/${projectId}/design/add-wall`}
              className="block w-full rounded-sm bg-primary px-4 py-2 text-center text-sm font-bold text-text-on-primary hover:bg-primary-dark"
            >
              {t("addWall")}
            </Link>
          </div>
        </aside>

        {/* Center — canvas placeholder */}
        <div className="flex flex-1 items-center justify-center bg-bg-page">
          <p className="text-sm text-text-muted">
            {t("canvasPlaceholder")}
          </p>
        </div>

        {/* Right — read-only Selections palette */}
        <aside className="w-64 shrink-0 overflow-y-auto border-l border-border bg-bg-card px-4 py-5">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-text-muted">
            {t("selectionsTitle")}
          </h2>
          {selections.length === 0 ? (
            <p className="text-sm text-text-muted">
              No components added yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {selections.map((sel) => (
                <li
                  key={sel.id}
                  className="rounded-sm border border-border bg-primary-softer px-3 py-2"
                >
                  <p className="text-sm font-semibold text-text-heading">
                    {sel.label}
                  </p>
                  <p className="text-xs text-text-muted">
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
