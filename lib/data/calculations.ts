/**
 * Stage 23 Batch 5 — the shared "load inputs -> build summary -> write ProjectCalculation" path used by
 * both `submitDesign()` and `recomputeProject()` (lib/data/projects.ts). Also owns the 13b submit-time data
 * check (`checkDesignReadyForSubmit`), which runs BEFORE `buildSummary()` so a null/incomplete design never
 * reaches the builder from a normal submit and surfaces as an opaque FAILED (review-4 carry-forward (b)).
 *
 * Stage 24 Batch 5: adds `runPhaseA()` — the new ProblemCollector-based structural check that replaces
 * `checkDesignReadyForSubmit` in the submit/recompute pipeline. `checkDesignReadyForSubmit` and its
 * `DesignCheckViolation` type were removed in the Batch 5 fix round (MINOR-2 — no callers). Also extends `writeCalculation()` to accept `materialList` and
 * `materialByRoom` explicitly (D-E — fixes the Batch 1 review-2 MINOR #4 materialByRoom stale-on-upsert).
 * Adds `roomTopology` to `CalculationLoad` and extends the room query to select `isClosed`/`sides`.
 *
 * Wall ordering: derived directly from `Partition` rows ordered by `partitionNumber` (the existing
 * convention — lib/data/partitions.ts's listPartitionsByRoom()), NOT from `Room.sides`. `Partition` has no
 * `orderIndex` of its own, and deriving order from `Room.sides` instead would need its own
 * cache-invalidation hook for a sides-reorder-only PATCH that doesn't exist today (worklog carry-forward
 * (e)) — ordering straight off the Partition rows sidesteps that gap structurally.
 */
import type { Prisma } from "@/app/generated/prisma/client";
import type { ConfigSnapshot } from "@/lib/config-snapshot";
import { prisma } from "@/lib/prisma";
import type { FormulaSetBody, MaterialByRoomEntry, MaterialListLine, Summary, SummaryInput, SummaryResult } from "@/lib/summary/types";
import { ProblemCollector } from "@/lib/materials/problems";
import type { SessionData } from "@/lib/session";

type Db = Prisma.TransactionClient | typeof prisma;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ─── Loader ─────────────────────────────────────────────────────────────────

export interface CalculationLoad {
  project: {
    id: string;
    organizationId: string;
    status: string;
    designSubmittedAt: Date | null;
    /** Null only for pre-Stage-23 data that somehow escaped the creation-time pin — defensive. */
    formulaSetId: string | null;
  };
  input: SummaryInput;
  /**
   * Room topology data (isClosed, sides) keyed by roomId — not included in SummaryInput
   * (which doesn't carry topology) but needed by buildMaterials(). Populated from the
   * same DB query that loads floors/rooms.
   */
  roomTopology: Map<string, { label: string; isClosed: boolean; sides: unknown }>;
}

/**
 * Load everything `buildSummary()` needs for one project, scoped to `organizationId` (tenancy guard —
 * returns null if the project doesn't exist or belongs to a different org). Works against either the plain
 * client or an open transaction client (structural `Db` type), matching lib/config-snapshot.ts's pattern.
 *
 * Stage 24 Batch 5: room select extended to include `isClosed` and `sides`; these are surfaced in
 * `CalculationLoad.roomTopology` for use by `buildMaterialsInput()` in projects.ts.
 */
