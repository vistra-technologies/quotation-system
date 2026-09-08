import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { fetchProjectDetail } from "../../_project-fetch";
import { AddWallForm } from "./add-wall-form";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

interface FloorRow {
  id: string;
  label: string;
}

/**
 * Add Wall page (Server Component).
 *
 * Stage 18 rework: fetches the project (fetchProjectDetail, shared with the
 * design page) and existing floor labels via the new
 * /api/v1/orgs/[orgSlug]/floors route (was a direct lib/data/floors call —
 * ends the Stage-12 eslint-disable deferral for this file) for the
 * <datalist> suggestions in AddWallForm, then renders the form.
 *
 * After a successful submit the server action resolves/creates the floor and
 * room and redirects into the design page with the room auto-expanded (see
 * add-wall/actions.ts's doc comment for why wall creation itself happens
 * there, not on this page).
 */
export default async function AddWallPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const base = await orgHref(orgSlug, "");

  const [{ status: projectStatus, project }, floorsRes, t] = await Promise.all([
    fetchProjectDetail(orgSlug, projectId),
    internalFetch(`/api/v1/orgs/${orgSlug}/floors?projectId=${projectId}`),
    getTranslations("design"),
  ]);

  if (
    projectStatus === 401 ||
    projectStatus === 403 ||
    floorsRes.status === 401 ||
    floorsRes.status === 403
  ) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  // Tenancy guard: project not found or belongs to a different org.
  if (!project) notFound();

  const floors: FloorRow[] = floorsRes.ok
    ? ((await floorsRes.json()) as { floors: FloorRow[] }).floors
    : [];
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
