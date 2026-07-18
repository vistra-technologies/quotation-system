-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "inquiryId" TEXT;

-- CreateTable
CREATE TABLE "Inquiry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalCompanyId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "inquiryNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "destinationCountry" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Inquiry_organizationId_inquiryNumber_key" ON "Inquiry"("organizationId", "inquiryNumber");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_externalCompanyId_fkey" FOREIGN KEY ("externalCompanyId") REFERENCES "ExternalCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
