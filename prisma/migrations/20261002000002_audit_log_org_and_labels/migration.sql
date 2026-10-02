-- Hotfix 2026-10-02 (audit-log page): record WHERE a SuperAdmin change happened and WHAT it was about.
--
-- Adds three nullable text columns (no FKs: the org/target may be deleted and the row must outlive it),
-- backfills them for existing rows, and indexes the list queries. Additive — no data is changed or lost.
--   organizationId   — the org the change happened in; NULL => platform-level (SuperAdmin console)
--   organizationSlug — that org's slug, snapshotted
--   targetLabel      — the entity's display name, snapshotted

ALTER TABLE "SuperAdminAuditLog"
  ADD COLUMN "organizationId"   TEXT,
  ADD COLUMN "organizationSlug" TEXT,
  ADD COLUMN "targetLabel"      TEXT;

-- ── Backfill: organizationId ─────────────────────────────────────────────────────────────────────
-- Organization targets: the org IS the target. Everything else: org context lives in metadata under
-- either "organizationId" (user.*) or "orgId" (componentType.*, role.*, permission.*).
UPDATE "SuperAdminAuditLog"
SET "organizationId" = CASE
  WHEN "targetType" = 'Organization' THEN "targetId"
  ELSE NULLIF(COALESCE("metadata"->>'organizationId', "metadata"->>'orgId'), '')
END;

-- ── Backfill: organizationSlug (live org first, then the slug saved in metadata at delete time) ──
UPDATE "SuperAdminAuditLog" AS l
SET "organizationSlug" = o."slug"
FROM "Organization" AS o
WHERE l."organizationId" = o."id";

UPDATE "SuperAdminAuditLog"
SET "organizationSlug" = "metadata"->>'slug'
WHERE "organizationSlug" IS NULL AND "organizationId" IS NOT NULL AND "targetType" = 'Organization';

-- ── Backfill: targetLabel — live row first ───────────────────────────────────────────────────────
UPDATE "SuperAdminAuditLog" AS l SET "targetLabel" = o."slug"      FROM "Organization"  AS o WHERE l."targetType" = 'Organization'  AND l."targetId" = o."id";
UPDATE "SuperAdminAuditLog" AS l SET "targetLabel" = u."username"  FROM "user"          AS u WHERE l."targetType" = 'User'          AND l."targetId" = u."id";
UPDATE "SuperAdminAuditLog" AS l SET "targetLabel" = r."name"      FROM "Role"          AS r WHERE l."targetType" = 'Role'          AND l."targetId" = r."id";
UPDATE "SuperAdminAuditLog" AS l SET "targetLabel" = f."name" || ' v' || f."version" FROM "FormulaSet" AS f WHERE l."targetType" = 'FormulaSet' AND l."targetId" = f."id";
UPDATE "SuperAdminAuditLog" AS l SET "targetLabel" = c."code"      FROM "ComponentType" AS c WHERE l."targetType" = 'ComponentType' AND l."targetId" = c."id";
UPDATE "SuperAdminAuditLog" AS l SET "targetLabel" = s."username"  FROM "SuperAdmin"    AS s WHERE l."targetType" = 'SuperAdmin'    AND l."targetId" = s."id";

-- ── Backfill: targetLabel — fall back to what the writer saved in metadata (deleted targets) ─────
UPDATE "SuperAdminAuditLog"
SET "targetLabel" = COALESCE(
  NULLIF("metadata"->>'deletedUsername', ''),
  NULLIF("metadata"->>'username', ''),
  NULLIF("metadata"->>'slug', ''),
  NULLIF("metadata"->>'newName', ''),
  CASE WHEN "metadata"->>'name' IS NOT NULL AND "metadata"->>'version' IS NOT NULL
       THEN ("metadata"->>'name') || ' v' || ("metadata"->>'version') END,
  NULLIF("metadata"->>'name', '')
)
WHERE "targetLabel" IS NULL AND "metadata" IS NOT NULL;

-- ── Indexes for the filtered / paged list ────────────────────────────────────────────────────────
CREATE INDEX "SuperAdminAuditLog_organizationId_createdAt_idx" ON "SuperAdminAuditLog"("organizationId", "createdAt" DESC);
CREATE INDEX "SuperAdminAuditLog_createdAt_idx" ON "SuperAdminAuditLog"("createdAt" DESC);
