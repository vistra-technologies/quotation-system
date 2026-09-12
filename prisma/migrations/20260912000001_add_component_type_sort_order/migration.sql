-- Stage 20 Batch 7: ComponentType.sortOrder
-- Adds a plain admin-reorderable Int column, decoupling list/palette order from the
-- now-editable `code` string. Backfills existing rows per-org by current alpha `code`
-- order (0-based), matching the pre-existing `orderBy: { code: "asc" }` behavior so no
-- org's palette order visibly changes the moment this migration runs.
-- See design-docs/04-data-model.md — ComponentType (Stage 20 addendum).

-- ── 1. Add the column ─────────────────────────────────────────────────────────
ALTER TABLE "ComponentType" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- ── 2. Backfill: per-org 0-based sequence by current code alpha order ─────────
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY code ASC) - 1 AS rn
  FROM "ComponentType"
)
UPDATE "ComponentType" ct
SET "sortOrder" = ranked.rn
FROM ranked
WHERE ct.id = ranked.id;
