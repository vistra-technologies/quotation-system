import { notFound, redirect } from "next/navigation";
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
 * ?openRoom=<id> is read once on initial load for backward-compat with any
 * existing links that included it; the add-wall route that set it is retired
 * (S21-C1) but the query-param support is harmless to keep.
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

  const [
    { status: projectStatus, project },
    floorsRes,
    selectionsRes,
    isSubdomain,
  ] = await Promise.all([
    fetchProjectDetail(orgSlug, projectId),
    internalFetch(`/api/v1/orgs/${orgSlug}/floors?projectId=${projectId}`),
    internalFetch(`/api/v1/orgs/${orgSlug}/selections?projectId=${projectId}`),
    detectIsSubdomain(orgSlug),
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

  // S21 padding fix (round 2): the mockup (design-step-poc.html) has NO
  // page-level title bar above the 3-column grid at all — it goes straight
  // from the wizard-steps breadcrumb into the grid. The room name renders
  // inside the center card itself (DesignWorkspace's layout-mode heading).
  // The previous "Back to Project | Wall Design — ..." strip (even trimmed)
  // was still a deviation from the mockup's structure, not just its sizing.
  // Removed entirely to match 1:1; back-navigation is still reachable via
  // the "Project Details" wizard-step pill. Design-page-local change only —
  // other wizard steps keep their own page-level headers untouched.
  return (
    <DesignWorkspace
      orgSlug={orgSlug}
      projectId={projectId}
      isSubdomain={isSubdomain}
      initialFloors={floorsWithRooms}
      selections={selections}
      initialOpenRoomId={sp.openRoom ?? null}
    />
  );
}
