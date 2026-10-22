import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError, apiAuthErrorResponse } from "@/lib/api-auth";
import { apiNotFound, apiBadRequest, apiConflict, apiServerError } from "@/lib/api-error";
import { duplicateRoom } from "@/lib/data/room-duplicate";
import { log } from "@/lib/logger";
import { withRoute } from "@/lib/with-route";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── POST /api/v1/orgs/[orgSlug]/rooms/[id]/duplicate ─────────────────────────

/**
 * Duplicate a Room with all its partitions (Stage 34 S34-5), on the same floor, in one transaction.
 *
 * Auth: any authenticated org member (no specific RBAC permission required), like every room route.
 * No project-status gate (D-3). Body: { label } — the copy's name.
 * Tenancy: getApiSession() (403 cross-org) and duplicateRoom(), which scopes the source by the session's
 *          org and (external users) company.
 *
 * Returns 201 { room }. 404 when the room is missing or foreign (identical). 400 on a bad body or label.
 * 409 { code: "DUPLICATE_ROOM_LABEL" } when the floor already has a room with that name.
 */
export const POST = withRoute(
  "POST /api/v1/orgs/[orgSlug]/rooms/[id]/duplicate",
  async (
    request: Request,
    { params }: { params: Promise<{ orgSlug: string; id: string }> },
  ) => {
    const { orgSlug, id } = await params;

    let session;
    try {
      session = await getApiSession(request, orgSlug);
    } catch (err) {
      if (err instanceof ApiAuthError) {
        return apiAuthErrorResponse(err);
      }
      log.error("[POST /api/v1/orgs/[orgSlug]/rooms/[id]/duplicate]", { err });
      return apiServerError();
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return apiBadRequest("Request body must be valid JSON");
    }

    const label = typeof body.label === "string" ? body.label.trim() : null;
    if (!label) {
      return apiBadRequest("label is required");
    }

    try {
      const room = await duplicateRoom(session, id, label);
      if (!room) {
        return apiNotFound("Room not found or access denied");
      }
      return NextResponse.json({ room }, { status: 201 });
    } catch (err) {
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "DUPLICATE_ROOM_LABEL"
      ) {
        return apiConflict(err instanceof Error ? err.message : "Room name already exists", {
          code: "DUPLICATE_ROOM_LABEL",
        });
      }
      log.error("[POST /api/v1/orgs/[orgSlug]/rooms/[id]/duplicate] duplicateRoom", { err });
      return apiServerError();
    }
  },
);
