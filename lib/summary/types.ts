/**
 * Summary builder types (Stage 23 Batch 4). Plain data only — no Prisma types, no DB access.
 * Output shape: stage-23.md "Summary output shape" (D-27..D-33, D-40).
 */
import type { ConfigSnapshot } from "../config-snapshot";

/** One slot of a FormulaSet body: classifies a ComponentType code and names its summary fields (D-24). */
export interface FormulaSlot {
  role: string;
  requiredParams?: string[];
  /** role-param name (e.g. "glassType") -> the org's fieldsSchema key holding the value */
  summaryParams?: Record<string, string>;
}

export interface FormulaSetBody {
  slots: Record<string, FormulaSlot>;
  formulas?: unknown[];
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

export interface SummaryResult {
  status: "OK" | "FAILED";
  errorDetail?: string;
  summary: Summary;
  /** Always [] this stage (D-37) so callers need no branch. */
  materialList: [];
}
