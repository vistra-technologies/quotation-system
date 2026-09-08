-- Stage 18 clean-break migration: Floor -> Room -> Partition restructure.
-- No data preservation — existing Partition and Floor rows are deleted before
-- the column changes below (production carries no real Floor/Partition data
-- yet; explicitly authorized in development-cycles/stage-18.md, "Migration
-- is a clean break"). This must run before the DROP COLUMN/ADD COLUMN NOT
-- NULL changes on "Partition", since roomId/label have no default and the
-- old floorId FK would otherwise block the DELETE ordering below.
DELETE FROM "Partition";
DELETE FROM "Floor";

-- DropForeignKey
ALTER TABLE "Partition" DROP CONSTRAINT "Partition_floorId_fkey";

-- AlterTable
ALTER TABLE "Partition" DROP COLUMN "floorId",
DROP COLUMN "location",
ADD COLUMN     "label" TEXT NOT NULL,
ADD COLUMN     "roomId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "floorId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT true,
    "sides" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Room_floorId_label_key" ON "Room"("floorId", "label");

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Partition" ADD CONSTRAINT "Partition_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
