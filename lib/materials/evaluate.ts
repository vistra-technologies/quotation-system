/**
 * Material-list formula evaluator (Stage 24 Batch 4).
 *
 * PURE: no Prisma, no lib/data/* function calls — plain data in, plain data out, unit-testable.
 * Implements the CELL and PARTITION grain walks from formula-engine.md §3.
 *
 * Two key design decisions here:
 *  1. The recording param Proxy (makeParamProxy): every param.* read goes through it so that a
 *     blank field records MISSING_PARAM and returns "" — the Proxy is the *only* path to param values.
 *  2. materialCode substitution is a plain {param.x} replace — never through expr-eval — so a blank
 *     code param gets MISSING_PARAM recorded and returns "" (line dropped), not a parse error.
 */
import { Parser } from "expr-eval";
import type { FormulaSetBody } from "../summary/types";
import type { ConfigSnapshot } from "../config-snapshot";
import type { RoomSide } from "../data/rooms";
import { derivePartitionGeometry } from "./geometry";
import type { ParsedDesign } from "./geometry";
import { ProblemCollector } from "./problems";

const parser = new Parser();

// ─── Output types ────────────────────────────────────────────────────────────

export interface RawMaterialLine {
  /** Substituted materialCode. Never blank — blank-code formulas are dropped (MISSING_PARAM recorded). */
  code: string;
  /** FormulaDef.unit ("metres" | "pieces") */
  unit: string;
  /** Raw requirement; 3dp for metres. NaN/Infinity lines are dropped (NON_FINITE_QUANTITY recorded). */
  requirement: number;
  /** FormulaDef.slot (ComponentType.code) */
  slot: string;
  /** FormulaDef.id — for Batch 5 slot-merging */
  formulaId: string;
  roomId: string;
  partitionId: string;
}

// ─── Evaluator input (pre-processed by buildMaterials in index.ts) ───────────

export interface EvalPartition {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
  parsedDesign: ParsedDesign;
}

export interface EvalRoom {
  id: string;
  label: string;
  isClosed: boolean;
  sides: RoomSide[];
  partitions: EvalPartition[];
}

export interface EvalFloor {
  id: string;
  label: string;
  rooms: EvalRoom[];
}

export interface EvalInput {
  formulaSetBody: FormulaSetBody;
  snapshot: ConfigSnapshot;
  floors: EvalFloor[];
  /** selectionId → { componentTypeId, config } */
  selectionMap: Map<string, { componentTypeId: string; config: Record<string, unknown> }>;
  /** componentTypeId → ComponentType.code (slot code) */
  componentTypeCodeMap: Map<string, string>;
  /** partitionId → ParsedDesign (for neighborDesignResolver) */
  designMap: Map<string, ParsedDesign>;
}

// ─── Recording param Proxy ────────────────────────────────────────────────────

/**
 * Wraps a Selection config object in a Proxy so that every property access is intercepted.
 * A blank or null value triggers `onBlank(key)` (records MISSING_PARAM to the collector) and
 * returns "" — the neutral value that makes conditions evaluate to false and arithmetic to NaN.
 *
 * This Proxy is the ONLY path through which param.* values reach expr-eval or materialCode
 * substitution. A direct config property read anywhere in evaluate.ts would bypass this gate.
 */
function makeParamProxy(
  config: Record<string, unknown>,
  onBlank: (key: string) => void,
): Record<string, unknown> {
  return new Proxy(config, {
    get(target, prop) {
      if (typeof prop !== "string") return undefined;
      const val = target[prop];
      if (val == null || (typeof val === "string" && val.trim() === "")) {
        onBlank(prop);
        return "";
      }
      return val;
    },
  });
}

// ─── materialCode substitution ────────────────────────────────────────────────

/**
 * Replace all `{param.x}` tokens in a materialCode template using readParam.
 * Never run through expr-eval — plain string replace only (formula-engine.md §3, door.md convention).
 * A blank param value → readParam returns "" → code becomes "" → line dropped by the caller.
 */
