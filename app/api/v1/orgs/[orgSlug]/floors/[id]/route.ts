import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-error";
import { renameFloor, deleteFloor } from "@/lib/data/floors";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── PATCH /api/v1/orgs/[orgSlug]/floors/[id] ─────────────────────────────────

/**
 * Rename a Floor. (Reordering floors is not yet implemented.)
 *
 * Auth: any authenticated org member.
 * Body: { label } — required.
 * Tenancy: enforced by getApiSession() and renameFloor() which verifies
 *          ownership before updating.
 *
 * Returns 200 with the updated floor on success.
 * Returns 404 when the floor is not found in the session's org.
 * Returns 400 on invalid body or a duplicate label in the project.
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
    console.error("[PATCH /api/v1/orgs/[orgSlug]/floors/[id]]", err);
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
    const floor = await renameFloor(session, id, label);
    if (!floor) {
      return apiNotFound("Floor not found or access denied");
    }
    return NextResponse.json({ floor });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "DUPLICATE_FLOOR_LABEL"
    ) {
      return apiBadRequest(err instanceof Error ? err.message : "Invalid request");
    }
    console.error("[PATCH /api/v1/orgs/[orgSlug]/floors/[id]] renameFloor", err);
    return apiServerError();
  }
}

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
