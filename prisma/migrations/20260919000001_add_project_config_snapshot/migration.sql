-- Stage 22 B3: nullable, additive JSONB column - no backfill here (B4), no data loss risk.
ALTER TABLE "Project" ADD COLUMN "configSnapshot" JSONB;
