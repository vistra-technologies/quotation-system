/**
 * Material-list resolver and project-wide aggregator (Stage 24 Batch 5).
 *
 * PURE: no Prisma, no lib/data/* function calls.
 * `resolveAndAggregate()` is the only public API. It:
 *   1. Aggregates rawLines by (code, unit), summing requirement and merging slots.
 *   2. Resolves each group against the inventory map (UNRESOLVED_CODE / INACTIVE_ITEM / UNIT_MISMATCH).
 *   3. Rounds ONCE on the project total (ceil when soldInWholePacks, exact otherwise), never per-room, never per rawLine.
 *   4. Sorts the resulting list deterministically by (code, unit).
 *
 * Purity contract: imports only from lib/summary/types, lib/materials/evaluate (type-only),
 * lib/materials/problems (type-only), and lib/data/inventory (type-only InventoryRow shape).
 * No Prisma, no lib/data/* function calls.
 */
import type { MaterialListLine } from "@/lib/summary/types";
import type { RawMaterialLine } from "@/lib/materials/evaluate";
import type { InventoryRow } from "@/lib/data/inventory";
import type { ProblemCollector } from "@/lib/materials/problems";

// ─── Internal aggregate group ─────────────────────────────────────────────────

interface AggGroup {
  code: string;
  unit: string;
  requirement: number;
  slots: Set<string>;
  /** Up to 5 rawLines kept for occurrence reporting on failure. */
  sampleLines: RawMaterialLine[];
  /** Total number of rawLines in the group (for occurrenceCount). */
  lineCount: number;
}

// ─── Quantity rounding (Stage 37 Q-D16) ───────────────────────────────────────

/**
 * Tolerance in packs: a float sum a hair above a whole number (27.000000000000004) must not buy an
 * extra pack. Tiny on purpose (1e-9 pack); real requirements are never this close to a boundary.
 */
const PACK_EPSILON = 1e-9;

/**
 * Round half up (away from zero for negatives) to `dp` decimals. Numeric, so it is finite for every
 * finite input (no exponent-string parsing). `toPrecision(15)` absorbs 1.005 * 100 float drift.
 */
function roundHalfUp(x: number, dp: number): number {
  if (!Number.isFinite(x)) return 0;
  const f = 10 ** dp;
  const scaled = Number((Math.abs(x) * f).toPrecision(15));
  const r = Math.round(scaled) / f;
  return r === 0 ? 0 : Math.sign(x) * r;
}

/**
 * Quantity to buy for one aggregated (code, unit) group. `perUnit` must be > 0 (step 2e guards it).
 * Whole packs: ceil once on the project total, minus the tolerance, at least 1 pack for any positive
 * requirement. Not whole packs: the exact ratio, 3 decimals for metres and 2 for every other unit.
 */
