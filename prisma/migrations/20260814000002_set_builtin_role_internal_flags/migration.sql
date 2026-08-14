-- DataMigration
-- Set isInternalRole = true for the two built-in internal roles (Admin and
-- Company Member). All other roles keep the column default of false (external).
-- Runs once on first deploy after 20260814000001 added the column.
UPDATE "Role" SET "isInternalRole" = true WHERE "name" IN ('Admin', 'Company Member');
