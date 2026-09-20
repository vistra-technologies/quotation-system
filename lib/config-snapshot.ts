/**
 * Project.configSnapshot builder (Stage 22 Batch 4) — shared by project creation (createProject,
 * convertInquiryToProject) and prisma/backfill-config-snapshots.ts.
 *
 * The snapshot freezes the org's ComponentType configuration at project creation:
 *   { takenAt, componentTypes: [{ id, code, name, active, fieldsSchema, fieldOptionsConfig }] }
 * Every ComponentType of the org is included (active AND inactive — a Selection may reference an inactive
 * type), ordered `sortOrder, code` so array order == palette order. `fieldOptionsConfig` is `{}` when the
 * type has no ComponentTypeOrgConfig row. No other FKs (e.g. category) live inside the JSON.
 *
 * No prisma import: the db handle is structural, so this works with a transaction client (creation) or the
 * plain client (backfill). Callers pass an interactive-transaction client so reads + write are atomic.
 */
import type { Prisma } from "../app/generated/prisma/client";

export interface ConfigSnapshotType {
  id: string;
  code: string;
  name: string;
  active: boolean;
  fieldsSchema: Prisma.JsonValue;
  fieldOptionsConfig: Prisma.JsonValue;
}

export interface ConfigSnapshot {
  takenAt: string; // ISO timestamp
  componentTypes: ConfigSnapshotType[];
}

/** The slice of a Prisma client/tx client this module needs. */
export interface SnapshotDb {
  componentType: {
    findMany(args: {
      where: { organizationId: string };
      select: {
        id: true;
        code: true;
        name: true;
        active: true;
        fieldsSchema: true;
        orgConfig: { select: { fieldOptionsConfig: true } };
      };
      orderBy: ({ sortOrder: "asc" } | { code: "asc" })[];
    }): Promise<
      Array<{
        id: string;
        code: string;
        name: string;
        active: boolean;
        fieldsSchema: Prisma.JsonValue;
        orgConfig: { fieldOptionsConfig: Prisma.JsonValue } | null;
      }>
    >;
  };
}

/** Pure: shape loaded rows into the locked snapshot. Order of `rows` is preserved. */
export function buildConfigSnapshot(
  rows: Array<{
    id: string;
    code: string;
    name: string;
    active: boolean;
    fieldsSchema: Prisma.JsonValue;
    orgConfig: { fieldOptionsConfig: Prisma.JsonValue } | null;
  }>,
  takenAt: Date = new Date(),
): ConfigSnapshot {
  return {
    takenAt: takenAt.toISOString(),
    componentTypes: rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      active: r.active,
      fieldsSchema: r.fieldsSchema,
      fieldOptionsConfig: r.orgConfig?.fieldOptionsConfig ?? {},
    })),
  };
}

/** Load the org's current ComponentTypes (+ org config) and build the snapshot. Tenancy: one org only. */
export async function loadConfigSnapshot(
  db: SnapshotDb,
  organizationId: string,
): Promise<ConfigSnapshot> {
  const rows = await db.componentType.findMany({
    where: { organizationId },
    select: {
      id: true,
      code: true,
      name: true,
      active: true,
      fieldsSchema: true,
      orgConfig: { select: { fieldOptionsConfig: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
  return buildConfigSnapshot(rows);
}