export async function loadCalculationInput(
  db: Db,
  organizationId: string,
  projectId: string,
): Promise<CalculationLoad | null> {
  const project = await db.project.findFirst({
    where: { id: projectId, organizationId },
    select: {
      id: true,
      organizationId: true,
      status: true,
      designSubmittedAt: true,
      formulaSetId: true,
      configSnapshot: true,
      formulaSet: { select: { body: true } },
    },
  });
  if (!project) return null;

  const floors = await db.floor.findMany({
    where: { projectId, organizationId },
    orderBy: { orderIndex: "asc" },
    select: {
      id: true,
      label: true,
      rooms: {
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          label: true,
          isClosed: true,
          sides: true,
          partitions: {
            orderBy: { partitionNumber: "asc" }, // see file header — NOT Room.sides
            select: { id: true, label: true, widthMm: true, heightMm: true, design: true },
          },
        },
      },
    },
  });

  const selections = await db.selection.findMany({
    where: { projectId, organizationId },
    select: { id: true, componentTypeId: true, label: true, config: true },
  });

  const formulaSetBody: FormulaSetBody = isRecord(project.formulaSet?.body)
    ? (project.formulaSet!.body as unknown as FormulaSetBody)
    : { slots: {} };
  const snapshot: ConfigSnapshot = isRecord(project.configSnapshot)
    ? (project.configSnapshot as unknown as ConfigSnapshot)
    : { takenAt: "", componentTypes: [] };

  // Build roomTopology: Map<roomId, { label, isClosed, sides }>
  const roomTopology = new Map<string, { label: string; isClosed: boolean; sides: unknown }>();
  for (const f of floors) {
    for (const r of f.rooms) {
      roomTopology.set(r.id, { label: r.label, isClosed: r.isClosed, sides: r.sides });
    }
  }

  return {
    project: {
      id: project.id,
      organizationId: project.organizationId,
      status: project.status,
      designSubmittedAt: project.designSubmittedAt,
      formulaSetId: project.formulaSetId,
    },
    input: {
      formulaSetBody,
      snapshot,
      floors: floors.map((f) => ({
        id: f.id,
        label: f.label,
        rooms: f.rooms.map((r) => ({
          id: r.id,
          label: r.label,
          partitions: r.partitions.map((p) => ({
            id: p.id,
            label: p.label,
            widthMm: p.widthMm,
            heightMm: p.heightMm,
            design: p.design,
          })),
        })),
      })),
      selections: selections.map((s) => ({
        id: s.id,
        componentTypeId: s.componentTypeId,
        label: s.label,
        config: s.config,
      })),
    },
    roomTopology,
  };
}

// ─── Phase A — structural check (Stage 24 Batch 5) ──────────────────────────

/**
 * Phase A structural check: walks every cell in every partition's design and emits CalculationProblems
 * into `collector` for cells that lack a selection, have a selection not present in the project, or have
 * a selection whose componentType is absent from the config snapshot.
 *
 * Replaces `checkDesignReadyForSubmit` in the submit/recompute pipeline. Pure — no Prisma, takes the
 * already-loaded input shapes.
 *
 * All three problem kinds carry `(partitionId, sectionIndex, cellIndex)` in the locus so the
 * scope-aware DESIGN dedupe key makes each unique per cell location.
 */
export function runPhaseA(
  floors: SummaryInput["floors"],
  selections: SummaryInput["selections"],
  snapshot: ConfigSnapshot,
  collector: ProblemCollector,
): void {
  const selectionMap = new Map(selections.map((s) => [s.id, s]));
  const componentTypeIdSet = new Set((snapshot.componentTypes ?? []).map((t) => t.id));

  for (const floor of floors) {
    for (const room of floor.rooms) {
      for (const partition of room.partitions) {
        const design = partition.design;
        const sections =
          isRecord(design) && Array.isArray(design.sections) ? design.sections : null;

        if (!sections || sections.length === 0) {
          // Partition with no design started — emit a single CELL_UNASSIGNED for the partition
          // so the Phase-A gate fires. sectionIndex=0 / cellIndex=0 makes the DESIGN-scope dedupe
          // key (partitionId|0|0) unique per partition.
          collector.add({
            kind: "CELL_UNASSIGNED",
            scope: "DESIGN",
            message: `Partition "${partition.label}" (${partition.id}): design has not been started`,
            locus: {
              partitionId: partition.id,
              partitionLabel: partition.label,
              sectionIndex: 0,
              cellIndex: 0,
            },
          });
          continue;
        }

        for (let sI = 0; sI < sections.length; sI++) {
          const section = sections[sI];
          if (!isRecord(section) || !Array.isArray(section.cells)) {
            collector.add({
              kind: "CELL_UNASSIGNED",
              scope: "DESIGN",
              message: `Partition "${partition.label}" (${partition.id}): design section ${sI} is malformed`,
              locus: {
                partitionId: partition.id,
                partitionLabel: partition.label,
                sectionIndex: sI,
                cellIndex: 0,
              },
            });
            continue;
          }

          for (let cI = 0; cI < (section.cells as unknown[]).length; cI++) {
            const cell = (section.cells as unknown[])[cI];
            const selectionId = isRecord(cell) ? cell.selectionId : undefined;

            if (typeof selectionId !== "string" || selectionId === "") {
              collector.add({
                kind: "CELL_UNASSIGNED",
                scope: "DESIGN",
                message: `Partition "${partition.label}" (${partition.id}), section ${sI}, cell ${cI}: no selection assigned`,
                locus: {
                  partitionId: partition.id,
                  partitionLabel: partition.label,
                  sectionIndex: sI,
                  cellIndex: cI,
                },
              });
            } else if (!selectionMap.has(selectionId)) {
              collector.add({
                kind: "SELECTION_MISSING",
                scope: "DESIGN",
                message: `Partition "${partition.label}" (${partition.id}), section ${sI}, cell ${cI}: selection "${selectionId}" does not exist in this project`,
                locus: {
                  partitionId: partition.id,
                  partitionLabel: partition.label,
                  sectionIndex: sI,
                  cellIndex: cI,
                  selectionId,
                },
              });
            } else {
              const sel = selectionMap.get(selectionId)!;
              if (!componentTypeIdSet.has(sel.componentTypeId)) {
                collector.add({
                  kind: "SELECTION_TYPE_UNKNOWN",
                  scope: "DESIGN",
                  message: `Partition "${partition.label}" (${partition.id}), section ${sI}, cell ${cI}: selection "${selectionId}" has componentTypeId "${sel.componentTypeId}" not found in config snapshot`,
                  locus: {
                    partitionId: partition.id,
                    partitionLabel: partition.label,
                    sectionIndex: sI,
                    cellIndex: cI,
                    selectionId,
                    componentTypeCode: sel.componentTypeId,
                  },
                });
              }
            }
          }
        }
      }
    }
  }
}

