/**
 * Calculation problem types and ProblemCollector (Stage 24 Batch 2).
 *
 * PURE: no Prisma, no lib/data/* imports — plain data in, plain data out, unit-testable.
 * Matches formula-engine.md §8.3 exactly.
 */

/** Every reason a material-list computation can be refused (formula-engine.md §8.3). */
export type CalculationProblemKind =
  // — structural (phase A): the design itself is not submittable —
  | "CELL_UNASSIGNED"          // cell.selectionId is null                        (the existing 13b check)
  | "SELECTION_MISSING"        // selectionId does not resolve within the project (the existing 13b check)
  | "SELECTION_TYPE_UNKNOWN"   // the Selection's componentTypeId is absent from configSnapshot
  // — material (phase B): the design is sound, the data behind it is not —
  | "MISSING_PARAM"            // a dereferenced required param is blank on the Selection
  | "UNRESOLVED_CODE"          // non-blank code, no matching InventoryItem in this org
  | "UNIT_MISMATCH"            // row found, wrong measurementUnit
  | "INACTIVE_ITEM"            // row found, active: false
  | "NON_FINITE_QUANTITY";     // a quantity expression produced NaN/Infinity

/** Where the user has to go to fix the problem. Stage 25 groups the popup by this. */
type ProblemScope = "DESIGN" | "SELECTION" | "INVENTORY" | "FORMULA_SET";

/** Scope order for sorting — lower index = higher priority. */
const SCOPE_ORDER: ProblemScope[] = ["DESIGN", "SELECTION", "INVENTORY", "FORMULA_SET"];

export interface CalculationProblem {
  kind: CalculationProblemKind;
  /** Where the user has to go to fix it. Stage 25 groups the popup by this. */
  scope: ProblemScope;
  /** One self-contained sentence, safe to render verbatim. Must name the thing at fault. */
  message: string;
  /** As much location as the kind has. An INVENTORY-scope problem has no cell. */
  locus?: {
    floorId?: string;
    floorName?: string;
    roomId?: string;
    roomName?: string;
    partitionId?: string;
    partitionLabel?: string;
    sectionIndex?: number;
    cellIndex?: number;
    selectionId?: string;
    componentTypeCode?: string;   // "DOOR" | "GLASS" — the slot
    fieldKey?: string;            // "frameCode", "hasFrame"
    formulaId?: string;           // "frameProfile"
  };
  /** The offending material code (UNRESOLVED_CODE / UNIT_MISMATCH / INACTIVE_ITEM). */
  code?: string;
  /** UNIT_MISMATCH — what the formula declared. */
  expectedUnit?: string;
  /** UNIT_MISMATCH — what the InventoryItem carries. */
  actualUnit?: string;
  /**
   * For aggregate (INVENTORY-scope) problems only: up to 5 places the bad code was billed from.
   */
  occurrences?: Array<{ roomName: string; partitionLabel: string; fieldKey: string }>;
  occurrenceCount?: number;
}

export interface CalculationProblemReport {
  ok: false;
  problems: CalculationProblem[];
  /** problems.length — carried explicitly so a caller need not deserialize the array to count. */
  problemCount: number;
}

/** Maximum occurrence entries stored per deduplicated problem (formula-engine.md §8.3). */
const MAX_OCCURRENCES = 5;

/** Key for deduplication: kind + code + selectionId + fieldKey. */
function dedupeKey(p: CalculationProblem): string {
  return `${p.kind}|${p.code ?? ""}|${p.locus?.selectionId ?? ""}|${p.locus?.fieldKey ?? ""}`;
}

/**
 * Collects CalculationProblems in a single pass, deduplicates, and produces a sorted report.
 * Never throws; never short-circuits — every `add()` call is accepted. The report is a pure
 * snapshot; the collector remains open after `report()` is called.
 */
export class ProblemCollector {
  private readonly _seen = new Map<string, CalculationProblem>();
  private readonly _order: string[] = [];  // insertion order of first occurrence, for stable sort

  /** Accept a problem, deduplicating on (kind, code, selectionId, fieldKey). Never throws. */
  add(problem: CalculationProblem): void {
    const key = dedupeKey(problem);
    const existing = this._seen.get(key);
    if (existing) {
      // Accumulate occurrence count and up to MAX_OCCURRENCES detail entries.
      existing.occurrenceCount = (existing.occurrenceCount ?? 1) + 1;
      if (problem.occurrences && existing.occurrences) {
        if (existing.occurrences.length < MAX_OCCURRENCES) {
          existing.occurrences.push(...problem.occurrences.slice(0, MAX_OCCURRENCES - existing.occurrences.length));
        }
      } else if (problem.occurrences && !existing.occurrences) {
        existing.occurrences = problem.occurrences.slice(0, MAX_OCCURRENCES);
      }
    } else {
      this._seen.set(key, { ...problem });
      this._order.push(key);
    }
  }

  /** True when at least one problem has been added. */
  hasAny(): boolean {
    return this._seen.size > 0;
  }

  /**
   * Produce a sorted, deduplicated CalculationProblemReport. The collector stays open — further
   * `add()` calls after `report()` are still accepted.
   *
   * Sort order: scope (DESIGN < SELECTION < INVENTORY < FORMULA_SET), then kind (alpha within
   * scope), then insertion order within the same (scope, kind) pair.
   */
  report(): CalculationProblemReport {
    const problems = this._order
      .map((key) => this._seen.get(key)!)
      .sort((a, b) => {
        const scopeDiff = SCOPE_ORDER.indexOf(a.scope) - SCOPE_ORDER.indexOf(b.scope);
        if (scopeDiff !== 0) return scopeDiff;
        return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
      });

    return { ok: false, problems, problemCount: problems.length };
  }
}
