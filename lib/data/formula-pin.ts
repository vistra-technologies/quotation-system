/**
 * Stage 23 Batch 3 — DAL helpers shared by the project create paths and every calculation-invalidation
 * site. The pure compatibility logic lives in lib/formula-compat.ts (Prisma-free); this file is the thin
 * transaction-client glue around it.
 */
import type { Prisma } from "@/app/generated/prisma/client";
import type { ConfigSnapshot } from "@/lib/config-snapshot";
import { checkStructuralCompatibility, describeIncompatibility } from "@/lib/formula-compat";
import type { FormulaSetBody } from "@/lib/summary/types";

export type FormulaPinErrorCode = "NO_ACTIVE_FORMULA_SET" | "FORMULA_SET_INCOMPATIBLE";

/** Typed error thrown by resolveFormulaSetPin — routes map both codes to 409 with `message`. */
export class FormulaPinError extends Error {
  constructor(
    public readonly code: FormulaPinErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FormulaPinError";
  }
}

export function isFormulaPinError(err: unknown): err is FormulaPinError {
  return err instanceof FormulaPinError;
}

/**
 * Inside the create transaction, after the config snapshot is loaded: read the org's active formula set,
 * run the 13a structural check against the snapshot about to be frozen, and return the id to pin on
 * `Project.formulaSetId`. Throws FormulaPinError (NO_ACTIVE_FORMULA_SET / FORMULA_SET_INCOMPATIBLE).
 * Reads only the caller's own org row, and the 409 detail names codes/keys only.
 */
export async function resolveFormulaSetPin(
  tx: Prisma.TransactionClient,
  organizationId: string,
  snapshot: ConfigSnapshot,
): Promise<string> {
  const org = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, activeFormulaSet: { select: { id: true, name: true, version: true, body: true } } },
  });
  if (!org?.activeFormulaSet) {
    throw new FormulaPinError(
      "NO_ACTIVE_FORMULA_SET",
      `Organization ${org?.name ?? organizationId} has no active formula set assigned; a project cannot be created.`,
    );
  }
  const set = org.activeFormulaSet;
  const result = checkStructuralCompatibility(set.body as unknown as FormulaSetBody, snapshot);
  if (!result.ok) {
    throw new FormulaPinError("FORMULA_SET_INCOMPATIBLE", describeIncompatibility(result, set));
  }
  return set.id;
}

/**
 * Drop a project's calculation and re-lock the Summary/Quotation steps (D-17…D-20). Deliberately NOT gated
 * on `designSubmittedAt !== null` for the delete: a calculation can exist with a null flag (after a
 * Recompute, or after an earlier edit already cleared it). The flag is only written when non-null.
 * Call inside the same transaction as the write that changed the design.
 */
export async function invalidateProjectCalculation(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<void> {
  await tx.projectCalculation.deleteMany({ where: { projectId } });
  await tx.project.updateMany({
    where: { id: projectId, designSubmittedAt: { not: null } },
    data: { designSubmittedAt: null },
  });
}
