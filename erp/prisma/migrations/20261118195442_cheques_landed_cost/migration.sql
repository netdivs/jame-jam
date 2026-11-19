-- AlterTable
ALTER TABLE "Cheque" ADD COLUMN     "landedCostExpenseId" TEXT;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_landedCostExpenseId_fkey" FOREIGN KEY ("landedCostExpenseId") REFERENCES "LandedCostExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
