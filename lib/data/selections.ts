import { prisma } from "@/lib/prisma";
import { invalidateProjectCalculation } from "@/lib/data/formula-pin";
import type { SessionData } from "@/lib/session";
import { getComponentTypeById } from "@/lib/data/components";
import { isComponentTypeFullyConfigured } from "@/lib/configurator-gating";
import { parseFieldsSchema, parseFieldOptionsConfig } from "@/lib/parse-field-config";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreateSelectionInput {
  projectId: string;
  componentTypeId: string;
  label: string;
  // config values are primitives from the dynamic form: text, radio, dropdown → string;
  // checkbox → boolean. Number is included for forward-compatibility.
  config: Record<string, string | boolean | number | null>;
  orderIndex: number;
}

export interface UpdateSelectionInput {
  // componentTypeId is intentionally absent — locked after creation.
  label?: string;
  config?: Record<string, string | boolean | number | null>;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * List all Selections for a project, ordered by orderIndex.
 *
 * Tenancy guard: first verifies the project belongs to the session's org
 * before returning any rows — not just filtering selections by organizationId.
 * Returns an empty array if the project is not found in the session's org
 * (rather than leaking that the project exists in another org).
 */
export async function listSelections(session: SessionData, projectId: string) {
  // Tenancy guard — verify the project belongs to the session's org.
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!project) return [];

  return prisma.selection.findMany({
    where: { projectId, organizationId: session.organizationId },
    orderBy: { orderIndex: "asc" },
    include: {
      componentType: { select: { id: true, name: true, code: true } },
    },
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

interface SnapshotTypeLite {
  id: string;
  active: boolean;
  fieldsSchema: unknown;
  fieldOptionsConfig: unknown;
}

/** Defensively read `Project.configSnapshot.componentTypes`; null when absent/malformed (-> live fallback). */
function readSnapshotTypes(raw: unknown): SnapshotTypeLite[] | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const types = (raw as { componentTypes?: unknown }).componentTypes;
  if (!Array.isArray(types)) return null;
  const out: SnapshotTypeLite[] = [];
  for (const t of types) {
    if (typeof t !== "object" || t === null) continue;
    const o = t as Record<string, unknown>;
    if (typeof o.id !== "string") continue;
    out.push({
      id: o.id,
      active: o.active === true,
      fieldsSchema: o.fieldsSchema,
      fieldOptionsConfig: o.fieldOptionsConfig,
    });
  }
  return out;
}

/**
 * Create a new Selection scoped to the session org.
 *
 * Tenancy guards:
 *  - Cross-tenant projectId: verifies the project belongs to the session's org.
 *  - Cross-tenant componentTypeId: verifies the type belongs to the session's org.
 *
 * Configuredness guard (Stage 20 Batch 4, decision #5): a Selection cannot be created against a
 * ComponentType that isn't fully configured (every dropdown/radio field — root or dependent —
 * has its values filled in). The "Add Component" palette already greys out an unconfigured type
 * client-side, but this is the server-side backstop for a client that bypasses that UI gate.
 *
 * Stage 22 decision #11: the configuredness/active guard validates against the project's frozen
 * `configSnapshot` (same source as the Configuration page palette), falling back to live rows only
 * when the project has no snapshot. A type absent from the snapshot is rejected.
 *
 * Throws on any tenancy violation or on the configuredness guard.
 */
export async function createSelection(
  session: SessionData,
  input: CreateSelectionInput,
) {
  // Tenancy guard — verify project belongs to session's org. Also reads the project's frozen
  // configSnapshot (Stage 22 decision #11): the configuredness/active guard below validates against
  // it, not live ComponentType rows, so it agrees with what the Configuration page offered.
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, organizationId: session.organizationId },
    select: { id: true, configSnapshot: true },
  });
  if (!project) throw new Error("Project not found or access denied.");

  const snapshotTypes = readSnapshotTypes(project.configSnapshot);
  if (snapshotTypes) {
    // Snapshot path. The snapshot only holds this org's types, but still confirm the live row
    // exists in the session's org (keeps the tenancy check, avoids an FK 500 if since deleted).
    const snapType = snapshotTypes.find((t) => t.id === input.componentTypeId);
    if (!snapType) throw new Error("Component type not found or access denied.");
    const live = await prisma.componentType.findFirst({
      where: { id: input.componentTypeId, organizationId: session.organizationId },
      select: { id: true },
    });
    if (!live) throw new Error("Component type not found or access denied.");
    if (
      !snapType.active ||
      !isComponentTypeFullyConfigured(
        parseFieldsSchema(snapType.fieldsSchema),
        parseFieldOptionsConfig(snapType.fieldOptionsConfig),
      )
    ) {
      throw new Error("Component type is not fully configured — contact your admin.");
    }
  } else {
    // null-guard: no snapshot (should not occur post-backfill) — validate against live config.
    // Tenancy guard — verify componentType belongs to session's org. Reuses the DAL's
    // fieldsSchema + fieldOptionsConfig read rather than a bare findFirst.
    const componentType = await getComponentTypeById(session, input.componentTypeId);
    if (!componentType) throw new Error("Component type not found or access denied.");
    if (!isComponentTypeFullyConfigured(componentType.fieldsSchema, componentType.fieldOptionsConfig)) {
      throw new Error("Component type is not fully configured — contact your admin.");
    }
  }

  return prisma.selection.create({
    data: {
      organizationId: session.organizationId,
      projectId: input.projectId,
      componentTypeId: input.componentTypeId,
      label: input.label,
      config: input.config,
      orderIndex: input.orderIndex,
    },
  });
}

