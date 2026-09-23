-- Stage 24 Batch 1: CatalogItem → InventoryItem rename (+ measurementUnit, perUnitQuantity, @@index),
-- ItemPrice.catalogItemId → inventoryItemId, ProjectCalculation.materialByRoom.
-- Structural only — no TRUNCATE. Placeholder InventoryItem rows survive the rename as-is;
-- truncating and reseeding is a human-run runbook step (see stage-24-prod-runbook.md).

-- ── 1. Rename table CatalogItem → InventoryItem ──────────────────────────────
ALTER TABLE "CatalogItem" RENAME TO "InventoryItem";

-- ── 2. Column renames on InventoryItem ───────────────────────────────────────
ALTER TABLE "InventoryItem" RENAME COLUMN "unitOfMeasure" TO "measurementUnit";

-- ── 3. Add perUnitQuantity ────────────────────────────────────────────────────
ALTER TABLE "InventoryItem" ADD COLUMN "perUnitQuantity" DECIMAL(65,30) NOT NULL DEFAULT 1;

-- ── 4. Rename constraints and indexes on InventoryItem ───────────────────────
ALTER TABLE "InventoryItem" RENAME CONSTRAINT "CatalogItem_pkey" TO "InventoryItem_pkey";
ALTER INDEX "CatalogItem_organizationId_code_key" RENAME TO "InventoryItem_organizationId_code_key";
ALTER TABLE "InventoryItem" RENAME CONSTRAINT "CatalogItem_organizationId_fkey" TO "InventoryItem_organizationId_fkey";

-- ── 5. Add composite index on InventoryItem ───────────────────────────────────
CREATE INDEX "InventoryItem_organizationId_active_idx" ON "InventoryItem"("organizationId", "active");

-- ── 6. ItemPrice: rename catalogItemId column ────────────────────────────────
ALTER TABLE "ItemPrice" RENAME COLUMN "catalogItemId" TO "inventoryItemId";

-- ── 7. Rename ItemPrice constraints/indexes ──────────────────────────────────
ALTER INDEX "ItemPrice_catalogItemId_currency_key" RENAME TO "ItemPrice_inventoryItemId_currency_key";
ALTER TABLE "ItemPrice" RENAME CONSTRAINT "ItemPrice_catalogItemId_fkey" TO "ItemPrice_inventoryItemId_fkey";

-- ── 8. ProjectCalculation.materialByRoom ─────────────────────────────────────
ALTER TABLE "ProjectCalculation" ADD COLUMN "materialByRoom" JSONB NOT NULL DEFAULT '[]';
