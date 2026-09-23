/**
 * Material-list formula engine entry point (Stage 24 Batch 4).
 *
 * PURE: no Prisma, no lib/data/* function calls.
 * `buildMaterials()` is the only public API. It:
 *   1. Returns immediately with empty results for v1 formula sets (no formulas).
 *   2. For v2 sets: builds lookup maps, calls the evaluator, aggregates byRoom.
 *
 * Purity contract: only imports from lib/summary/types.ts, lib/config-snapshot.ts,
 * lib/data/rooms.ts (type-only RoomSide), lib/materials/problems.ts, lib/materials/evaluate.ts,
 * lib/materials/geometry.ts. No Prisma, no lib/data/* function calls.
 */
import type { FormulaSetBody, MaterialByRoomEntry } from "../summary/types";
import type { ConfigSnapshot } from "../config-snapshot";
import type { RoomSide } from "../data/rooms";
import { ProblemCollector } from "./problems";
import { evaluateAll } from "./evaluate";
import type { EvalFloor, EvalInput, RawMaterialLine } from "./evaluate";
import type { ParsedDesign, ParsedSection, ParsedCell } from "./geometry";

export type { RawMaterialLine };

// ─── Input contract ───────────────────────────────────────────────────────────

export interface MaterialsInput {
  formulaSetBody: FormulaSetBody;
  snapshot: ConfigSnapshot;
  floors: Array<{
    id: string;
    label: string;
    rooms: Array<{
      id: string;
      label: string;
      isClosed: boolean;
      sides: RoomSide[];
      partitions: Array<{
        id: string;
        label: string;
        widthMm: number;
        heightMm: number;
        /** Partition.design v2 JSON (unknown — extracted structurally) */
        design: unknown;
      }>;
    }>;
  }>;
  selections: Array<{
    id: string;
    componentTypeId: string;
    config: unknown;
  }>;
}

// ─── Output contract ──────────────────────────────────────────────────────────

export interface MaterialsResult {
  /**
   * Raw lines for every fired formula iteration. Blank-code (MISSING_PARAM) and NaN
   * (NON_FINITE_QUANTITY) formulas are dropped — their problems are in the collector.
   */
  rawLines: RawMaterialLine[];
  /** Per-room material totals: sum of rawLines by (code, unit) per room (no rounding beyond rawLines). */
  byRoom: MaterialByRoomEntry[];
  collector: ProblemCollector;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Extract a minimal ParsedDesign from the stored unknown design JSON.
 * Returns null if the document has no sections array (malformed or v1 legacy).
 */
function extractParsedDesign(design: unknown): ParsedDesign | null {
  if (!isRecord(design)) return null;
  if (!Array.isArray(design.sections)) return null;
  const sections: ParsedSection[] = (design.sections as unknown[]).map(s => {
    if (!isRecord(s)) return { widthMm: 0, cells: [] };
    const widthMm = typeof s.widthMm === "number" ? s.widthMm : 0;
    const cells: ParsedCell[] = Array.isArray(s.cells)
      ? (s.cells as unknown[]).map(c => {
          if (!isRecord(c)) return { heightMm: 0, selectionId: null };
          return {
            heightMm: typeof c.heightMm === "number" ? c.heightMm : 0,
            selectionId: typeof c.selectionId === "string" && c.selectionId ? c.selectionId : null,
          };
        })
      : [];
    return { widthMm, cells };
  });
  return { sections };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function buildMaterials(input: MaterialsInput): MaterialsResult {
  const { formulaSetBody } = input;

  // ── Lookup maps (pure — no Prisma) ───────────────────────────────────────────
  const selectionMap = new Map(
    input.selections.map(s => [
      s.id,
      { componentTypeId: s.componentTypeId, config: isRecord(s.config) ? s.config : {} },
    ]),
  );
  const componentTypeCodeMap = new Map(
    (input.snapshot.componentTypes ?? []).map(t => [t.id, t.code]),
  );

  // Build partitionDesignMap (used by neighborDesignResolver in geometry.ts)
  const designMap = new Map<string, ParsedDesign>();
  for (const floor of input.floors) {
    for (const room of floor.rooms) {
      for (const p of room.partitions) {
        const parsed = extractParsedDesign(p.design);
        if (parsed) designMap.set(p.id, parsed);
      }
    }
  }

  // Collect all rooms (for byRoom — rooms with no lines still appear with lines: [])
  const allRooms: Array<{ id: string; label: string }> = [];
  for (const floor of input.floors) {
    for (const room of floor.rooms) {
      allRooms.push({ id: room.id, label: room.label });
    }
  }

  // ── v1 fast-path: no formulas — return immediately ───────────────────────────
  const isV1 = !formulaSetBody.schemaVersion || formulaSetBody.schemaVersion === 1;
  if (isV1) {
    return {
      rawLines: [],
      byRoom: allRooms.map(r => ({ roomId: r.id, roomLabel: r.label, lines: [] })),
      collector: new ProblemCollector(),
    };
  }

  // ── v2 path ───────────────────────────────────────────────────────────────────
  const evalFloors: EvalFloor[] = input.floors.map(floor => ({
    id: floor.id,
    label: floor.label,
    rooms: floor.rooms.map(room => ({
      id: room.id,
      label: room.label,
      isClosed: room.isClosed,
      sides: room.sides,
      partitions: room.partitions.map(p => ({
        id: p.id,
        label: p.label,
        widthMm: p.widthMm,
        heightMm: p.heightMm,
        parsedDesign: designMap.get(p.id) ?? { sections: [] },
      })),
    })),
  }));

  const evalInput: EvalInput = {
    formulaSetBody,
    snapshot: input.snapshot,
    floors: evalFloors,
    selectionMap,
    componentTypeCodeMap,
    designMap,
  };

  const collector = new ProblemCollector();
  const rawLines = evaluateAll(evalInput, collector);

  // ── byRoom aggregation ────────────────────────────────────────────────────────
  // Group rawLines by roomId, then by (code, unit), summing requirement.
  // All rooms appear (with lines: [] when no formulas fired for them).
  const roomLineMap = new Map<string, Map<string, { code: string; unit: string; requirement: number }>>();
  for (const r of allRooms) {
    roomLineMap.set(r.id, new Map());
  }
  for (const line of rawLines) {
    let linesByCode = roomLineMap.get(line.roomId);
    if (!linesByCode) {
      linesByCode = new Map();
      roomLineMap.set(line.roomId, linesByCode);
    }
    const key = `${line.code}|${line.unit}`;
    const existing = linesByCode.get(key);
    if (existing) {
      existing.requirement += line.requirement;
    } else {
      linesByCode.set(key, { code: line.code, unit: line.unit, requirement: line.requirement });
    }
  }

  const byRoom: MaterialByRoomEntry[] = allRooms.map(r => ({
    roomId: r.id,
    roomLabel: r.label,
    lines: Array.from(roomLineMap.get(r.id)?.values() ?? []),
  }));

  return { rawLines, byRoom, collector };
}
