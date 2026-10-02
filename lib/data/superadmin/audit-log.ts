/**
 * SuperAdmin audit-log reads (hotfix 2026-10-02). Read-only — the log is append-only and every write
 * goes through writeSuperAdminAudit() in ./audit.ts.
 *
 * superadmin-only — intentionally cross-org
 */

import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ITEM_BY_TARGET_TYPE,
  itemForTargetType,
  summarizeAction,
  targetTypesForItem,
  verbForAction,
  type AuditFilters,
  type AuditVerb,
} from "@/lib/superadmin-audit-view";

export interface AuditEntry {
  id: string;
  createdAt: string;
  /** Who did it. `deleted` ⇒ that SuperAdmin account no longer exists (name comes from the snapshot). */
  by: { username: string | null; deleted: boolean };
  verb: AuditVerb;
  item: string;
  /** The entity's display name (snapshot); null when unknown. */
  entity: string | null;
  summary: string;
  /** The raw stored action code, e.g. "user.update". */
  action: string;
  /** null ⇒ platform-level (SuperAdmin console). */
  org: { id: string; slug: string | null } | null;
  targetType: string;
  targetId: string;
  details: unknown;
}

export interface AuditFacets {
  orgs: { id: string; slug: string | null }[];
  admins: { username: string; deleted: boolean }[];
  items: string[];
}

export interface AuditPage {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  facets: AuditFacets;
}

const INSERT_OPS = [{ action: { endsWith: ".create" } }, { action: { endsWith: ".newVersion" } }];
const DELETE_OPS = [{ action: { endsWith: ".delete" } }];

/** Mirrors verbForAction() exactly, but in SQL: UPDATE is "everything that is not an insert or delete". */
function verbWhere(verb: AuditVerb): Prisma.SuperAdminAuditLogWhereInput {
  if (verb === "INSERT") return { OR: INSERT_OPS };
  if (verb === "DELETE") return { OR: DELETE_OPS };
  return { NOT: { OR: [...INSERT_OPS, ...DELETE_OPS] } };
}

export function buildAuditWhere(f: AuditFilters): Prisma.SuperAdminAuditLogWhereInput {
  const and: Prisma.SuperAdminAuditLogWhereInput[] = [];

  if (f.scope === "platform") and.push({ organizationId: null });
  if (f.scope === "org") and.push(f.orgId ? { organizationId: f.orgId } : { organizationId: { not: null } });
  if (f.by) and.push({ superAdminUsername: f.by });
  if (f.verb) and.push(verbWhere(f.verb));
  if (f.item) and.push({ targetType: { in: targetTypesForItem(f.item) } });
  if (f.from || f.to) {
    and.push({
      createdAt: {
        ...(f.from ? { gte: new Date(`${f.from}T00:00:00.000Z`) } : {}),
        // `to` is inclusive of the whole day.
        ...(f.to ? { lt: new Date(new Date(`${f.to}T00:00:00.000Z`).getTime() + 86_400_000) } : {}),
      },
    });
  }
  return and.length ? { AND: and } : {};
}

export async function listAuditLog(f: AuditFilters): Promise<AuditPage> {
  const where = buildAuditWhere(f);

  // superadmin-only — intentionally cross-org
  const [rows, total, orgRows, actorRows, liveAdmins] = await Promise.all([
    prisma.superAdminAuditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
    prisma.superAdminAuditLog.count({ where }),
    prisma.superAdminAuditLog.findMany({
      where: { organizationId: { not: null } },
      distinct: ["organizationId"],
      orderBy: [{ organizationId: "asc" }, { createdAt: "desc" }],
      select: { organizationId: true, organizationSlug: true },
    }),
    prisma.superAdminAuditLog.findMany({
      where: { superAdminUsername: { not: null } },
      distinct: ["superAdminUsername"],
      orderBy: { superAdminUsername: "asc" },
      select: { superAdminUsername: true },
    }),
    prisma.superAdmin.findMany({ select: { username: true } }),
  ]);

  const live = new Set(liveAdmins.map((a) => a.username));

  const entries: AuditEntry[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    by: { username: r.superAdminUsername, deleted: r.superAdminId === null },
    verb: verbForAction(r.action),
    item: itemForTargetType(r.targetType),
    entity: r.targetLabel,
    summary: summarizeAction(r.action, r.metadata as Record<string, unknown> | null),
    action: r.action,
    org: r.organizationId ? { id: r.organizationId, slug: r.organizationSlug } : null,
    targetType: r.targetType,
    targetId: r.targetId,
    details: r.metadata ?? null,
  }));

  return {
    entries,
    total,
    page: f.page,
    pageSize: f.pageSize,
    facets: {
      orgs: orgRows
        .filter((o): o is { organizationId: string; organizationSlug: string | null } => o.organizationId !== null)
        .map((o) => ({ id: o.organizationId, slug: o.organizationSlug }))
        .sort((a, b) => (a.slug ?? a.id).localeCompare(b.slug ?? b.id)),
      admins: actorRows
        .filter((a): a is { superAdminUsername: string } => a.superAdminUsername !== null)
        .map((a) => ({ username: a.superAdminUsername, deleted: !live.has(a.superAdminUsername) })),
      items: Object.values(ITEM_BY_TARGET_TYPE),
    },
  };
}
