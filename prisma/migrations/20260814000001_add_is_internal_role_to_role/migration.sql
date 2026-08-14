-- Stage 15 Batch G (U3): Add isInternalRole flag to Role
-- Distinguishes internal staff roles (Admin, Company Member — may omit External Company)
-- from external roles (Distributor, Architectural Firm — must link to External Company).
-- Additive column with a safe default (false) — zero-downtime, no backfill required.
ALTER TABLE "Role" ADD COLUMN "isInternalRole" BOOLEAN NOT NULL DEFAULT false;
