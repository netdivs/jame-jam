-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('POSTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "ProformaInvoice" ADD COLUMN     "receivedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CustomerReceipt" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "bankAccountId" TEXT,
    "reference" TEXT,
    "proformaInvoiceId" TEXT,
    "allocatedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'POSTED',
    "notes" TEXT,
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerReceipt_number_key" ON "CustomerReceipt"("number");

-- CreateIndex
CREATE INDEX "CustomerReceipt_customerId_idx" ON "CustomerReceipt"("customerId");

-- CreateIndex
CREATE INDEX "CustomerReceipt_proformaInvoiceId_idx" ON "CustomerReceipt"("proformaInvoiceId");

-- AddForeignKey
ALTER TABLE "CustomerReceipt" ADD CONSTRAINT "CustomerReceipt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReceipt" ADD CONSTRAINT "CustomerReceipt_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReceipt" ADD CONSTRAINT "CustomerReceipt_proformaInvoiceId_fkey" FOREIGN KEY ("proformaInvoiceId") REFERENCES "ProformaInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
