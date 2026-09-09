import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-error";
import { replaceSides, InvalidSidesError, type IncomingSide } from "@/lib/data/rooms";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── PATCH /api/v1/orgs/[orgSlug]/rooms/[id]/sides ────────────────────────────

/**
 * Full-replace a Room's `sides` array — the single endpoint that handles
 * add/remove/reorder/relabel and the plain<->partition convert compound
 * operations (see lib/data/rooms.ts replaceSides()). All changes are applied
 * in one transaction, so a PATCH is all-or-nothing.
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Body: { sides: IncomingSide[], isClosed? }
 *   Each element: { kind: "PLAIN", turnDegrees, lengthMm?, label? }
 *              or { kind: "PARTITION", turnDegrees, partitionId?, label?, heightMm?, widthMm? }
 *   `partitionId` on a PARTITION element, when it matches an existing side on
 *   this room, keeps that Partition. When it is omitted entirely, the
 *   element is a new plain->partition convert and must carry label,
 *   heightMm, and widthMm to create the Partition row. When it is present
 *   but does NOT match any partition already on this room, the PATCH is
 *   rejected with 400 — it is never silently treated as a new convert
 *   (stale client cache / a partitionId from another room is a client bug,
 *   not an implicit create).
 *
 * Returns 200 with the updated room on success.
 * Returns 404 when the room is not found in the session's org.
 * Returns 400 when `sides` is missing/malformed or violates any of the 3
 * invariants (duplicate partitionId, lengthMm on a PARTITION element,
 * below-3-sides while isClosed).
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
    console.error("[PATCH /api/v1/orgs/[orgSlug]/rooms/[id]/sides]", err);
    return apiServerError();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiBadRequest("Request body must be valid JSON");
  }

  if (!Array.isArray(body.sides)) {
    return apiBadRequest("sides (array) is required");
  }

  const isClosed = typeof body.isClosed === "boolean" ? body.isClosed : undefined;

  // Parse + shape-check each element. Deeper invariant checks (duplicate
  // partitionId, below-3-sides, etc.) happen inside replaceSides() itself,
  // which is the single source of truth for those rules.
  const sides: IncomingSide[] = [];
  for (const raw of body.sides as unknown[]) {
    if (typeof raw !== "object" || raw === null) {
      return apiBadRequest("Each side must be an object");
    }
    const el = raw as Record<string, unknown>;
    const turnDegrees = typeof el.turnDegrees === "number" ? el.turnDegrees : 90;

    if (el.kind === "PARTITION") {
      // Invariant 3 (lengthMm only on PLAIN) — reject rather than silently
      // drop: a client sending lengthMm on a PARTITION element is either
      // confused about which side it's editing or has a stale form state,
      // and dropping the field silently would hide that from them.
      if (el.lengthMm !== undefined && el.lengthMm !== null) {
        return apiBadRequest("lengthMm is not valid on a PARTITION side");
      }
      sides.push({
        kind: "PARTITION",
        turnDegrees,
        partitionId: typeof el.partitionId === "string" ? el.partitionId : null,
        label: typeof el.label === "string" ? el.label : undefined,
        heightMm: typeof el.heightMm === "number" ? el.heightMm : undefined,
        widthMm: typeof el.widthMm === "number" ? el.widthMm : undefined,
      });
    } else if (el.kind === "PLAIN") {
      sides.push({
        kind: "PLAIN",
        turnDegrees,
        lengthMm: typeof el.lengthMm === "number" ? el.lengthMm : null,
        label: typeof el.label === "string" ? el.label : null,
      });
    } else {
      return apiBadRequest(`Each side's kind must be "PLAIN" or "PARTITION"`);
    }
  }

  try {
    const room = await replaceSides(session, id, sides, isClosed);
    if (!room) {
      return apiNotFound("Room not found or access denied");
    }
    return NextResponse.json({ room });
  } catch (err) {
    if (err instanceof InvalidSidesError) {
      return apiBadRequest(err.message);
    }
    console.error(
      "[PATCH /api/v1/orgs/[orgSlug]/rooms/[id]/sides] replaceSides",
      err,
    );
    return apiServerError();
  }
}
