-- CreateEnum
CREATE TYPE "ChequeDirection" AS ENUM ('RECEIVED', 'ISSUED');

-- CreateEnum
CREATE TYPE "ChequeStatus" AS ENUM ('RECEIVED', 'ISSUED', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED', 'REPLACED');

-- CreateTable
CREATE TABLE "Cheque" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "direction" "ChequeDirection" NOT NULL,
    "chequeNo" TEXT NOT NULL,
    "bankName" TEXT,
    "branch" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "issueDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "customerId" TEXT,
    "supplierId" TEXT,
    "proformaInvoiceId" TEXT,
    "purchaseOrderId" TEXT,
    "bankAccountId" TEXT,
    "status" "ChequeStatus" NOT NULL,
    "remarks" TEXT,
    "bounceReason" TEXT,
    "replacesId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cheque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChequeStatusEvent" (
    "id" TEXT NOT NULL,
    "chequeId" TEXT NOT NULL,
    "fromStatus" "ChequeStatus",
    "toStatus" "ChequeStatus" NOT NULL,
    "date" DATE NOT NULL,
    "remarks" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChequeStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cheque_number_key" ON "Cheque"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Cheque_replacesId_key" ON "Cheque"("replacesId");

-- CreateIndex
CREATE INDEX "Cheque_direction_status_dueDate_idx" ON "Cheque"("direction", "status", "dueDate");

-- CreateIndex
CREATE INDEX "Cheque_customerId_idx" ON "Cheque"("customerId");

-- CreateIndex
CREATE INDEX "Cheque_supplierId_idx" ON "Cheque"("supplierId");

-- CreateIndex
CREATE INDEX "ChequeStatusEvent_chequeId_idx" ON "ChequeStatusEvent"("chequeId");

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_proformaInvoiceId_fkey" FOREIGN KEY ("proformaInvoiceId") REFERENCES "ProformaInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "Cheque"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChequeStatusEvent" ADD CONSTRAINT "ChequeStatusEvent_chequeId_fkey" FOREIGN KEY ("chequeId") REFERENCES "Cheque"("id") ON DELETE CASCADE ON UPDATE CASCADE;
