// superadmin-only — intentionally cross-org
// This file belongs to the SuperAdmin data-access layer (lib/data/superadmin/).
// Formula sets are platform-level (no organizationId) — authored and assigned by
// SuperAdmin only. All reads/writes here bypass org tenancy by design.
// See Stage 25 plan-b3.md and the Stage 16 architecture note in profile.md.

import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FormulaSetListItem {
  id: string;
  name: string;
  version: number;
  publishedAt: Date | null;
  createdAt: Date;
  locked: boolean;
  inUseBy: { orgCount: number; projectCount: number; calculationCount: number };
}

export interface FormulaSetDetail extends FormulaSetListItem {
  body: unknown; // raw JSON — route layer casts
  updatedAt: Date;
}

export interface FormulaSetInput {
  name: string;
  version: number;
  body: unknown;
}

/**
 * Input for creating a new FormulaSet. Version is intentionally absent —
 * `createFormulaSet` computes version automatically inside a $transaction:
 * new name → v1, existing name → MAX(version)+1.
 */
export interface CreateFormulaSetInput {
  name: string;
  body: unknown;
}

/**
 * Thrown when an update is attempted on a FormulaSet that is currently in use
 * (activeForOrgs > 0 || pinnedProjects > 0 || calculations > 0).
 * Route layer returns 409 with { error, inUseBy }.
 */
export class FormulaSetInUseError extends Error {
  inUseBy: { orgCount: number; projectCount: number; calculationCount: number };
  constructor(inUseBy: { orgCount: number; projectCount: number; calculationCount: number }) {
    super("Formula set is in use and cannot be edited");
    this.name = "FormulaSetInUseError";
    this.inUseBy = inUseBy;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeInUseBy(count: {
  activeForOrgs: number;
  pinnedProjects: number;
  calculations: number;
}): { orgCount: number; projectCount: number; calculationCount: number } {
  return {
    orgCount: count.activeForOrgs,
    projectCount: count.pinnedProjects,
    calculationCount: count.calculations,
  };
}

function computeLocked(inUseBy: {
  orgCount: number;
  projectCount: number;
  calculationCount: number;
}): boolean {
  return inUseBy.orgCount > 0 || inUseBy.projectCount > 0 || inUseBy.calculationCount > 0;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * List all FormulaSet rows, newest first (createdAt DESC).
 * Includes in-use relation counts so the caller can compute `locked` without
 * extra round-trips. `body` is intentionally omitted (potentially large;
 * detail view provides it).
 *
 * superadmin-only — intentionally cross-org
 */
export async function listFormulaSets(): Promise<FormulaSetListItem[]> {
  // superadmin-only — intentionally cross-org
  const rows = await prisma.formulaSet.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      version: true,
      publishedAt: true,
      createdAt: true,
      _count: {
        select: { activeForOrgs: true, pinnedProjects: true, calculations: true },
      },
    },
  });
  return rows.map((r) => {
    const inUseBy = computeInUseBy(r._count);
    return {
      id: r.id,
      name: r.name,
      version: r.version,
      publishedAt: r.publishedAt,
      createdAt: r.createdAt,
      inUseBy,
      locked: computeLocked(inUseBy),
    };
  });
}

/**
 * Get a single FormulaSet by ID, including body and in-use counts.
 * Returns null if not found.
 *
 * superadmin-only — intentionally cross-org
 */
export async function getFormulaSet(setId: string): Promise<FormulaSetDetail | null> {
  // superadmin-only — intentionally cross-org
  const row = await prisma.formulaSet.findUnique({
    where: { id: setId },
    select: {
      id: true,
      name: true,
      version: true,
      body: true,
      publishedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: { activeForOrgs: true, pinnedProjects: true, calculations: true },
      },
    },
  });
  if (!row) return null;
  const inUseBy = computeInUseBy(row._count);
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    body: row.body,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    inUseBy,
    locked: computeLocked(inUseBy),
  };
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a new FormulaSet row with auto-computed version.
 *
 * Version logic (inside a $transaction to avoid a race on the unique constraint):
 *   - If no row exists with this name → version = 1.
 *   - If rows exist with this name → version = MAX(version for name) + 1.
 *
 * Caller validates the body before calling. P2002 (@@unique([name, version]))
 * is theoretically possible under a race but is extremely unlikely on a
 * low-traffic solo-admin console; it propagates to the route layer as 409.
 *
 * superadmin-only — intentionally cross-org
 */
export async function createFormulaSet(input: CreateFormulaSetInput): Promise<FormulaSetDetail> {
  // superadmin-only — intentionally cross-org
  const row = await prisma.$transaction(async (tx) => {
    const agg = await tx.formulaSet.aggregate({
      where: { name: input.name },
      _max: { version: true },
    });
    const version = (agg._max.version ?? 0) + 1;
    return tx.formulaSet.create({
      data: {
        name: input.name,
        version,
        body: input.body as Prisma.InputJsonValue,
      },
    });
  });
  // Re-fetch with counts (new row always has 0 counts — consistent with detail shape).
  const detail = await getFormulaSet(row.id);
  if (!detail) throw new Error("FormulaSet disappeared immediately after create");
  return detail;
}

