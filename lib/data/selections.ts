import { prisma } from "@/lib/prisma";
import type { SessionData } from "@/lib/session";
import { getComponentTypeById } from "@/lib/data/components";
import { isComponentTypeFullyConfigured } from "@/lib/configurator-gating";

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
 * Throws on any tenancy violation or on the configuredness guard.
 */
export async function createSelection(
  session: SessionData,
  input: CreateSelectionInput,
) {
  // Tenancy guard — verify project belongs to session's org.
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!project) throw new Error("Project not found or access denied.");

  // Tenancy guard — verify componentType belongs to session's org. Reuses the DAL's
  // fieldsSchema + fieldOptionsConfig read (Batch 4 folded the org-config join into this
  // function) rather than a bare findFirst, so the configuredness guard below is free.
  const componentType = await getComponentTypeById(session, input.componentTypeId);
  if (!componentType) throw new Error("Component type not found or access denied.");
  if (!isComponentTypeFullyConfigured(componentType.fieldsSchema, componentType.fieldOptionsConfig)) {
    throw new Error("Component type is not fully configured — contact your admin.");
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
    select: { id: true },
  });
  if (!existing) return null;

  return prisma.selection.update({
    where: { id },
    data: {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.config !== undefined ? { config: input.config } : {}),
    },
  });
}
