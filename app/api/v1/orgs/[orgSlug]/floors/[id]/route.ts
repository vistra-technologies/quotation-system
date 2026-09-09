import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";
import { deleteFloor } from "@/lib/data/floors";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── DELETE /api/v1/orgs/[orgSlug]/floors/[id] ────────────────────────────────

/**
 * Delete a Floor. Rooms under it cascade via the DB FK (Room.floorId,
 * onDelete: Cascade), and each Room's Partitions cascade further
 * (Partition.roomId, onDelete: Cascade) — no manual cleanup needed.
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Tenancy: enforced by getApiSession() (403 on cross-org) and deleteFloor()
 *          which verifies the floor belongs to the session's org.
 *
 * Returns 200 on success. Returns 404 when the floor is not found in the
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
    console.error("[DELETE /api/v1/orgs/[orgSlug]/floors/[id]]", err);
    return apiServerError();
  }

  try {
    const deleted = await deleteFloor(session, id);
    if (!deleted) {
      return apiNotFound("Floor not found or access denied");
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/v1/orgs/[orgSlug]/floors/[id]] deleteFloor", err);
    return apiServerError();
  }
}
