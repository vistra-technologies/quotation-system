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
  type DesignPanel,
  type DesignStops,
  type PartitionDesign,
} from "@/lib/data/partitions";

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

function parseDesign(raw: unknown): PartitionDesign | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null) {
    throw new InvalidDesignError("design must be an object");
  }
  const el = raw as Record<string, unknown>;
  const design: PartitionDesign = {};

  if (el.measurements !== undefined) design.measurements = el.measurements;
  if (el.distribution !== undefined) design.distribution = el.distribution;

  if (el.stops !== undefined) {
    if (typeof el.stops !== "object" || el.stops === null) {
      throw new InvalidDesignError("design.stops must be an object");
    }
    const rawStops = el.stops as Record<string, unknown>;
    const stops: DesignStops = {};
    for (const side of ["top", "bottom", "left", "right"] as const) {
      const value = rawStops[side];
      if (value === undefined) continue;
      if (value !== null && typeof value !== "string") {
        throw new InvalidDesignError(`design.stops.${side} must be a string or null`);
      }
      stops[side] = value;
    }
    design.stops = stops;
  }

  if (el.panels !== undefined) {
    if (!Array.isArray(el.panels)) {
      throw new InvalidDesignError("design.panels must be an array");
    }
    design.panels = el.panels.map((rawPanel, i) => {
      if (typeof rawPanel !== "object" || rawPanel === null) {
        throw new InvalidDesignError(`design.panels[${i}] must be an object`);
      }
      const p = rawPanel as Record<string, unknown>;
      if (typeof p.id !== "string" || !p.id) {
        throw new InvalidDesignError(`design.panels[${i}].id is required`);
      }
      if (p.type !== "glass" && p.type !== "door") {
        throw new InvalidDesignError(`design.panels[${i}].type must be "glass" or "door"`);
      }
      if (typeof p.widthMm !== "number" || p.widthMm <= 0) {
        throw new InvalidDesignError(`design.panels[${i}].widthMm must be a positive number`);
      }
      if (typeof p.heightMm !== "number" || p.heightMm <= 0) {
        throw new InvalidDesignError(`design.panels[${i}].heightMm must be a positive number`);
      }
      const panel: DesignPanel = {
        id: p.id,
        type: p.type,
        widthMm: p.widthMm,
        heightMm: p.heightMm,
        selectionId:
          typeof p.selectionId === "string" ? p.selectionId : null,
      };
      if (p.door !== undefined && p.door !== null) {
        if (typeof p.door !== "object") {
          throw new InvalidDesignError(`design.panels[${i}].door must be an object or null`);
        }
        const d = p.door as Record<string, unknown>;
        if (typeof d.selectionId !== "string" || !d.selectionId) {
          throw new InvalidDesignError(`design.panels[${i}].door.selectionId is required`);
        }
        panel.door = {
          selectionId: d.selectionId,
          hinging: d.hinging === "right" ? "right" : "left",
          outerFrame:
            typeof d.outerFrame === "object" && d.outerFrame !== null
              ? (d.outerFrame as { w: number; h: number })
              : undefined,
        };
      }
      // Note: panels[].index is intentionally never read/written — array
      // position is authoritative (04-data-model.md's own ruling; carried
      // over from the room sides[] precedent).
      return panel;
    });
  }

  return design;
}

/**
 * Update a Partition's `label`/`heightMm`/`design` — Configure mode's write
 * path (Stage 18 item 7 Piece 2). Same shape as PATCH /rooms/[id]/sides:
 * thin structural validation here, deeper invariant validation (cross-tenant
 * selectionId checks, widthMm derivation) in lib/data/partitions.ts
 * updatePartition(), which is the single source of truth for those rules.
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Body: { label?, heightMm?, design? } — all optional, partial-replace.
 *   `widthMm` is NOT accepted directly — it's derived server-side from
 *   `design.panels[].widthMm` whenever panels are patched (Stage 18
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
    design = parseDesign(body.design);
  } catch (err) {
    if (err instanceof InvalidDesignError) {
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
