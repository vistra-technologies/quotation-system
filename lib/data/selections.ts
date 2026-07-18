import { prisma } from "@/lib/prisma";
import type { SessionData } from "@/lib/session";

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
 * Throws on any tenancy violation.
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

  // Tenancy guard — verify componentType belongs to session's org.
  const componentType = await prisma.componentType.findFirst({
    where: { id: input.componentTypeId, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!componentType) throw new Error("Component type not found or access denied.");

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
