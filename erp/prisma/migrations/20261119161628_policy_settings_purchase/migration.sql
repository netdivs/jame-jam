-- AlterTable
ALTER TABLE "LandedCostCategory" ADD COLUMN     "defaultBasis" "AllocationBasis";

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "creditAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "creditDays" INTEGER;

-- AlterTable
ALTER TABLE "SupplierPayment" ADD COLUMN     "bankCharges" DECIMAL(18,2) NOT NULL DEFAULT 0;
