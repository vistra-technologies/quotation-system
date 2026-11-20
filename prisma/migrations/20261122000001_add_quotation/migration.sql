-- Stage 38 Batch 3: Quotation table, EXTEND_QUOTE permission, QUOTE / EXTEND_QUOTE grants.

CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalCompanyId" TEXT,
    "projectId" TEXT NOT NULL,
    "quotationNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "transport" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "otherCharges" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "discount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "discountType" TEXT NOT NULL DEFAULT 'PERCENT',
    "discountAppliedByUserId" TEXT,
    "discountAppliedAt" TIMESTAMP(3),
    "taxPercent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(65,30) NOT NULL,
    "grandTotal" DECIMAL(65,30) NOT NULL,
    "pricedAt" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Quotation_organizationId_quotationNumber_key" ON "Quotation"("organizationId", "quotationNumber");
CREATE INDEX "Quotation_organizationId_projectId_idx" ON "Quotation"("organizationId", "projectId");

ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EXTEND_QUOTE permission (idempotent); the row must exist in the same migration as the table so create-org,
-- which resolves DEFAULT_ROLE_DEFS codes against Permission rows, never sees the code without its row.
INSERT INTO "Permission" ("id", "code", "description")
VALUES (gen_random_uuid()::text, 'EXTEND_QUOTE', 'Extend a quotation''s validity without repricing (Renew)')
ON CONFLICT ("code") DO NOTHING;

-- QUOTE for every internal role (Q-D17).
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", (SELECT "id" FROM "Permission" WHERE "code" = 'QUOTE')
FROM "Role" r
WHERE r."isInternalRole" = true
ON CONFLICT DO NOTHING;

-- EXTEND_QUOTE for every role that already holds MANAGE_USERS (Q-D18).
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT rp."roleId", (SELECT "id" FROM "Permission" WHERE "code" = 'EXTEND_QUOTE')
FROM "RolePermission" rp
JOIN "Permission" p ON p."id" = rp."permissionId"
WHERE p."code" = 'MANAGE_USERS'
ON CONFLICT DO NOTHING;
