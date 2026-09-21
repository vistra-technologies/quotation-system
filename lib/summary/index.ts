/**
 * Summary builder (Stage 23 Batch 4) — pure TypeScript, no Prisma, no lib/data/*, no DB.
 *
 * Turns a project's floors/rooms/partitions (v2 designs) + Selections into the `ProjectCalculation.summary`
 * document (stage-23.md "Summary output shape"). Resolution is snapshot-only: cell.selectionId ->
 * Selection.componentTypeId -> snapshot.componentTypes[].id -> code -> FormulaSet slot (role + summaryParams).
 * Live ComponentType rows are never consulted. This is a summary builder, not a formula engine (D-39):
 * no evaluator, no coercion, `materialList` is always [].
 *
 * Any hard failure (null selectionId, unknown type/slot, blank required summary value, malformed design)
 * makes the whole result FAILED with an `errorDetail` — never a partial or NaN summary.
 */
import type { ConfigSnapshot } from "../config-snapshot";
import type {
  DoorRow,
  FormulaSlot,
  GlassRow,
  Summary,
  SummaryFloor,
  SummaryInput,
  SummaryResult,
  SummaryWall,
} from "./types";

export type * from "./types";

class SummaryFailure extends Error {}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isPositiveFinite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** null-safe, byte-deterministic string comparison (null sorts first). */
function cmp(a: string | null, b: string | null): number {
  const x = a ?? "";
  const y = b ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
}

interface ResolvedSelection {
  typeCode: string;
  slot: FormulaSlot;
  config: Record<string, unknown>;
  required: Set<string>; // fieldsSchema keys the org marks required:true
}

/**
 * Read one role param (e.g. "glassType") through the slot's summaryParams -> the org field key ->
 * the Selection's raw config value. Blank/missing -> null, unless the org marks the key required (FAIL).
 */
function readParam(
  sel: ResolvedSelection,
  param: string,
  where: string,
): string | null {
  const fieldKey = sel.slot.summaryParams?.[param];
  if (!fieldKey) return null;
  const raw = sel.config[fieldKey];
  let value: string | null = null;
  if (typeof raw === "string") value = raw.trim() === "" ? null : raw; // carried verbatim
  else if (typeof raw === "number" && Number.isFinite(raw)) value = String(raw);
  if (value === null && sel.required.has(fieldKey)) {
    throw new SummaryFailure(
      `${where}: required field "${fieldKey}" (${param}) is blank on selection of type ${sel.typeCode}`,
    );
  }
  return value;
}

function requiredKeys(fieldsSchema: unknown): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(fieldsSchema)) {
    for (const f of fieldsSchema) {
      if (isRecord(f) && typeof f.key === "string" && f.required === true) out.add(f.key);
    }
  }
  return out;
}

function emptySummary(): Summary {
  return { floors: [], kpis: { totalPartitionSqm: 0, sqmByGlassType: [], doorsByType: [] } };
}

