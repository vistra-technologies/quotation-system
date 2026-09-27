-- Hotfix 2026-09-27 H-17: add componentTypeId FK on InventoryItem → ComponentType.
-- The legacy `category` String column is intentionally kept (no DROP) — audit trail;
-- a future migration may drop it once the backfill is verified and the column confirmed unused.
-- onDelete: RESTRICT prevents deletion of a ComponentType that still has InventoryItems referencing it.
-- Nullable (no NOT NULL constraint) — existing rows and items with no ComponentType mapping stay NULL.

-- AlterTable: add the nullable FK column
ALTER TABLE "InventoryItem" ADD COLUMN "componentTypeId" TEXT;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_componentTypeId_fkey"
  FOREIGN KEY ("componentTypeId") REFERENCES "ComponentType"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
