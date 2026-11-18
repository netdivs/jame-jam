-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "convertedCustomerId" TEXT;

-- CreateIndex
CREATE INDEX "Lead_convertedCustomerId_idx" ON "Lead"("convertedCustomerId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_convertedCustomerId_fkey" FOREIGN KEY ("convertedCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

