-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN "soldInWholePacks" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "partKey" TEXT;
