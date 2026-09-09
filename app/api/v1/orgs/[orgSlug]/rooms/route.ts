import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-error";
import { listRoomsByFloor, createRoom, reorderRooms } from "@/lib/data/rooms";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/rooms?floorId= ────────────────────────────────

/**
 * List all Rooms for a floor, ordered by orderIndex.
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Tenancy: enforced by getApiSession() (403 on cross-org) and listRoomsByFloor()
 *          which verifies the floor belongs to the session's org before
 *          returning any rows (returns [] rather than leaking cross-org existence).
 *
 * Query params:
 *   floorId (required) — ID of the floor to list rooms for.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error("[GET /api/v1/orgs/[orgSlug]/rooms]", err);
    return apiServerError();
  }

  const { searchParams } = new URL(request.url);
  const floorId = searchParams.get("floorId");
  if (!floorId) {
    return apiBadRequest("floorId query parameter is required");
  }

  try {
    const rooms = await listRoomsByFloor(session, floorId);
    return NextResponse.json({ rooms });
  } catch (err) {
    console.error("[GET /api/v1/orgs/[orgSlug]/rooms] listRoomsByFloor", err);
    return apiServerError();
  }
}

// ─── POST /api/v1/orgs/[orgSlug]/rooms ────────────────────────────────────────

/**
 * Create a new Room under a floor. Writes the default 4-side PLAIN rectangle
 * (see lib/data/rooms.ts createRoom() — stage doc scope item 3).
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Body: { floorId, label }
 *
 * Returns 201 with the created room on success.
 * Returns 400 on missing required fields, tenancy violations (floor not in
 * org), or a duplicate room label within the floor.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error("[POST /api/v1/orgs/[orgSlug]/rooms]", err);
    return apiServerError();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiBadRequest("Request body must be valid JSON");
  }

  const floorId = typeof body.floorId === "string" ? body.floorId.trim() : null;
  const label = typeof body.label === "string" ? body.label.trim() : null;

  if (!floorId || !label) {
    return apiBadRequest("floorId and label are required");
  }

  try {
    const room = await createRoom(session, floorId, label);
    return NextResponse.json({ room }, { status: 201 });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      ((err as { code: string }).code === "FLOOR_NOT_FOUND" ||
        (err as { code: string }).code === "DUPLICATE_ROOM_LABEL")
    ) {
      return apiBadRequest(err instanceof Error ? err.message : "Invalid request");
    }
    console.error("[POST /api/v1/orgs/[orgSlug]/rooms] createRoom", err);
    return apiServerError();
  }
}

// ─── PATCH /api/v1/orgs/[orgSlug]/rooms ───────────────────────────────────────

/**
 * Reorder all Rooms on a floor in one shot (all-or-nothing) — lives on the
 * collection route because it operates on the whole set of rooms for a
 * floor, not a single room by id (see lib/data/rooms.ts reorderRooms()).
 *
 * Body: { floorId, orderedRoomIds: string[] } — must contain exactly the
 *       room ids currently on the floor.
 *
 * Returns 200 with the reordered rooms on success.
 * Returns 400 on missing fields, tenancy violation (floor not in org), or an
 * orderedRoomIds set that doesn't exactly match the floor's current rooms.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error("[PATCH /api/v1/orgs/[orgSlug]/rooms]", err);
    return apiServerError();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiBadRequest("Request body must be valid JSON");
  }

  const floorId = typeof body.floorId === "string" ? body.floorId.trim() : null;
  const orderedRoomIds = Array.isArray(body.orderedRoomIds)
    ? body.orderedRoomIds.filter((id): id is string => typeof id === "string")
    : null;

  if (!floorId || !orderedRoomIds) {
    return apiBadRequest("floorId and orderedRoomIds are required");
  }

  try {
    const rooms = await reorderRooms(session, floorId, orderedRoomIds);
    return NextResponse.json({ rooms });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      ((err as { code: string }).code === "FLOOR_NOT_FOUND" ||
        (err as { code: string }).code === "INVALID_ROOM_SET")
    ) {
      return apiBadRequest(err instanceof Error ? err.message : "Invalid request");
    }
    console.error("[PATCH /api/v1/orgs/[orgSlug]/rooms] reorderRooms", err);
    return apiServerError();
  }
}
