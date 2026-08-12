-- Stage 14 Batch A: Add 15 extended intake fields to Inquiry and Project.
-- All columns are nullable — no defaults required, no table rewrite, backward-compatible.

-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "endClientAddressLine1" TEXT,
ADD COLUMN     "endClientAddressLine2" TEXT,
ADD COLUMN     "endClientCity" TEXT,
ADD COLUMN     "endClientEmail" TEXT,
ADD COLUMN     "endClientGstNumber" TEXT,
ADD COLUMN     "endClientName" TEXT,
ADD COLUMN     "endClientPhone" TEXT,
ADD COLUMN     "endClientState" TEXT,
ADD COLUMN     "interiorConsultantName" TEXT,
ADD COLUMN     "interiorContractorName" TEXT,
ADD COLUMN     "mainConsultantName" TEXT,
ADD COLUMN     "mainContractorName" TEXT,
ADD COLUMN     "projectBudget" TEXT,
ADD COLUMN     "projectDeadline" TIMESTAMP(3),
ADD COLUMN     "submissionDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "endClientAddressLine1" TEXT,
ADD COLUMN     "endClientAddressLine2" TEXT,
ADD COLUMN     "endClientCity" TEXT,
ADD COLUMN     "endClientEmail" TEXT,
ADD COLUMN     "endClientGstNumber" TEXT,
ADD COLUMN     "endClientName" TEXT,
ADD COLUMN     "endClientPhone" TEXT,
ADD COLUMN     "endClientState" TEXT,
ADD COLUMN     "interiorConsultantName" TEXT,
ADD COLUMN     "interiorContractorName" TEXT,
ADD COLUMN     "mainConsultantName" TEXT,
ADD COLUMN     "mainContractorName" TEXT,
ADD COLUMN     "projectBudget" TEXT,
ADD COLUMN     "projectDeadline" TIMESTAMP(3),
ADD COLUMN     "submissionDate" TIMESTAMP(3);
