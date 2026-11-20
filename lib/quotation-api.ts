/**
 * Shared HTTP mapping for the Stage 38 quotation routes (`.../projects/[projectId]/quotation/**`): the permission
 * gate and the DAL outcome to response table, so the six handlers stay thin and answer identically.
 */
import { NextResponse } from "next/server";
import { apiBadRequest, apiConflict, apiForbidden, apiNotFound, apiServerError, apiUnprocessable } from "@/lib/api-error";
import { log } from "@/lib/logger";
import { ForbiddenError, requirePermission } from "@/lib/rbac";
import { missingPriceReport } from "@/lib/quotation/problems";
import type { QuotationOutcome } from "@/lib/data/quotations";
import type { SessionData } from "@/lib/session";

/** null = the role holds `permission`; otherwise the 403 (or 500) response to return. */
export async function quotationGate(session: SessionData, permission: string, where: string): Promise<NextResponse | null> {
  try {
    await requirePermission(session, permission);
    return null;
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    log.error(`[${where}] requirePermission`, { err });
    return apiServerError();
  }
}

/** The response for a DAL outcome. `okStatus` is 201 for create, 200 otherwise. */
export function quotationResponse(outcome: QuotationOutcome, okStatus = 200): NextResponse {
  switch (outcome.kind) {
    case "ok":
      return NextResponse.json({ quotation: outcome.quotation }, { status: okStatus });
    case "projectNotFound":
      return apiNotFound("Project not found");
    case "noQuotation":
      return apiNotFound("No quotation found for this project", "NO_QUOTATION");
    case "noCalculation":
      return apiUnprocessable("Submit the design first", "NO_CALCULATION");
    case "exists":
      return apiConflict("This project already has a quotation", { code: "QUOTATION_EXISTS" });
    case "ordered":
      return apiConflict("This quotation has been ordered and can no longer be changed", { code: "QUOTATION_ORDERED" });
    case "needsApplyDiscount":
      return apiForbidden("Forbidden: missing permission APPLY_DISCOUNT");
    case "invalidInput":
      return apiBadRequest(outcome.error);
    case "missingPrices":
      // The submit-design problem-report shape (S38-5), MISSING_PRICE problems in the INVENTORY scope.
      return NextResponse.json(missingPriceReport(outcome.missing, outcome.currency), { status: 422 });
  }
}
