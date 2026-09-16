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
      {/* Page header — S21 padding fix: mockup (design-step-poc.html) has no
          separate title bar above the 3-column grid at all (the room name
          renders inside the center card itself, per DesignWorkspace's layout
          mode). This header is app-only chrome for back-navigation + a page
          title, kept for UX but trimmed to a minimal strip so it doesn't
          stack a second full gutter on top of the wizard breadcrumb above and
          the grid's own 18px/24px padding below (S21-0.2's mockup-matched
          value) — that stacking was the excess whitespace. Design-page-local
          markup only; other wizard steps are untouched. */}
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-2">
        <div className="flex items-center gap-3">
          <Link
            href={`${base}/projects/${projectId}`}
            className="text-sm text-text-muted hover:text-text-heading"
          >
            {t("backToProject")}
          </Link>
          <span className="text-border">|</span>
          <h1 className="text-sm font-bold tracking-tight text-text-heading">
            {t("pageTitle")} — #{project.projectNumber} {project.name}
          </h1>
        </div>
        {/* S21-C1: The "Add Wall" button (which navigated to /design/add-wall)
            has been retired — converting a PLAIN side to a partition is now
            done inline in the right rail via LayoutModePanel / ConvertSideForm.
            The route /design/add-wall no longer exists; any old bookmark to
            it returns 404. */}
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