/**
 * Update a FormulaSet that is not in use.
 *
 * Runs the in-use check and the update inside a single $transaction so the
 * check and write are serialised — no race between check and write.
 *
 * 1. Re-reads the counts inside the transaction.
 * 2. Throws FormulaSetInUseError (rolls back) if any count > 0.
 * 3. Applies the update.
 * Returns the updated detail re-fetched outside the transaction (with fresh counts).
 *
 * Throws Error("NOT_FOUND") if the set does not exist.
 *
 * superadmin-only — intentionally cross-org
 */
export async function updateFormulaSet(
  setId: string,
  patch: Partial<FormulaSetInput>,
): Promise<FormulaSetDetail> {
  // superadmin-only — intentionally cross-org
  await prisma.$transaction(async (tx) => {
    const existing = await tx.formulaSet.findUnique({
      where: { id: setId },
      select: {
        id: true,
        _count: {
          select: { activeForOrgs: true, pinnedProjects: true, calculations: true },
        },
      },
    });
    if (!existing) throw new Error("NOT_FOUND");

    const inUseBy = computeInUseBy(existing._count);
    if (computeLocked(inUseBy)) {
      throw new FormulaSetInUseError(inUseBy);
    }

    await tx.formulaSet.update({
      where: { id: setId },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.version !== undefined ? { version: patch.version } : {}),
        ...(patch.body !== undefined ? { body: patch.body as Prisma.InputJsonValue } : {}),
      },
    });
  });
  // Re-fetch with counts outside the transaction (reflects committed state).
  const detail = await getFormulaSet(setId);
  if (!detail) throw new Error("NOT_FOUND");
  return detail;
}

/**
 * Create a new version of an existing FormulaSet.
 * Copies the source set's body to a new row with version = max(version for name) + 1.
 * `nameOverride` lets the caller fork under a different name family.
 *
 * Throws Error("NOT_FOUND") if the source set does not exist.
 * P2002 propagates if the computed (name, version) already exists (guarded at route layer).
 *
 * superadmin-only — intentionally cross-org
 */
export async function newVersionOfFormulaSet(
  setId: string,
  nameOverride?: string,
): Promise<FormulaSetDetail> {
  // superadmin-only — intentionally cross-org
  const source = await prisma.formulaSet.findUnique({
    where: { id: setId },
    select: { name: true, body: true },
  });
  if (!source) throw new Error("NOT_FOUND");

  const name = nameOverride ?? source.name;

  const agg = await prisma.formulaSet.aggregate({
    where: { name },
    _max: { version: true },
  });
  const maxV = agg._max.version ?? 0;

  const row = await prisma.formulaSet.create({
    data: {
      name,
      version: maxV + 1,
      body: source.body as Prisma.InputJsonValue,
    },
  });

  const detail = await getFormulaSet(row.id);
  if (!detail) throw new Error("FormulaSet disappeared immediately after create");
  return detail;
}

/**
 * Hard-delete a FormulaSet that is not in use (hotfix 2026-09-25, H-1).
 *
 * Same in-use rule as updateFormulaSet (S25-2): the counts are re-read and the
 * delete runs in one $transaction, so a set that becomes referenced between
 * page load and click is refused. The Restrict FKs on Organization / Project /
 * ProjectCalculation backstop this at the DB level.
 *
 * Throws Error("NOT_FOUND") if the set does not exist, FormulaSetInUseError if in use.
 * Returns the deleted row's name + version (for the audit log).
 *
 * superadmin-only — intentionally cross-org
 */
export async function deleteFormulaSet(
  setId: string,
): Promise<{ name: string; version: number }> {
  // superadmin-only — intentionally cross-org
  return prisma.$transaction(async (tx) => {
    const existing = await tx.formulaSet.findUnique({
      where: { id: setId },
      select: {
        name: true,
        version: true,
        _count: {
          select: { activeForOrgs: true, pinnedProjects: true, calculations: true },
        },
      },
    });
    if (!existing) throw new Error("NOT_FOUND");

    const inUseBy = computeInUseBy(existing._count);
    if (computeLocked(inUseBy)) {
      throw new FormulaSetInUseError(inUseBy);
    }

    await tx.formulaSet.delete({ where: { id: setId } });
    return { name: existing.name, version: existing.version };
  });
}

// ─── Audit log ────────────────────────────────────────────────────────────────

/**
 * Write a SuperAdminAuditLog row for a FormulaSet mutation (append-only).
 *
 * Must be called after a successful mutation, not inside the mutation transaction
 * (so the audit log row is only written if the mutation committed).
 *
 * Intentionally NOT wrapped in try/catch here — an audit log write failure must
 * propagate as an error rather than being silently swallowed (Stage 16/17
 * discipline: every SuperAdmin mutation must have an audit row).
 *
 * superadmin-only — intentionally cross-org
 */
export async function createFormulaSetAuditLog(
  superAdminId: string,
  setId: string,
  action: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  // superadmin-only — intentionally cross-org
  await prisma.superAdminAuditLog.create({
    data: {
      superAdminId,
      action,
      targetType: "FormulaSet",
      targetId: setId,
      ...(metadata !== undefined
        ? { metadata: metadata as Prisma.InputJsonValue }
        : {}),
    },
  });
}
