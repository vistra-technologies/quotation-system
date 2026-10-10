-- Stage 31 S31-4: a deleted user's projects and inquiries stay (people leave, records stay).
-- Loosening/additive only, no data statements: every existing row stays valid, no backfill.
--   * createdByUserId becomes nullable; the FK is re-created as ON DELETE SET NULL
--   * createdByName (TEXT) holds a snapshot of the creator's name, written by the app on user delete

-- AlterTable
ALTER TABLE "Project" ALTER COLUMN "createdByUserId" DROP NOT NULL;
ALTER TABLE "Project" ADD COLUMN "createdByName" TEXT;

-- AlterTable
ALTER TABLE "Inquiry" ALTER COLUMN "createdByUserId" DROP NOT NULL;
ALTER TABLE "Inquiry" ADD COLUMN "createdByName" TEXT;

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_createdByUserId_fkey";
ALTER TABLE "Inquiry" DROP CONSTRAINT "Inquiry_createdByUserId_fkey";

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
