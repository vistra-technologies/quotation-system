/**
 * Stage 23 Batch 5 — the shared "load inputs -> build summary -> write ProjectCalculation" path used by
 * both `submitDesign()` and `recomputeProject()` (lib/data/projects.ts). Also owns the 13b submit-time data
 * check (`checkDesignReadyForSubmit`), which runs BEFORE `buildSummary()` so a null/incomplete design never
 * reaches the builder from a normal submit and surfaces as an opaque FAILED (review-4 carry-forward (b)).
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
import type { FormulaSetBody, SummaryInput, SummaryResult } from "@/lib/summary/types";

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
}

/**
 * Load everything `buildSummary()` needs for one project, scoped to `organizationId` (tenancy guard —
 * returns null if the project doesn't exist or belongs to a different org). Works against either the plain
 * client or an open transaction client (structural `Db` type), matching lib/config-snapshot.ts's pattern.
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
  };
}

// ─── 13b — submit-time data check (runs BEFORE buildSummary) ────────────────

export interface DesignCheckViolation {
  partitionId: string;
  partitionLabel: string;
  cellId?: string;
  message: string;
}

/**
 * Every cell in every partition's design must have a non-null, non-blank `selectionId` that resolves to a
 * loaded Selection of this project. A partition with no design started (`design` null, or no `sections[]`)
 * is reported the same way — this is what stops a null design from ever reaching `buildSummary()` on a
 * normal submit (worklog review-4 carry-forward (b)). Returns `[]` when everything is ready. Pure — no
 * Prisma, takes the already-loaded `SummaryInput` shape.
 */
export function checkDesignReadyForSubmit(
  floors: SummaryInput["floors"],
  selectionIds: ReadonlySet<string>,
): DesignCheckViolation[] {
  const violations: DesignCheckViolation[] = [];

  for (const floor of floors) {
    for (const room of floor.rooms) {
      for (const partition of room.partitions) {
        const design = partition.design;
        const sections = isRecord(design) && Array.isArray(design.sections) ? design.sections : null;
        if (!sections || sections.length === 0) {
          violations.push({
            partitionId: partition.id,
            partitionLabel: partition.label,
            message: `partition "${partition.label}" (${partition.id}): design has not been started`,
          });
          continue;
        }
        for (const section of sections) {
          if (!isRecord(section) || !Array.isArray(section.cells)) {
            violations.push({
              partitionId: partition.id,
              partitionLabel: partition.label,
              message: `partition "${partition.label}" (${partition.id}): design is malformed`,
            });
            continue;
          }
          for (const cell of section.cells) {
            const cellId = isRecord(cell) && typeof cell.id === "string" ? cell.id : "?";
            const selectionId = isRecord(cell) ? cell.selectionId : undefined;
            if (typeof selectionId !== "string" || selectionId === "") {
              violations.push({
                partitionId: partition.id,
                partitionLabel: partition.label,
                cellId,
                message: `partition "${partition.label}" (${partition.id}), cell ${cellId}: no selection assigned`,
              });
            } else if (!selectionIds.has(selectionId)) {
              violations.push({
                partitionId: partition.id,
                partitionLabel: partition.label,
                cellId,
                message: `partition "${partition.label}" (${partition.id}), cell ${cellId}: selection ${selectionId} does not resolve within this project`,
              });
            }
          }
        }
      }
    }
  }

  return violations;
}

// ─── Writer ─────────────────────────────────────────────────────────────────

/**
 * Upsert the project's ProjectCalculation row on `projectId` (#7 — one row per project, rewritten
 * wholesale). `materialList` is always `[]` (D-37). Call inside the same transaction as any status/stamp
 * write that must be atomic with it (submitDesign's `designSubmittedAt` stamp; recompute has none).
 */
export async function writeCalculation(
  tx: Prisma.TransactionClient,
  organizationId: string,
  projectId: string,
  formulaSetId: string,
  result: SummaryResult,
): Promise<void> {
  const computedAt = new Date();
  const data = {
    organizationId,
    formulaSetId,
    computedAt,
    status: result.status,
    errorDetail: result.errorDetail ?? null,
    summary: result.summary as unknown as Prisma.InputJsonValue,
    materialList: result.materialList as unknown as Prisma.InputJsonValue,
  };
  await tx.projectCalculation.upsert({
    where: { projectId },
    create: { projectId, ...data },
    update: data,
  });
}