// ─── Writer ─────────────────────────────────────────────────────────────────

/**
 * Upsert the project's ProjectCalculation row on `projectId` (#7 — one row per project, rewritten
 * wholesale). `materialList` and `materialByRoom` are passed explicitly (D-E — Stage 24 Batch 5 fix
 * for the Batch 1 review-2 MINOR #4 stale-on-upsert carry-forward: both fields go into the shared
 * `data` object so both branches of the upsert write the same values). Call inside the same transaction
 * as any status/stamp write that must be atomic with it (submitDesign's `designSubmittedAt` stamp;
 * recompute has none).
 */
export async function writeCalculation(
  tx: Prisma.TransactionClient,
  organizationId: string,
  projectId: string,
  formulaSetId: string,
  result: SummaryResult,
  materialList: MaterialListLine[],
  materialByRoom: MaterialByRoomEntry[],
): Promise<void> {
  const computedAt = new Date();
  const data = {
    organizationId,
    formulaSetId,
    computedAt,
    status: result.status,
    errorDetail: result.errorDetail ?? null,
    summary: result.summary as unknown as Prisma.InputJsonValue,
    materialList: materialList as unknown as Prisma.InputJsonValue,
    materialByRoom: materialByRoom as unknown as Prisma.InputJsonValue,
  };
  await tx.projectCalculation.upsert({
    where: { projectId },
    create: { projectId, ...data },
    update: data,
  });
}

// ─── Reader (Stage 26 Batch 1) ────────────────────────────────────────────────

export interface ProjectCalculationForRead {
  computedAt: Date;
  status: string;
  errorDetail: string | null;
  summary: Summary;
  materialList: MaterialListLine[];
  formulaSet: { name: string; version: number };
}

/**
 * Read-only fetch of a project's stored ProjectCalculation, for the Summary page GET route (Stage 26
 * Batch 1). This is the only place outside the write path (loadCalculationInput/writeCalculation) that
 * reads ProjectCalculation. `materialByRoom` is never selected — omitted both by lib/prisma.ts's global
 * client-level omit and this function's own explicit `select`, per stage-26.md's read-payload contract.
 *
 * Returns:
 *   - `null` if the project doesn't exist or belongs to a different org (tenancy, same as getProjectById).
 *   - `{ noCalculation: true }` if the project exists but has no ProjectCalculation row yet.
 *   - the row otherwise.
 */
export async function getProjectCalculationForRead(
  session: SessionData,
  projectId: string,
): Promise<ProjectCalculationForRead | { noCalculation: true } | null> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!project) return null;

  const calc = await prisma.projectCalculation.findUnique({
    where: { projectId },
    select: {
      computedAt: true,
      status: true,
      errorDetail: true,
      summary: true,
      materialList: true,
      formulaSet: { select: { name: true, version: true } },
    },
  });
  if (!calc) return { noCalculation: true };

  return {
    computedAt: calc.computedAt,
    status: calc.status,
    errorDetail: calc.errorDetail,
    summary: calc.summary as unknown as Summary,
    materialList: calc.materialList as unknown as MaterialListLine[],
    formulaSet: calc.formulaSet,
  };
}
