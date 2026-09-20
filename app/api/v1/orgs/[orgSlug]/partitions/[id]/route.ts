import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-error";
import {
  getPartitionById,
  updatePartition,
  InvalidDesignError,
} from "@/lib/data/partitions";
import { parseDesignPatch, PartitionDesignError } from "@/lib/partition-design";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/partitions/[id] ───────────────────────────────

/**
 * Get a single Partition, including its `design` JSONB — Configure mode's
 * read path (Stage 18 item 7 Piece 2). The collection route
 * (GET /partitions?roomId=) intentionally omits `design` scope questions
 * (it's a list for label/dims summaries only); this route is the one place
 * the full document is fetched.
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Tenancy: enforced by getApiSession() (403 on cross-org) and
 *          getPartitionById() which verifies the partition belongs to the
 *          session's org.
 */
export async function GET(
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
    console.error("[GET /api/v1/orgs/[orgSlug]/partitions/[id]]", err);
    return apiServerError();
  }

  try {
    const partition = await getPartitionById(id, session.organizationId);
    if (!partition) {
      return apiNotFound("Partition not found or access denied");
    }
    return NextResponse.json({ partition });
  } catch (err) {
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/partitions/[id]] getPartitionById",
      err,
    );
    return apiServerError();
  }
}

// ─── PATCH /api/v1/orgs/[orgSlug]/partitions/[id] ─────────────────────────────

/**
 * Update a Partition's `label`/`heightMm`/`design` — Configure mode's write
 * path (Stage 18 item 7 Piece 2). Same shape as PATCH /rooms/[id]/sides:
 * thin structural validation here (lib/partition-design.ts parseDesignPatch), deeper
 * invariant validation (height sums, cross-tenant selectionId checks, widthMm derivation) in lib/data/partitions.ts
 * updatePartition(), which is the single source of truth for those rules.
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Body: { label?, heightMm?, design? } — all optional, partial-replace.
 *   `design` is the v2 shape (`schemaVersion: 2`, `sections[].cells[]`); a
 *   legacy `panels` body is a 400 (Stage 22).
 *   `widthMm` is NOT accepted directly — it's derived server-side from
 *   `design.sections[].widthMm` whenever sections are patched (Stage 18
 *   invariant 3: a PARTITION side's length on the floor plan IS
 *   Partition.widthMm).
 *
 * Returns 200 with the updated partition on success.
 * Returns 404 when the partition is not found in the session's org.
 * Returns 400 on invalid body shape or a cross-tenant selectionId reference.
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
    console.error("[PATCH /api/v1/orgs/[orgSlug]/partitions/[id]]", err);
    return apiServerError();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiBadRequest("Request body must be valid JSON");
  }

  const label = typeof body.label === "string" ? body.label.trim() : undefined;
  if (body.label !== undefined && !label) {
    return apiBadRequest("label, if provided, must be a non-empty string");
  }
  const heightMm =
    typeof body.heightMm === "number" && body.heightMm > 0
      ? body.heightMm
      : undefined;
  if (body.heightMm !== undefined && heightMm === undefined) {
    return apiBadRequest("heightMm, if provided, must be a positive number");
  }

  let design;
  try {
    design = parseDesignPatch(body.design);
  } catch (err) {
    if (err instanceof PartitionDesignError) {
      return apiBadRequest(err.message);
    }
    throw err;
  }

  try {
    const partition = await updatePartition(session, id, {
      label,
      heightMm,
      design,
    });
    if (!partition) {
      return apiNotFound("Partition not found or access denied");
    }
    return NextResponse.json({ partition });
  } catch (err) {
    if (err instanceof InvalidDesignError) {
      return apiBadRequest(err.message);
    }
    console.error(
      "[PATCH /api/v1/orgs/[orgSlug]/partitions/[id]] updatePartition",
      err,
    );
    return apiServerError();
  }
}
