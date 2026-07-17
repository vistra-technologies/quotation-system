/*
  Warnings:

  - Added the required column `category` to the `ComponentType` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
-- Add with a default first so existing rows get a value, then remove the default.
ALTER TABLE "ComponentType" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'Glass Partitions';
ALTER TABLE "ComponentType" ALTER COLUMN "category" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Selection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "componentTypeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Selection_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Selection" ADD CONSTRAINT "Selection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Selection" ADD CONSTRAINT "Selection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Selection" ADD CONSTRAINT "Selection_componentTypeId_fkey" FOREIGN KEY ("componentTypeId") REFERENCES "ComponentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
