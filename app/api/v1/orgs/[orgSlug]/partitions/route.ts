import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-error";
import { listPartitionsByRoom } from "@/lib/data/partitions";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/partitions?roomId= ────────────────────────────

/**
 * List all Partitions for a room, ordered by partitionNumber.
 *
 * Stage 18: read-only route added so the design page can render a converted
 * (PARTITION) side's label/height/width — that data lives on the Partition
 * row, not on the Room.sides JSONB element (which only carries partitionId
 * for a PARTITION side; see lib/data/rooms.ts's RoomSide type). Creation and
 * conversion both go exclusively through
 * PATCH /api/v1/orgs/[orgSlug]/rooms/[id]/sides (lib/data/rooms.ts
 * replaceSides) — this route has no POST.
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Tenancy: enforced by getApiSession() (403 on cross-org); listPartitionsByRoom()
 *          filters by organizationId, so a foreign roomId simply yields [].
 *
 * Query params:
 *   roomId (required) — ID of the room to list partitions for.
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
    console.error("[GET /api/v1/orgs/[orgSlug]/partitions]", err);
    return apiServerError();
  }

  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get("roomId");
  if (!roomId) {
    return apiBadRequest("roomId query parameter is required");
  }

  try {
    const partitions = await listPartitionsByRoom(roomId, session.organizationId);
    return NextResponse.json({ partitions });
  } catch (err) {
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/partitions] listPartitionsByRoom",
      err,
    );
    return apiServerError();
  }
}
