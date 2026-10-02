-- Hotfix 2026-10-02: SuperAdmin accounts can be deleted without losing audit history.
--
-- SuperAdminAuditLog.superAdminId was a required FK (ON DELETE RESTRICT), so any SuperAdmin who had
-- ever made a change could never be deleted. Keep every audit row instead:
--   1. add a write-time username snapshot, backfilled from the current SuperAdmin join;
--   2. make superAdminId nullable;
--   3. re-create the FK as ON DELETE SET NULL (a DB-level referential action, not an app-code write).

-- 1. snapshot column + backfill
ALTER TABLE "SuperAdminAuditLog" ADD COLUMN "superAdminUsername" TEXT;

UPDATE "SuperAdminAuditLog" AS l
SET "superAdminUsername" = s."username"
FROM "SuperAdmin" AS s
WHERE l."superAdminId" = s."id";

-- 2. nullable link
ALTER TABLE "SuperAdminAuditLog" ALTER COLUMN "superAdminId" DROP NOT NULL;

-- 3. FK: RESTRICT -> SET NULL
ALTER TABLE "SuperAdminAuditLog" DROP CONSTRAINT "SuperAdminAuditLog_superAdminId_fkey";
ALTER TABLE "SuperAdminAuditLog" ADD CONSTRAINT "SuperAdminAuditLog_superAdminId_fkey"
  FOREIGN KEY ("superAdminId") REFERENCES "SuperAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
