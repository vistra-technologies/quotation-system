-- Stage 29 Batch 2: per-org user limit (S29-7). Additive: a defaulted NOT NULL column plus a CHECK.
--
-- Backfill (O-2, decided 2026-10-09): an existing org keeps everyone it has, so its limit is
-- GREATEST(3, current user count). Every User row counts, active or not. New orgs get the default 3.
-- Re-running the UPDATE is safe: it can only raise a limit to the current count, never lower it.

ALTER TABLE "Organization"
  ADD COLUMN "userLimit" INTEGER NOT NULL DEFAULT 3;

ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_userLimit_check" CHECK ("userLimit" >= 1);

UPDATE "Organization" AS o
SET "userLimit" = GREATEST(o."userLimit", (SELECT COUNT(*)::int FROM "user" AS u WHERE u."organizationId" = o."id"));