/**
 * Update an existing Selection's label and/or config.
 *
 * componentTypeId is NOT patchable — locked after creation per spec.
 *
 * Tenancy guard: verifies the selection belongs to the session's org before
 * updating. Returns null if not found (caller translates to 404).
 */
export async function updateSelection(
  session: SessionData,
  id: string,
  input: UpdateSelectionInput,
) {
  // Tenancy guard — verify the selection belongs to the session's org.
  const existing = await prisma.selection.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true, projectId: true },
  });
  if (!existing) return null;

  const data = {
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.config !== undefined ? { config: input.config } : {}),
  };

  // Stage 23 D-19: a config change can change the summary's own grouping (glassType/thickness/category/
  // doorType), so it invalidates the project's calculation in the same tx. Label-only patches do not.
  if (input.config !== undefined) {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.selection.update({ where: { id }, data });
      await invalidateProjectCalculation(tx, existing.projectId);
      return updated;
    });
  }

  return prisma.selection.update({ where: { id }, data });
}

/** Shape of the fields inside Partition.design that can reference a Selection —
 * duplicated (not imported) from lib/data/partitions.ts's PartitionDesign to
 * avoid a cross-module type dependency for a single read-only scan. */
interface DesignRefsShape {
  // v2 (Stage 22): sections[].cells[].selectionId. `panels` is the legacy v1 shape, still scanned
  // until Batch 2's migration has converted every stored row.
  sections?: { cells?: { selectionId?: string | null }[] }[];
  panels?: { selectionId?: string | null; door?: { selectionId?: string | null } | null }[];
  stops?: Record<string, string | null | undefined>;
}

/**
 * Delete a Selection, refusing if it's still referenced by any Partition's
 * design (a panel's glass, a panel's door, or an edge profile stop) anywhere
 * in the project — deleting out from under an in-use component would leave
 * the Design page pointing at a component that no longer exists.
 *
 * Tenancy guard: verifies the selection belongs to the session's org before
 * deleting. Returns null if not found (caller translates to 404).
 * Returns { inUseCount: number } if the selection is still referenced
 * (caller translates to 409) instead of deleting.
 */
export async function deleteSelection(session: SessionData, id: string) {
  const existing = await prisma.selection.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true, projectId: true },
  });
  if (!existing) return null;

  // Scan every Partition in this project's design JSON for a reference to
  // this selectionId. Small N per project — a JS scan is simpler and just as
  // correct as a JSON-path query for a shape with several differently-keyed
  // reference sites (sections[].cells[].selectionId, legacy panels[].selectionId/door.selectionId,
  // stops.{top,bottom,left,right}).
  const partitions = await prisma.partition.findMany({
    where: {
      organizationId: session.organizationId,
      room: { floor: { projectId: existing.projectId } },
    },
    select: { design: true },
  });

  let inUseCount = 0;
  for (const p of partitions) {
    const design = p.design as DesignRefsShape | null;
    if (!design) continue;
    const panelHits = (design.panels ?? []).filter(
      (panel) => panel.selectionId === id || panel.door?.selectionId === id,
    ).length;
    const stopHits = Object.values(design.stops ?? {}).filter((v) => v === id).length;
    const cellHits = (design.sections ?? []).reduce(
      (n, sec) => n + (sec.cells ?? []).filter((c) => c.selectionId === id).length,
      0,
    );
    inUseCount += panelHits + cellHits + stopHits;
  }
  if (inUseCount > 0) return { inUseCount };

  await prisma.selection.delete({ where: { id } });
  return { deleted: true as const };
}
