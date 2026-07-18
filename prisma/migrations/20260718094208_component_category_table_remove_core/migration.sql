/*
  Warnings:

  - Added the required column `categoryId` to the `ComponentType` table without a default value.
    This is a hand-written migration (not `prisma migrate dev`, which refuses non-interactively):
    it introduces `ComponentCategory` as a real lookup table backing the category dropdown, backfills
    one row per distinct (organizationId, category) pair already present in `ComponentType`, points
    every existing row at its matching category, then drops the old free-text `category` column.
  - The per-field `core` boolean inside `ComponentType.fieldsSchema` (JSONB) is dropped at the
    application layer only — existing JSONB rows may still carry a stale `core` key, which the app
    now ignores on read and strips on next save. No JSONB migration needed.

*/
-- CreateTable
CREATE TABLE "ComponentCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComponentCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ComponentCategory_organizationId_name_key" ON "ComponentCategory"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "ComponentCategory" ADD CONSTRAINT "ComponentCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: one ComponentCategory row per distinct (organizationId, category) pair already in use
INSERT INTO "ComponentCategory" ("id", "organizationId", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid(), t."organizationId", t."category", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "organizationId", "category" FROM "ComponentType") t;

-- AlterTable: add categoryId, backfill it from the new ComponentCategory rows, then drop the old column
ALTER TABLE "ComponentType" ADD COLUMN "categoryId" TEXT;

UPDATE "ComponentType" ct
SET "categoryId" = cc."id"
FROM "ComponentCategory" cc
WHERE cc."organizationId" = ct."organizationId" AND cc."name" = ct."category";

ALTER TABLE "ComponentType" ALTER COLUMN "categoryId" SET NOT NULL;
ALTER TABLE "ComponentType" DROP COLUMN "category";

-- AddForeignKey
ALTER TABLE "ComponentType" ADD CONSTRAINT "ComponentType_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ComponentCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