function substituteCode(template: string, readParam: (k: string) => string): string {
  return template.replace(/\{param\.([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k) => readParam(k));
}

/** Build a readParam function that routes through the param proxy (recording blank accesses). */
function makeReadParam(proxy: Record<string, unknown>): (k: string) => string {
  return (k: string): string => {
    const val = proxy[k]; // triggers Proxy.get — records MISSING_PARAM if blank, returns ""
    if (val == null) return "";
    if (typeof val === "string") return val;
    return String(val);
  };
}

// ─── Condition/quantity evaluation helpers ────────────────────────────────────

function evaluateExpr(expr: string, scope: Record<string, unknown>): number | null {
  try {
    // expr-eval's Value type is narrower than Record<string, unknown>; cast is safe because the
    // Proxy and nested objects expr-eval traverses at runtime behave correctly via property access.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = parser.evaluate(expr, scope as any);
    return typeof result === "number" ? result : Number(result);
  } catch {
    return null;
  }
}

function isConditionTrue(condResult: number | null): boolean {
  if (condResult === null) return false;
  return Boolean(condResult);
}

// ─── Main evaluator ───────────────────────────────────────────────────────────

/**
 * Walk every formula across every partition in every room and produce raw material lines.
 * Does NOT throw — all error conditions go to the collector.
 * CELL pass runs first; PARTITION pass follows. This order matches formula-engine.md §3.
 */
export function evaluateAll(input: EvalInput, collector: ProblemCollector): RawMaterialLine[] {
  const rawLines: RawMaterialLine[] = [];
  const { formulaSetBody, floors, selectionMap, componentTypeCodeMap, designMap } = input;
  const formulas = formulaSetBody.formulas ?? [];
  const cellFormulas = formulas.filter(f => f.grain === "CELL");
  const partitionFormulas = formulas.filter(f => f.grain === "PARTITION");

  // ── CELL grain pass ──────────────────────────────────────────────────────────
  for (const floor of floors) {
    for (const room of floor.rooms) {
      for (const partition of room.partitions) {
        const { parsedDesign } = partition;
        const sections = parsedDesign.sections;
        for (let si = 0; si < sections.length; si++) {
          const section = sections[si];
          for (let ci = 0; ci < section.cells.length; ci++) {
            const cell = section.cells[ci];
            if (!cell.selectionId) continue;

            const sel = selectionMap.get(cell.selectionId);
            if (!sel) continue; // SELECTION_MISSING — phase A concern, skip here

            const slotCode = componentTypeCodeMap.get(sel.componentTypeId);
            if (!slotCode) continue; // SELECTION_TYPE_UNKNOWN — phase A concern, skip here

            const applicable = cellFormulas.filter(f => f.slot === slotCode);
            if (applicable.length === 0) continue;

            // One calcScope per cell — accumulates fired formula quantities for this cell
            const calcScope: Record<string, number> = {};

            // Per-cell blank-field dedup gate: a blank param triggers MISSING_PARAM at most once
            // per (selectionId + fieldKey) per cell evaluation, regardless of how many formulas
            // read that field. This ensures occurrenceCount reflects cells affected, not formulas.
            const cellBlankSeen = new Set<string>();

            for (const formula of applicable) {
              const paramProxy = makeParamProxy(sel.config, (key) => {
                const blankKey = `${cell.selectionId}|${key}`;
                if (cellBlankSeen.has(blankKey)) return; // already recorded for this cell
                cellBlankSeen.add(blankKey);
                collector.add({
                  kind: "MISSING_PARAM",
                  scope: "SELECTION",
                  message: `Formula "${formula.id}": param "${key}" is blank on selection "${cell.selectionId}" (${slotCode})`,
                  locus: {
                    floorId: floor.id,
                    roomId: room.id,
                    partitionId: partition.id,
                    partitionLabel: partition.label,
                    sectionIndex: si,
                    cellIndex: ci,
                    selectionId: cell.selectionId!,
                    componentTypeCode: slotCode,
                    fieldKey: key,
                    formulaId: formula.id,
                  },
                });
              });
              const readParam = makeReadParam(paramProxy);

              const cellScope = { widthMm: section.widthMm, heightMm: cell.heightMm };
              const scope: Record<string, unknown> = { param: paramProxy, cell: cellScope, calc: calcScope };

              // Evaluate condition (absent = always fires)
              if (formula.condition !== undefined) {
                const condResult = evaluateExpr(formula.condition, scope);
                if (!isConditionTrue(condResult)) continue; // condition false or blank-param; skip formula
              }

              // Evaluate quantity
              const qResult = evaluateExpr(formula.quantity, scope);
              const quantity = qResult !== null ? qResult : NaN;

              if (!Number.isFinite(quantity)) {
                collector.add({
                  kind: "NON_FINITE_QUANTITY",
                  scope: "FORMULA_SET",
                  message: `Formula "${formula.id}": quantity is not finite (${quantity}) for selection "${cell.selectionId}"`,
                  locus: {
                    floorId: floor.id,
                    roomId: room.id,
                    partitionId: partition.id,
                    selectionId: cell.selectionId!,
                    formulaId: formula.id,
                  },
                });
                continue;
              }

              // Round metres to 3dp
              const req = formula.unit === "metres" ? Math.round(quantity * 1000) / 1000 : quantity;

              // Substitute materialCode (reads through the same proxy — records MISSING_PARAM if blank)
              const code = substituteCode(formula.materialCode, readParam);
              if (code === "") continue; // MISSING_PARAM already recorded; drop line

              rawLines.push({
                code,
                unit: formula.unit,
                requirement: req,
                slot: slotCode,
                formulaId: formula.id,
                roomId: room.id,
                partitionId: partition.id,
              });

              // Accumulate into calcScope for downstream formulas in this cell's evaluation
              calcScope[formula.id] = req;
            }
          }
        }
      }
    }
  }

  // ── PARTITION grain pass ─────────────────────────────────────────────────────
  for (const floor of floors) {
    for (const room of floor.rooms) {
      for (const partition of room.partitions) {
        const { parsedDesign } = partition;

        // Build slot → first Selection config map (section order, then cell order) for this partition.
        // Confirmed with human (partition.md "No mixed-glass partitions"): every cell in a partition
        // resolves to the same param values, so using the first cell of each slot type is sufficient.
        const slotFirstSel = new Map<string, { selectionId: string; config: Record<string, unknown> }>();
        for (const section of parsedDesign.sections) {
          for (const cell of section.cells) {
            if (!cell.selectionId) continue;
            const sel = selectionMap.get(cell.selectionId);
            if (!sel) continue;
            const slotCode = componentTypeCodeMap.get(sel.componentTypeId);
            if (!slotCode || slotFirstSel.has(slotCode)) continue;
            slotFirstSel.set(slotCode, { selectionId: cell.selectionId, config: sel.config });
          }
        }

        // Build resolvers that close over the maps — kept pure (no DB access)
        const cellSlotResolver = (selId: string): string | null => {
          const s = selectionMap.get(selId);
          if (!s) return null;
          return componentTypeCodeMap.get(s.componentTypeId) ?? null;
        };
        const neighborDesignResolver = (pid: string): ParsedDesign | null =>
          designMap.get(pid) ?? null;

        const geometry = derivePartitionGeometry({
          partitionId: partition.id,
          widthMm: partition.widthMm,
          heightMm: partition.heightMm,
          parsedDesign,
          sides: room.sides,
          isClosed: room.isClosed,
          cellSlotResolver,
          neighborDesignResolver,
        });

        // One calcScope per partition — accumulates fired PARTITION-grain formula quantities
        const calcScope: Record<string, number> = {};

        for (const formula of partitionFormulas) {
          const selInfo = slotFirstSel.get(formula.slot);
          if (!selInfo) continue; // no cell of this slot type in this partition → formula doesn't apply

          const paramProxy = makeParamProxy(selInfo.config, (key) => {
            collector.add({
              kind: "MISSING_PARAM",
              scope: "SELECTION",
              message: `Formula "${formula.id}": param "${key}" is blank on selection "${selInfo.selectionId}" (${formula.slot})`,
              locus: {
                floorId: floor.id,
                roomId: room.id,
                partitionId: partition.id,
                partitionLabel: partition.label,
                selectionId: selInfo.selectionId,
                componentTypeCode: formula.slot,
                fieldKey: key,
                formulaId: formula.id,
              },
            });
          });
          const readParam = makeReadParam(paramProxy);

          const scope: Record<string, unknown> = { param: paramProxy, partition: geometry, calc: calcScope };

          // Evaluate condition (absent = always fires)
          if (formula.condition !== undefined) {
            const condResult = evaluateExpr(formula.condition, scope);
            if (!isConditionTrue(condResult)) continue;
          }

          // Evaluate quantity
          const qResult = evaluateExpr(formula.quantity, scope);
          const quantity = qResult !== null ? qResult : NaN;

          if (!Number.isFinite(quantity)) {
            collector.add({
              kind: "NON_FINITE_QUANTITY",
              scope: "FORMULA_SET",
              message: `Formula "${formula.id}": quantity is not finite (${quantity}) for partition "${partition.id}"`,
              locus: {
                floorId: floor.id,
                roomId: room.id,
                partitionId: partition.id,
                formulaId: formula.id,
              },
            });
            continue;
          }

          const req = formula.unit === "metres" ? Math.round(quantity * 1000) / 1000 : quantity;

          const code = substituteCode(formula.materialCode, readParam);
          if (code === "") continue; // MISSING_PARAM already recorded; drop line

          rawLines.push({
            code,
            unit: formula.unit,
            requirement: req,
            slot: formula.slot,
            formulaId: formula.id,
            roomId: room.id,
            partitionId: partition.id,
          });

          calcScope[formula.id] = req;
        }
      }
    }
  }

  return rawLines;
}
