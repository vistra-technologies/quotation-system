-- CreateTable
CREATE TABLE "ProductPricing" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "componentTypeId" TEXT NOT NULL,
    "combinationKey" TEXT NOT NULL,
    "combinationLabel" TEXT NOT NULL,
    "prices" JSONB NOT NULL DEFAULT '[]',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPricing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductPricing_organizationId_componentTypeId_combinationKe_key" ON "ProductPricing"("organizationId", "componentTypeId", "combinationKey");

-- AddForeignKey
ALTER TABLE "ProductPricing" ADD CONSTRAINT "ProductPricing_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPricing" ADD CONSTRAINT "ProductPricing_componentTypeId_fkey" FOREIGN KEY ("componentTypeId") REFERENCES "ComponentType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

