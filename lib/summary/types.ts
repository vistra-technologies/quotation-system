/**
 * Summary builder types (Stage 23 Batch 4). Plain data only — no Prisma types, no DB access.
 * Output shape: stage-23.md "Summary output shape" (D-27..D-33, D-40).
 */
import type { ConfigSnapshot } from "../config-snapshot";

/** One slot of a FormulaSet body: classifies a ComponentType code and names its summary fields (D-24). */
export interface FormulaSlot {
  role: string;
  /**
   * fieldsSchema keys the formulas read as `param.*`. Object-array shape per formula-engine.md §2.
   * `keysReferencedBySet()` in `lib/formula-compat.ts` tolerates both plain strings and `{ key }` at
   * runtime (so Stage 23's seeded v1 document — which uses `[]` — still resolves cleanly); this type
   * reflects the canonical shape for new documents.
   */
  requiredParams?: Array<{ key: string }>;
  /** role-param name (e.g. "glassType") -> the org's fieldsSchema key holding the value */
  summaryParams?: Record<string, string>;
}

/** One formula in a v2 FormulaSet body (formula-engine.md §2). */
export interface FormulaDef {
  /** camelCase, unique within the set — must parse as `calc.<id>` member access. */
  id: string;
  /** ComponentType.code whose Selection config supplies `param.*`. */
  slot: string;
  grain: "CELL" | "PARTITION" | "ROOM_SIDE" | "ROOM_JUNCTION";
  /** expr-eval expression; absent = always fires. */
  condition?: string;
  /** `{param.x}` — plain string substitution, never expr-eval. */
  materialCode: string;
  /** "metres" | "pieces" — hard-matched against InventoryItem.measurementUnit. */
  unit: string;
  /** expr-eval expression. */
  quantity: string;
}

export interface FormulaSetBody {
  /** 1 = slots-only (Stage 23). 2 = slots + formulas. Absent means 1. */
  schemaVersion?: 1 | 2;
  slots: Record<string, FormulaSlot>;
  /** Flat array; absent or `[]` in v1 documents. ARRAY ORDER IS EVALUATION ORDER. */
  formulas?: FormulaDef[];
}

export interface SummaryInput {
  formulaSetBody: FormulaSetBody;
  snapshot: ConfigSnapshot;
  floors: Array<{
    id: string;
    label: string;
    rooms: Array<{
      id: string;
      label: string;
      partitions: Array<{
        id: string;
        label: string;
        widthMm: number;
        heightMm: number;
        /** Stored Partition.design JSON (v2: sections[].cells[]); validated structurally by the builder. */
        design: unknown;
      }>;
    }>;
  }>;
  selections: Array<{
    id: string;
    componentTypeId: string;
    label?: string;
    config: unknown;
  }>;
}

export interface GlassRow {
  glassType: string | null;
  thickness: string | null;
  widthMm: number;
  heightMm: number;
  areaM2: number;
}

export interface DoorRow {
  widthMm: number;
  heightMm: number;
  handing: "LH" | "RH";
  category: string | null;
  doorType: string | null;
  quantity: number;
}

export interface SummaryWall {
  partitionId: string;
  wallLabel: string;
  glass: GlassRow[];
  doors: DoorRow[];
}

export interface SummaryRoom {
  roomId: string;
  roomLabel: string;
  walls: SummaryWall[];
}

export interface SummaryFloor {
  floorId: string;
  floorLabel: string;
  rooms: SummaryRoom[];
}

export interface SummaryKpis {
  totalPartitionSqm: number;
  sqmByGlassType: Array<{ glassType: string | null; thickness: string | null; areaM2: number }>;
  doorsByType: Array<{ doorType: string | null; quantity: number }>;
}

export interface Summary {
  floors: SummaryFloor[];
  kpis: SummaryKpis;
}

/**
 * One resolved, code-deduped material line in the computed material list (formula-engine.md §8).
 * No `status` field and no `MaterialLineStatus` type — see §8 and decision 10.
 */
export interface MaterialListLine {
  /** Always a real, resolved InventoryItem code — never blank, never null. */
  code: string;
  /** Resolved InventoryItem.name, frozen at computedAt. */
  name: string;
  /**
   * ComponentType.code (slot) whose formula produced this line. `string[]` when two slots contribute
   * to the same code (merged, correctly-summed requirement).
   */
  slot: string | string[];
  unit: string;
  /** Project total; 3 dp for metres. */
  requirement: number;
  perUnitQuantity: number;
  /** ceil(requirement / perUnitQuantity). */
  quantity: number;
}

/** Per-room material breakdown stored in ProjectCalculation.materialByRoom (formula-engine.md §8). */
export interface MaterialByRoomEntry {
  roomId: string;
  roomLabel: string;
  lines: Array<{ code: string; unit: string; requirement: number }>;
}

export interface SummaryResult {
  status: "OK" | "FAILED";
  errorDetail?: string;
  summary: Summary;
  /** Empty in Stage 23 (D-37); populated by Stage 24's material-list engine. */
  materialList: MaterialListLine[];
}
