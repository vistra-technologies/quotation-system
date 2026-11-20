-- Stage 38 Batch 3 fix round: Quotation.quantitiesAt (architect ruling B3-1, human-approved 2026-11-20).
-- When the stored QUANTITIES were last taken from a calculation: set on create and Refresh only, never by Reset all
-- prices, Renew, the money-input PATCH or line edits. "Design changed" = no calculation or computedAt > quantitiesAt.

ALTER TABLE "Quotation" ADD COLUMN "quantitiesAt" TIMESTAMP(3);
UPDATE "Quotation" SET "quantitiesAt" = "pricedAt";
ALTER TABLE "Quotation" ALTER COLUMN "quantitiesAt" SET NOT NULL;

-- Belt for 20261122000001 (applied already, so not edited): its QUOTE grant used a scalar subquery on a seed-only
-- Permission row. Make sure the row exists and every internal role holds it (idempotent, a no-op where seeded).
INSERT INTO "Permission" ("id", "code", "description")
VALUES (gen_random_uuid()::text, 'QUOTE', 'Generate and submit quotations')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" = 'QUOTE'
WHERE r."isInternalRole" = true
ON CONFLICT DO NOTHING;
