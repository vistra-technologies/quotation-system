import { NextResponse } from "next/server";
import { requireSuperAdminFromRequest, SuperAdminUnauthorizedError } from "@/lib/superadmin-guard";
import {
  apiUnauthorized,
  apiNotFound,
  apiConflict,
  apiServerError,
} from "@/lib/api-error";
import {
  newVersionOfFormulaSet,
  createFormulaSetAuditLog,
} from "@/lib/data/superadmin/formula-sets";

// Never cached.
export const dynamic = "force-dynamic";

// ─── POST /api/v1/superadmin/formula-sets/[setId]/version ─────────────────────
//
// "New version" action: copies the source set's body to a new row with
// version = max(version for name) + 1. The source set is identified by setId;
// its name is inherited unless the caller supplies a `name` override (fork).
// Auth: valid SuperAdmin session (qs-sa-token cookie).
// Body: { name?: string } — optional; omit to inherit source name.
//
// Returns 201 with { formulaSet } (full detail shape) on success.
// Returns 401 when not authenticated as SuperAdmin.
// Returns 404 if the source set is not found.
// Returns 409 if the resulting (name, version) already exists (guarded, not expected in practice).

export async function POST(
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
    console.error("[POST /api/v1/superadmin/formula-sets/[setId]/version] auth error", err);
    return apiServerError();
  }

  const { setId } = await params;

  // Body is optional — only a name override is accepted; an absent or empty body is fine.
  let nameOverride: string | undefined;
  try {
    const bodyRaw = (await request.json()) as Record<string, unknown>;
    if (
      typeof bodyRaw === "object" &&
      bodyRaw !== null &&
      typeof bodyRaw.name === "string" &&
      (bodyRaw.name as string).trim()
    ) {
      nameOverride = (bodyRaw.name as string).trim();
    }
  } catch {
    // Absent or non-JSON body — treat as no name override.
  }

  let formulaSet;
  try {
    formulaSet = await newVersionOfFormulaSet(setId, nameOverride);
  } catch (err) {
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
    console.error(
      "[POST /api/v1/superadmin/formula-sets/[setId]/version] newVersionOfFormulaSet",
      err,
    );
    return apiServerError();
  }

  if (!formulaSet) return apiServerError();

  // Write audit log after the mutation committed.
  await createFormulaSetAuditLog(sa.superAdminId, formulaSet.id, "formulaSet.newVersion", {
    sourceSetId: setId,
    name: formulaSet.name,
    version: formulaSet.version,
  });

  return NextResponse.json({ formulaSet }, { status: 201 });
}
