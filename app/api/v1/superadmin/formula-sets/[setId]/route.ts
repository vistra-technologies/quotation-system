import { NextResponse } from "next/server";
import { requireSuperAdminFromRequest, SuperAdminUnauthorizedError } from "@/lib/superadmin-guard";
import {
  apiBadRequest,
  apiUnauthorized,
  apiNotFound,
  apiConflict,
  apiServerError,
} from "@/lib/api-error";
import {
  getFormulaSet,
  updateFormulaSet,
  deleteFormulaSet,
  createFormulaSetAuditLog,
  FormulaSetInUseError,
} from "@/lib/data/superadmin/formula-sets";
import { validateFormulaSetBody } from "@/lib/formula-set/validate";

// Never cached.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/superadmin/formula-sets/[setId] ──────────────────────────────
//
// Returns a single formula set including body and in-use counts.
// Auth: valid SuperAdmin session (qs-sa-token cookie).
//
// Returns 200 with { formulaSet } (full detail shape including body).
// Returns 401 when not authenticated as SuperAdmin.
// Returns 404 if not found.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ setId: string }> },
): Promise<NextResponse> {
  try {
    await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[GET /api/v1/superadmin/formula-sets/[setId]] auth error", err);
    return apiServerError();
  }

  const { setId } = await params;

  try {
    const formulaSet = await getFormulaSet(setId);
    if (!formulaSet) return apiNotFound("FormulaSet not found");
    return NextResponse.json({ formulaSet });
  } catch (err) {
    console.error("[GET /api/v1/superadmin/formula-sets/[setId]] getFormulaSet", err);
    return apiServerError();
  }
}

// ─── PATCH /api/v1/superadmin/formula-sets/[setId] ────────────────────────────
//
// Update name, version, or body of a formula set that is not in use.
// If the set is in use, returns 409 with inUseBy counts.
// The in-use check and update run in a single $transaction (no race).
// Auth: valid SuperAdmin session (qs-sa-token cookie).
// Body: { name?: string; version?: number; body?: object } — at least one field required.
//
// Returns 200 with { formulaSet } (full detail shape) on success.
// Returns 400 on bad input or body validation failure.
// Returns 401 when not authenticated as SuperAdmin.
// Returns 404 if the set is not found.
// Returns 409 if the set is in use (locked) or if (name, version) already exists.

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ setId: string }> },
): Promise<NextResponse> {
  let sa;
  try {
    sa = await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[PATCH /api/v1/superadmin/formula-sets/[setId]] auth error", err);
    return apiServerError();
  }

  const { setId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiBadRequest("Invalid JSON body");
  }

  if (typeof body !== "object" || body === null) {
    return apiBadRequest("Invalid JSON body");
  }

  const b = body as Record<string, unknown>;

  // Build the patch from optional fields.
  const patch: Partial<Parameters<typeof updateFormulaSet>[1]> = {};

  if (b.name !== undefined) {
    if (typeof b.name !== "string" || !(b.name as string).trim()) {
      return apiBadRequest("name must be a non-empty string");
    }
    patch.name = (b.name as string).trim();
  }
  if (b.version !== undefined) {
    if (
      typeof b.version !== "number" ||
      !Number.isInteger(b.version) ||
      (b.version as number) < 1
    ) {
      return apiBadRequest("version must be a positive integer");
    }
    patch.version = b.version as number;
  }
  if (b.body !== undefined) {
    if (b.body === null || typeof b.body !== "object" || Array.isArray(b.body)) {
      return apiBadRequest("body must be a non-null object");
    }
    // Validate before opening the transaction.
    const validation = validateFormulaSetBody(b.body);
    if (!validation.ok) {
      return NextResponse.json(
        { error: "Validation failed", validationErrors: validation.errors },
        { status: 400 },
      );
    }
    patch.body = b.body;
  }

  if (Object.keys(patch).length === 0) {
    return apiBadRequest("At least one field (name, version, body) must be provided");
  }

  let formulaSet;
  try {
    formulaSet = await updateFormulaSet(setId, patch);
  } catch (err) {
    if (err instanceof FormulaSetInUseError) {
      return NextResponse.json(
        {
          error: "Formula set is in use and cannot be edited",
          inUseBy: err.inUseBy,
        },
        { status: 409 },
      );
    }
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return apiNotFound("FormulaSet not found");
    }
    // P2002 = unique constraint violation on @@unique([name, version]).
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return apiConflict("A formula set with this name and version already exists");
    }
    console.error("[PATCH /api/v1/superadmin/formula-sets/[setId]] updateFormulaSet", err);
    return apiServerError();
  }

  if (!formulaSet) return apiServerError();

  // Write audit log after the mutation committed.
  await createFormulaSetAuditLog(sa.superAdminId, setId, "formulaSet.update", {
    name: formulaSet.name,
    version: formulaSet.version,
    patchedFields: Object.keys(patch),
  });

  return NextResponse.json({ formulaSet });
}

// ─── DELETE /api/v1/superadmin/formula-sets/[setId] ───────────────────────────
//
// Hard-delete a formula set that is not in use (hotfix 2026-09-25, H-1).
// The in-use check and the delete run in a single $transaction (no race).
// Auth: valid SuperAdmin session (qs-sa-token cookie).
//
// Returns 200 with { id } on success.
// Returns 401 when not authenticated as SuperAdmin.
// Returns 404 if the set is not found.
// Returns 409 with inUseBy counts if the set is in use (locked).

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ setId: string }> },
): Promise<NextResponse> {
  let sa;
  try {
    sa = await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[DELETE /api/v1/superadmin/formula-sets/[setId]] auth error", err);
    return apiServerError();
  }

  const { setId } = await params;

  let deleted;
  try {
    deleted = await deleteFormulaSet(setId);
  } catch (err) {
    if (err instanceof FormulaSetInUseError) {
      return NextResponse.json(
        {
          error: "Formula set is in use and cannot be deleted",
          inUseBy: err.inUseBy,
        },
        { status: 409 },
      );
    }
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return apiNotFound("FormulaSet not found");
    }
    // P2003 = FK restrict violation — a reference appeared that the count missed.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2003"
    ) {
      return apiConflict("Formula set is in use and cannot be deleted");
    }
    console.error("[DELETE /api/v1/superadmin/formula-sets/[setId]] deleteFormulaSet", err);
    return apiServerError();
  }

  // Write audit log after the mutation committed.
  await createFormulaSetAuditLog(sa.superAdminId, setId, "formulaSet.delete", {
    name: deleted.name,
    version: deleted.version,
  });

  return NextResponse.json({ id: setId });
}