function build(input: SummaryInput): Summary {
  const { formulaSetBody, snapshot } = input;
  const slots = isRecord(formulaSetBody?.slots) ? formulaSetBody.slots : {};
  const selectionById = new Map(input.selections.map((s) => [s.id, s]));
  // A non-null but malformed snapshot (missing/non-array componentTypes) must fail cleanly like a null
  // one, never crash with a raw TypeError (review-7 MINOR — Batch 5's 13b/noFormulaSet guard only catches
  // an actually-null snapshot; this is the builder's own backstop for a corrupt-but-present one).
  const componentTypes = Array.isArray((snapshot as ConfigSnapshot | undefined)?.componentTypes)
    ? (snapshot as ConfigSnapshot).componentTypes
    : null;
  if (!componentTypes) {
    throw new SummaryFailure("project configuration snapshot is malformed — componentTypes is missing");
  }
  const typeById = new Map(componentTypes.map((t) => [t.id, t]));

  const resolved = new Map<string, ResolvedSelection>();
  function resolve(selectionId: string, where: string): ResolvedSelection {
    const hit = resolved.get(selectionId);
    if (hit) return hit;
    const sel = selectionById.get(selectionId);
    if (!sel) throw new SummaryFailure(`${where}: selection ${selectionId} not found`);
    const type = typeById.get(sel.componentTypeId);
    if (!type) {
      throw new SummaryFailure(
        `${where}: component type ${sel.componentTypeId} is not in the project's config snapshot`,
      );
    }
    const slot = slots[type.code];
    if (!slot || typeof slot.role !== "string") {
      throw new SummaryFailure(`${where}: component type ${type.code} has no slot in the formula set`);
    }
    const r: ResolvedSelection = {
      typeCode: type.code,
      slot,
      config: isRecord(sel.config) ? sel.config : {},
      required: requiredKeys(type.fieldsSchema),
    };
    resolved.set(selectionId, r);
    return r;
  }

  // Unrounded accumulators for KPIs.
  let totalArea = 0;
  const areaByPair = new Map<string, { glassType: string | null; thickness: string | null; area: number }>();
  const doorsByType = new Map<string, { doorType: string | null; quantity: number }>();

  const floors: SummaryFloor[] = input.floors.map((floor) => ({
    floorId: floor.id,
    floorLabel: floor.label,
    rooms: floor.rooms.map((room) => ({
      roomId: room.id,
      roomLabel: room.label,
      walls: room.partitions.map((p): SummaryWall => {
        const design = p.design;
        const sections = isRecord(design) && Array.isArray(design.sections) ? design.sections : null;
        if (!sections) {
          throw new SummaryFailure(`partition "${p.label}" (${p.id}): design has no sections[]`);
        }
        const glass: GlassRow[] = [];
        const doorGroups = new Map<string, DoorRow>();

        for (const section of sections) {
          if (!isRecord(section) || !Array.isArray(section.cells) || !isPositiveFinite(section.widthMm)) {
            throw new SummaryFailure(`partition "${p.label}" (${p.id}): malformed section`);
          }
          const widthMm = section.widthMm;
          for (const cell of section.cells) {
            const cellId = isRecord(cell) && typeof cell.id === "string" ? cell.id : "?";
            const where = `partition "${p.label}" (${p.id}), cell ${cellId}`;
            if (!isRecord(cell) || !isPositiveFinite(cell.heightMm)) {
              throw new SummaryFailure(`${where}: malformed cell`);
            }
            if (typeof cell.selectionId !== "string" || cell.selectionId === "") {
              throw new SummaryFailure(`${where}: no selection assigned`);
            }
            const heightMm = cell.heightMm;
            const sel = resolve(cell.selectionId, where);

            if (sel.slot.role === "glass") {
              const glassType = readParam(sel, "glassType", where);
              const thickness = readParam(sel, "thickness", where);
              const area = (widthMm * heightMm) / 1e6;
              totalArea += area;
              const key = JSON.stringify([glassType, thickness]);
              const agg = areaByPair.get(key);
              if (agg) agg.area += area;
              else areaByPair.set(key, { glassType, thickness, area });
              glass.push({ glassType, thickness, widthMm, heightMm, areaM2: round4(area) });
            } else if (sel.slot.role === "door") {
              const handing: "LH" | "RH" = cell.hinging === "right" ? "RH" : "LH";
              const category = readParam(sel, "category", where);
              const doorType = readParam(sel, "doorType", where);
              // Aggregate within THIS wall only (D-40) — the map is per-partition.
              const key = JSON.stringify([widthMm, heightMm, handing, category, doorType]);
              const row = doorGroups.get(key);
              if (row) row.quantity += 1;
              else doorGroups.set(key, { widthMm, heightMm, handing, category, doorType, quantity: 1 });
              const t = doorsByType.get(JSON.stringify(doorType));
              if (t) t.quantity += 1;
              else doorsByType.set(JSON.stringify(doorType), { doorType, quantity: 1 });
            } else {
              throw new SummaryFailure(`${where}: slot role "${sel.slot.role}" is not supported`);
            }
          }
        }

        return {
          partitionId: p.id,
          wallLabel: p.label,
          glass,
          doors: [...doorGroups.values()], // first-appearance order == stored order
        };
      }),
    })),
  }));

  return {
    floors,
    kpis: {
      totalPartitionSqm: round4(totalArea),
      sqmByGlassType: [...areaByPair.values()]
        .map((g) => ({ glassType: g.glassType, thickness: g.thickness, areaM2: round4(g.area) }))
        .sort((a, b) => cmp(a.glassType, b.glassType) || cmp(a.thickness, b.thickness)),
      doorsByType: [...doorsByType.values()].sort((a, b) => cmp(a.doorType, b.doorType)),
    },
  };
}

export function buildSummary(input: SummaryInput): SummaryResult {
  try {
    return { status: "OK", summary: build(input), materialList: [] };
  } catch (e) {
    if (e instanceof SummaryFailure) {
      return { status: "FAILED", errorDetail: e.message, summary: emptySummary(), materialList: [] };
    }
    throw e;
  }
}
