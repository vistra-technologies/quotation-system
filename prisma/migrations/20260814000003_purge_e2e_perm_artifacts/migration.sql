-- DataMigration
-- Remove E2E_PERM_* permission records left behind by the Stage 4 admin
-- E2E test suite (admin-stage4.spec.ts). Those tests create throwaway
-- permissions but lack a teardown step. The seed also purges these via
-- deleteMany, but the seed does not run automatically in Vercel builds.
-- This migration ensures the one-time cleanup happens on every environment
-- where it hasn't run yet. It is safe to run against a DB that has no such
-- rows — both DELETEs become no-ops.
DELETE FROM "RolePermission"
WHERE "permissionId" IN (
  SELECT id FROM "Permission" WHERE code LIKE 'E2E_PERM_%'
);
DELETE FROM "Permission" WHERE code LIKE 'E2E_PERM_%';
