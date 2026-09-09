import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-error";
import { renameRoom, deleteRoom } from "@/lib/data/rooms";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── PATCH /api/v1/orgs/[orgSlug]/rooms/[id] ──────────────────────────────────

/**
 * Rename a Room. (Reordering rooms within a floor is a collection-level
 * operation — see PATCH /api/v1/orgs/[orgSlug]/rooms.)
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Body: { label } — required.
 * Tenancy: enforced by getApiSession() (403 on cross-org) and renameRoom()
 *          which verifies the room belongs to the session's org.
 *
 * Returns 200 with the updated room on success.
 * Returns 404 when the room is not found in the session's org.
 * Returns 400 on invalid body (label missing) or a duplicate label on the
 * same floor (@@unique([floorId, label]), same mapping createRoom's POST
 * route already uses for the identical collision).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; id: string }> },
) {
  const { orgSlug, id } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error("[PATCH /api/v1/orgs/[orgSlug]/rooms/[id]]", err);
    return apiServerError();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiBadRequest("Request body must be valid JSON");
  }

  const label = typeof body.label === "string" ? body.label.trim() : undefined;

  if (!label) {
    return apiBadRequest("label is required");
  }

  try {
    const room = await renameRoom(session, id, label);
    if (!room) {
      return apiNotFound("Room not found or access denied");
    }
    return NextResponse.json({ room });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "DUPLICATE_ROOM_LABEL"
    ) {
      return apiBadRequest(err instanceof Error ? err.message : "Invalid request");
    }
    console.error("[PATCH /api/v1/orgs/[orgSlug]/rooms/[id]] renameRoom", err);
    return apiServerError();
  }
}

// ─── DELETE /api/v1/orgs/[orgSlug]/rooms/[id] ─────────────────────────────────

/**
 * Delete a Room. Partitions under it cascade via the DB FK (Partition.roomId,
 * onDelete: Cascade) — no manual cleanup needed.
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Tenancy: enforced by getApiSession() (403 on cross-org) and deleteRoom()
 *          which verifies the room belongs to the session's org.
 *
 * Returns 200 on success. Returns 404 when the room is not found in the
 * session's org.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; id: string }> },
) {
  const { orgSlug, id } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error("[DELETE /api/v1/orgs/[orgSlug]/rooms/[id]]", err);
    return apiServerError();
  }

  try {
    const deleted = await deleteRoom(session, id);
    if (!deleted) {
      return apiNotFound("Room not found or access denied");
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/v1/orgs/[orgSlug]/rooms/[id]] deleteRoom", err);
    return apiServerError();
  }
}
