-- CreateEnum
CREATE TYPE "Emirate" AS ENUM ('ABU_DHABI', 'DUBAI', 'SHARJAH', 'AJMAN', 'UMM_AL_QUWAIN', 'RAS_AL_KHAIMAH', 'FUJAIRAH');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "emirate" "Emirate";

-- AlterTable
ALTER TABLE "TaxInvoice" ADD COLUMN     "supplyEmirate" "Emirate";
