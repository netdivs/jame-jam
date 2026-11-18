-- CreateEnum
CREATE TYPE "OpeningKind" AS ENUM ('CUSTOMER_INVOICE', 'SUPPLIER_INVOICE', 'CUSTOMER_ADVANCE', 'SUPPLIER_ADVANCE', 'CASH_BANK');

-- CreateEnum
CREATE TYPE "OpeningStatus" AS ENUM ('OPEN', 'SETTLED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Cheque" ADD COLUMN     "openingItemId" TEXT;

-- AlterTable
ALTER TABLE "SupplierPayment" ADD COLUMN     "openingItemId" TEXT;

-- CreateTable
CREATE TABLE "OpeningItem" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "OpeningKind" NOT NULL,
    "date" DATE NOT NULL,
    "customerId" TEXT,
    "supplierId" TEXT,
    "accountId" TEXT,
    "refNo" TEXT,
    "docDate" DATE,
    "dueDate" DATE,
    "amount" DECIMAL(18,2) NOT NULL,
    "settledAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "OpeningStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpeningItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningAllocation" (
    "id" TEXT NOT NULL,
    "openingItemId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpeningAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpeningItem_number_key" ON "OpeningItem"("number");

-- CreateIndex
CREATE INDEX "OpeningItem_kind_status_idx" ON "OpeningItem"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningItem_kind_customerId_refNo_key" ON "OpeningItem"("kind", "customerId", "refNo");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningItem_kind_supplierId_refNo_key" ON "OpeningItem"("kind", "supplierId", "refNo");

-- CreateIndex
CREATE INDEX "OpeningAllocation_openingItemId_idx" ON "OpeningAllocation"("openingItemId");

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_openingItemId_fkey" FOREIGN KEY ("openingItemId") REFERENCES "OpeningItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_openingItemId_fkey" FOREIGN KEY ("openingItemId") REFERENCES "OpeningItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningItem" ADD CONSTRAINT "OpeningItem_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningItem" ADD CONSTRAINT "OpeningItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningItem" ADD CONSTRAINT "OpeningItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningAllocation" ADD CONSTRAINT "OpeningAllocation_openingItemId_fkey" FOREIGN KEY ("openingItemId") REFERENCES "OpeningItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
