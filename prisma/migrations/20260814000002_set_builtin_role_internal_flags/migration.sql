-- DataMigration
-- Set isInternalRole = true for the two built-in internal roles (Admin,
-- Company Member). All other roles keep the column default of false.
-- This runs once on first deploy after 20260814000001 applied the column.
UPDATE "Role" SET "isInternalRole" = true WHERE "name" IN ('Admin', 'Company Member');
