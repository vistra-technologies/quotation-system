-- CreateEnum
CREATE TYPE "CompanyCountry" AS ENUM ('INDIA', 'UAE');

-- CreateEnum
CREATE TYPE "CompanyDefaultCurrency" AS ENUM ('INR', 'AED', 'USD');

-- AlterTable
ALTER TABLE "ExternalCompany" ADD COLUMN     "country" "CompanyCountry" NOT NULL DEFAULT 'INDIA',
ADD COLUMN     "defaultCurrency" "CompanyDefaultCurrency" NOT NULL DEFAULT 'INR';
