-- AlterTable: add per-ExternalCompany display sequence to Inquiry (Stage 13 Batch 4 extension)
-- NULL when the inquiry has no linked company; @@unique([externalCompanyId, companyInquiryNumber])
-- guards per-company sequence uniqueness without affecting no-company rows.
ALTER TABLE "Inquiry" ADD COLUMN "companyInquiryNumber" INTEGER;

-- AlterTable: add per-ExternalCompany display sequence to Project (Stage 13 Batch 4 extension)
-- NULL when the project has no linked company; @@unique([externalCompanyId, companyProjectNumber]).
ALTER TABLE "Project" ADD COLUMN "companyProjectNumber" INTEGER;

-- CreateIndex: enforce uniqueness of companyInquiryNumber within each ExternalCompany.
-- Postgres unique indexes ignore NULL values, so rows with no company do not collide.
CREATE UNIQUE INDEX "Inquiry_externalCompanyId_companyInquiryNumber_key"
  ON "Inquiry"("externalCompanyId", "companyInquiryNumber");

-- CreateIndex: enforce uniqueness of companyProjectNumber within each ExternalCompany.
CREATE UNIQUE INDEX "Project_externalCompanyId_companyProjectNumber_key"
  ON "Project"("externalCompanyId", "companyProjectNumber");
