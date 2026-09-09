import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref, detectIsSubdomain } from "@/lib/orgHref";
import { fetchProjectDetail } from "../_project-fetch";
import { DesignWorkspace } from "./design-workspace";
import type { FloorRow, FloorWithRooms, SelectionRow } from "./types";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Design page (Server Component).
 *
 * Stage 18 item 7 rework: rebuilds the center/right columns to match
 * design-step-poc.html (floor-plan diagram, layout-mode side panel, unit
 * toggle) instead of the item-4 list-only left rail. This page stays the
 * data-fetching entry point (floors + rooms + selections via internalFetch
 * — unchanged data sources, Stage-12 layer separation preserved) but hands
 * everything to one Client Component, design-workspace.tsx, which owns all
 * further interaction as pure client state (plan-item7.md flag 6) — no more
 * ?openRoom= redirect round trips for every click.
 *
 * Auth: API routes return 401/403 on unauthenticated/cross-tenant requests;
 * this page redirects to login on either. 404 -> notFound() on a missing/
 * cross-org project (tenancy guard).
 *
 * ?openRoom=<id> is still read once, on initial load — it's set by
 * add-wall/actions.ts's server-side redirect (a genuine top-level entry
 * point, unchanged), not by any in-page mutation anymore.
 */
export default async function DesignPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
  searchParams: Promise<{ openRoom?: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const sp = await searchParams;
  const base = await orgHref(orgSlug, "");

  const [
    { status: projectStatus, project },
    floorsRes,
    selectionsRes,
    isSubdomain,
    t,
  ] = await Promise.all([
    fetchProjectDetail(orgSlug, projectId),
    internalFetch(`/api/v1/orgs/${orgSlug}/floors?projectId=${projectId}`),
    internalFetch(`/api/v1/orgs/${orgSlug}/selections?projectId=${projectId}`),
    detectIsSubdomain(orgSlug),
    getTranslations("design"),
  ]);

  if (
    projectStatus === 401 ||
    projectStatus === 403 ||
    floorsRes.status === 401 ||
    floorsRes.status === 403 ||
    selectionsRes.status === 401 ||
    selectionsRes.status === 403
  ) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  // Tenancy guard: project not found or belongs to a different org.
  if (!project) notFound();

  // Step-gating: Design requires ≥1 Selection to have content to work with.
  // A project with 0 Selections has nothing to design — redirect to Project Details.
  // The Configuration page (where Selections are added) is always accessible, so
  // users are not left with no path forward. (Stage 19 Batch 4)
  if (project.selectionCount === 0) {
    redirect(await orgHref(orgSlug, `/projects/${projectId}`));
  }

  const floors: FloorRow[] = floorsRes.ok
    ? ((await floorsRes.json()) as { floors: FloorRow[] }).floors
    : [];

  const selections: SelectionRow[] = selectionsRes.ok
    ? ((await selectionsRes.json()) as { selections: SelectionRow[] })
        .selections
    : [];

  // Fetch rooms for each floor (parallel — small N per project, same
  // sequencing shape as the pre-Stage-18 partitions-per-floor fetch).
  const floorsWithRooms: FloorWithRooms[] = await Promise.all(
    floors.map(async (floor) => {
      const roomsRes = await internalFetch(
        `/api/v1/orgs/${orgSlug}/rooms?floorId=${floor.id}`,
      );
      const rooms = roomsRes.ok
        ? ((await roomsRes.json()) as { rooms: FloorWithRooms["rooms"] })
            .rooms
        : [];
      return { id: floor.id, label: floor.label, rooms };
    }),
  );

  return (
    <div className="flex h-full flex-col">
      {/* Page header */}
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-4">
        <div>
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
        <Link
          href={`${base}/projects/${projectId}/design/add-wall`}
          className="shrink-0 rounded-sm bg-primary px-4 py-2 text-center text-sm font-bold text-text-on-primary hover:bg-primary-dark"
        >
          {t("addWall")}
        </Link>
      </div>

      <DesignWorkspace
        orgSlug={orgSlug}
        projectId={projectId}
        isSubdomain={isSubdomain}
        initialFloors={floorsWithRooms}
        selections={selections}
        initialOpenRoomId={sp.openRoom ?? null}
      />
    </div>
  );
}
