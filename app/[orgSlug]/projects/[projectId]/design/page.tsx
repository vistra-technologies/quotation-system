import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import { fetchProjectDetail } from "../_project-fetch";
import { DesignLeftRail, type FloorWithRooms } from "./design-left-rail";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

// ─── API response types (see design-left-rail.tsx for the RoomSide shape) ────

interface FloorRow {
  id: string;
  label: string;
}

interface SelectionRow {
  id: string;
  label: string;
  componentType: { name: string };
}

/**
 * Design page (Server Component).
 *
 * Stage 18 rework: left rail is now Floor -> Room -> sides (was a flat
 * floor-grouped Partition list). Ends the Stage-12 `eslint-disable
 * no-restricted-imports` deferral for this slice — all data now comes
 * through internalFetch + the app/api/v1/** routes (fetchProjectDetail,
 * the new /floors and /rooms routes, the existing /selections route)
 * instead of calling lib/data/floors|partitions|projects|selections
 * directly.
 *
 * Three-column layout (unchanged):
 *   Left rail  — Floor -> Room -> sides list + "New Room"
 *   Center     — canvas placeholder (interactive canvas still out of scope)
 *   Right      — read-only Selections palette
 *
 * Auth: API routes return 401/403 on unauthenticated/cross-tenant requests;
 * this page redirects to login on either. 404 -> notFound() on a missing/
 * cross-org project (tenancy guard).
 *
 * ?openRoom=<id> (set by the create-room and convert-side server actions
 * after a redirect) auto-expands that room in the left rail.
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
    t,
  ] = await Promise.all([
    fetchProjectDetail(orgSlug, projectId),
    internalFetch(`/api/v1/orgs/${orgSlug}/floors?projectId=${projectId}`),
    internalFetch(`/api/v1/orgs/${orgSlug}/selections?projectId=${projectId}`),
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
        {/* Left rail — Floor -> Room -> sides */}
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-border bg-bg-card px-4 py-5">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-text-muted">
            {t("wallsTitle")}
          </h2>

          {floorsWithRooms.length === 0 ? (
            <p className="text-sm text-text-muted">{t("noWalls")}</p>
          ) : (
            <DesignLeftRail
              orgSlug={orgSlug}
              projectId={projectId}
              floors={floorsWithRooms}
              initialOpenRoomId={sp.openRoom ?? null}
            />
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
          <p className="text-sm text-text-muted">{t("canvasPlaceholder")}</p>
        </div>

        {/* Right — read-only Selections palette */}
        <aside className="w-64 shrink-0 overflow-y-auto border-l border-border bg-bg-card px-4 py-5">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-text-muted">
            {t("selectionsTitle")}
          </h2>
          {selections.length === 0 ? (
            <p className="text-sm text-text-muted">No components added yet.</p>
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