export function itemQuantity(
  requirement: number,
  perUnit: number,
  soldInWholePacks: boolean,
  unit: string,
): number {
  const ratio = requirement / perUnit;
  if (soldInWholePacks) {
    return ratio > 0 ? Math.max(1, Math.ceil(ratio - PACK_EPSILON)) : 0;
  }
  return roundHalfUp(ratio, unit === "metres" ? 3 : 2);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Aggregate, resolve, and sort rawLines into a final MaterialListLine[].
 *
 * @param rawLines      Output of buildMaterials() — one line per formula firing.
 * @param inventoryMap  All InventoryItems for the org, keyed by code (including inactive).
 * @param collector     Phase-B ProblemCollector (shared with the evaluator — problems are added here).
 * @param roomLabels    roomId → human label, used in occurrence loci.
 * @param partitionLabels  partitionId → human label, used in occurrence loci.
 * @returns Resolved, sorted MaterialListLine[]. Empty if all lines resolve clean (no problems added).
 */
export function resolveAndAggregate(
  rawLines: RawMaterialLine[],
  inventoryMap: Map<string, InventoryRow>,
  collector: ProblemCollector,
  roomLabels: Map<string, string>,
  partitionLabels: Map<string, string>,
): MaterialListLine[] {
  // ── Step 1: aggregate by (code, unit) ──────────────────────────────────────
  const groups = new Map<string, AggGroup>();

  for (const line of rawLines) {
    const key = `${line.code}|${line.unit}`;
    const existing = groups.get(key);
    if (existing) {
      existing.requirement += line.requirement;
      existing.slots.add(line.slot);
      if (existing.sampleLines.length < 5) existing.sampleLines.push(line);
      existing.lineCount++;
    } else {
      groups.set(key, {
        code: line.code,
        unit: line.unit,
        requirement: line.requirement,
        slots: new Set([line.slot]),
        sampleLines: [line],
        lineCount: 1,
      });
    }
  }

  // ── Step 2: resolve each group ─────────────────────────────────────────────
  const materialList: MaterialListLine[] = [];

  for (const group of groups.values()) {
    const { code, unit, requirement, slots, sampleLines, lineCount } = group;

    /** Build the occurrences[] array for a failed group (up to 5 entries). */
    const buildOccurrences = () =>
      sampleLines.map((l) => ({
        roomName: roomLabels.get(l.roomId) ?? l.roomId,
        partitionLabel: partitionLabels.get(l.partitionId) ?? l.partitionId,
        fieldKey: l.formulaId, // D-F: formulaId used as fieldKey (informational)
      }));

    // Step 2a: blank code → MISSING_PARAM (should be unreachable — evaluator drops blank-code lines)
    if (!code) {
      collector.add({
        kind: "MISSING_PARAM",
        scope: "SELECTION",
        message:
          "Material code is blank — evaluator should have caught this; please report.",
        occurrences: buildOccurrences(),
        occurrenceCount: lineCount,
      });
      continue;
    }

    // Step 2b: code not in inventory map → UNRESOLVED_CODE
    const item = inventoryMap.get(code);
    if (item === undefined) {
      collector.add({
        kind: "UNRESOLVED_CODE",
        scope: "INVENTORY",
        message: `No inventory item found for code "${code}"`,
        code,
        occurrences: buildOccurrences(),
        occurrenceCount: lineCount,
      });
      continue;
    }

    // Step 2c: inactive → INACTIVE_ITEM
    if (!item.active) {
      collector.add({
        kind: "INACTIVE_ITEM",
        scope: "INVENTORY",
        message: `Inventory item "${code}" is inactive`,
        code,
        occurrences: buildOccurrences(),
        occurrenceCount: lineCount,
      });
      continue;
    }

    // Step 2d: unit mismatch → UNIT_MISMATCH (no quantity division attempted)
    if (item.measurementUnit !== unit) {
      collector.add({
        kind: "UNIT_MISMATCH",
        scope: "INVENTORY",
        message: `Unit mismatch for code "${code}": formula expects "${unit}", inventory has "${item.measurementUnit}"`,
        code,
        expectedUnit: unit,
        actualUnit: item.measurementUnit,
        occurrences: buildOccurrences(),
        occurrenceCount: lineCount,
      });
      continue;
    }

    // Step 2e: guard against bad inventory data — perUnitQuantity must be a positive number.
    // Division by 0 → Infinity (JSON serialises as null); negative → nonsense quantity.
    // Not reachable through the current seed or UI (no inventory admin exists yet), but
    // a future bad import would silently produce wrong numbers without this check.
    if (!(item.perUnitQuantity > 0)) {
      collector.add({
        kind: "NON_FINITE_QUANTITY",
        scope: "INVENTORY",
        message: `Inventory item "${code}" has invalid perUnitQuantity (${item.perUnitQuantity}) — must be > 0`,
        code,
        occurrences: buildOccurrences(),
        occurrenceCount: lineCount,
      });
      continue;
    }

    // Step 2f: success: rounding applied ONCE here on the project total (Q-D16)
    const quantity = itemQuantity(requirement, item.perUnitQuantity, item.soldInWholePacks, unit);
    const slotArr = Array.from(slots);
    materialList.push({
      code,
      name: item.name,
      slot: slotArr.length === 1 ? slotArr[0] : slotArr,
      unit,
      requirement,
      perUnitQuantity: item.perUnitQuantity,
      quantity,
    });
  }

  // ── Step 3: sort by (code, unit) for determinism ───────────────────────────
  materialList.sort((a, b) => {
    if (a.code < b.code) return -1;
    if (a.code > b.code) return 1;
    if (a.unit < b.unit) return -1;
    if (a.unit > b.unit) return 1;
    return 0;
  });

  return materialList;
}
