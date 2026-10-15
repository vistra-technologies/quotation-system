-- Stage 33 Batch 2 (S33-17): an optional saved Quick Estimate on an Inquiry (self-contained JSON snapshot).
-- Additive only: nullable, no default, no backfill, no index.
ALTER TABLE "Inquiry" ADD COLUMN "quickEstimate" JSONB;
