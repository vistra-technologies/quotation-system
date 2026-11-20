-- Stage 38 Batch 1: ItemPrice min/allowAbove, Organization.defaultCurrency, MANAGE_ORG permission.

-- ItemPrice: minPrice backfilled from price, then made required.
ALTER TABLE "ItemPrice" ADD COLUMN "minPrice" DECIMAL(65,30), ADD COLUMN "allowAbove" BOOLEAN NOT NULL DEFAULT false;
UPDATE "ItemPrice" SET "minPrice" = "price";
ALTER TABLE "ItemPrice" ALTER COLUMN "minPrice" SET NOT NULL;

-- Organization default currency.
ALTER TABLE "Organization" ADD COLUMN "defaultCurrency" TEXT NOT NULL DEFAULT 'INR';

-- MANAGE_ORG permission, granted to every role that already holds MANAGE_USERS (idempotent).
INSERT INTO "Permission" ("id", "code", "description")
VALUES (gen_random_uuid()::text, 'MANAGE_ORG', 'Manage organization settings')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT rp."roleId", (SELECT "id" FROM "Permission" WHERE "code" = 'MANAGE_ORG')
FROM "RolePermission" rp
JOIN "Permission" p ON p."id" = rp."permissionId"
WHERE p."code" = 'MANAGE_USERS'
ON CONFLICT DO NOTHING;
