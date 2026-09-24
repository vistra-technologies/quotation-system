import { NextResponse } from "next/server";
import { requireSuperAdminFromRequest, SuperAdminUnauthorizedError } from "@/lib/superadmin-guard";
import {
  apiBadRequest,
  apiUnauthorized,
  apiConflict,
  apiServerError,
} from "@/lib/api-error";
import {
  listFormulaSets,
  createFormulaSet,
  createFormulaSetAuditLog,
} from "@/lib/data/superadmin/formula-sets";
import { validateFormulaSetBody } from "@/lib/formula-set/validate";

// Never cached.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/superadmin/formula-sets ──────────────────────────────────────
//
// List all formula sets, newest first. `body` is omitted from list items
// (potentially large; detail view provides it).
// Auth: valid SuperAdmin session (qs-sa-token cookie).
//
// Returns 200 with { formulaSets: FormulaSetListItem[] }.
// Returns 401 when not authenticated as SuperAdmin.

export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[GET /api/v1/superadmin/formula-sets] auth error", err);
    return apiServerError();
  }

  try {
    const formulaSets = await listFormulaSets();
    return NextResponse.json({ formulaSets });
  } catch (err) {
    console.error("[GET /api/v1/superadmin/formula-sets] listFormulaSets", err);
    return apiServerError();
  }
}

// ─── POST /api/v1/superadmin/formula-sets ─────────────────────────────────────
//
// Create a new formula set. `body` is validated via validateFormulaSetBody()
// before the row is written.
// Auth: valid SuperAdmin session (qs-sa-token cookie).
// Body: { name: string; version: number; body: object }
//
// Returns 201 with { formulaSet } (full detail shape including body) on success.
// Returns 400 on missing/invalid fields or body validation failure.
// Returns 401 when not authenticated as SuperAdmin.
// Returns 409 if (name, version) already exists.

export async function POST(request: Request): Promise<NextResponse> {
  let sa;
  try {
    sa = await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[POST /api/v1/superadmin/formula-sets] auth error", err);
    return apiServerError();
  }

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

  if (typeof b.name !== "string" || !b.name.trim()) {
    return apiBadRequest("name is required");
  }
  if (typeof b.version !== "number" || !Number.isInteger(b.version) || b.version < 1) {
    return apiBadRequest("version must be a positive integer");
  }
  if (
    b.body === undefined ||
    b.body === null ||
    typeof b.body !== "object" ||
    Array.isArray(b.body)
  ) {
    return apiBadRequest("body must be a non-null object");
  }

  const name = (b.name as string).trim();
  const version = b.version as number;
  const formulaBody = b.body;

  // Validate the formula body before writing.
  const validation = validateFormulaSetBody(formulaBody);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Validation failed", validationErrors: validation.errors },
      { status: 400 },
    );
  }

  let formulaSet;
  try {
    formulaSet = await createFormulaSet({ name, version, body: formulaBody });
  } catch (err) {
    // P2002 = unique constraint violation on @@unique([name, version]).
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return apiConflict("A formula set with this name and version already exists");
    }
    console.error("[POST /api/v1/superadmin/formula-sets] createFormulaSet", err);
    return apiServerError();
  }

  // Write audit log after the mutation committed.
  // Not wrapped in try/catch — an audit failure propagates as 500 (every mutation
  // must have an audit row per Stage 16/17 discipline).
  await createFormulaSetAuditLog(sa.superAdminId, formulaSet.id, "formulaSet.create", {
    name: formulaSet.name,
    version: formulaSet.version,
  });

  return NextResponse.json({ formulaSet }, { status: 201 });
}
