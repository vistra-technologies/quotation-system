-- Submit Design gate: nullable, additive column — no backfill needed, no data loss risk.
ALTER TABLE "Project" ADD COLUMN "designSubmittedAt" TIMESTAMP(3);
