/**
 * The 422 body for unpriced quotation items (Stage 38 S38-5): the existing problem-report shape with kind
 * `MISSING_PRICE`, scope `INVENTORY`, so the reused problem popup renders it. PURE.
 */
import { ProblemCollector, type CalculationProblemReport } from "@/lib/materials/problems";
import type { MissingPrice } from "@/lib/missing-prices";

export function missingPriceReport(missing: ReadonlyArray<MissingPrice>, currency: string): CalculationProblemReport {
  const c = new ProblemCollector();
  for (const m of missing) {
    c.add({
      kind: "MISSING_PRICE",
      scope: "INVENTORY",
      message: `${m.name} (${m.code}) has no ${currency} price.`,
      code: m.code,
      itemName: m.name,
      currency,
    });
  }
  return c.report();
}
