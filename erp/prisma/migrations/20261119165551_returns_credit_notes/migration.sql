-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RECEIVED', 'CREDITED');

-- CreateEnum
CREATE TYPE "ReturnCondition" AS ENUM ('GOOD', 'DAMAGED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CreditNoteKind" AS ENUM ('RETURN', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('PENDING_APPROVAL', 'POSTED', 'REJECTED');

-- AlterTable
ALTER TABLE "TaxInvoice" ADD COLUMN     "creditedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TaxInvoiceItem" ADD COLUMN     "creditedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "taxInvoiceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRequestItem" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "taxInvoiceItemId" TEXT NOT NULL,
    "sqm" DECIMAL(18,4) NOT NULL,
    "receivedSqm" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "condition" "ReturnCondition",
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "ReturnRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "kind" "CreditNoteKind" NOT NULL,
    "status" "CreditNoteStatus" NOT NULL,
    "taxInvoiceId" TEXT NOT NULL,
    "returnRequestId" TEXT,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerTrn" TEXT,
    "date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "netTotal" DECIMAL(18,2) NOT NULL,
    "vatTotal" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "toReceivable" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "toAdvance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNoteItem" (
    "id" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "taxInvoiceItemId" TEXT NOT NULL,
    "sqm" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(18,2) NOT NULL,
    "vatAmount" DECIMAL(18,2) NOT NULL,
    "grossAmount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "CreditNoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRequest_number_key" ON "ReturnRequest"("number");

-- CreateIndex
CREATE INDEX "ReturnRequest_taxInvoiceId_idx" ON "ReturnRequest"("taxInvoiceId");

-- CreateIndex
CREATE INDEX "ReturnRequest_status_idx" ON "ReturnRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRequestItem_returnRequestId_lineNo_key" ON "ReturnRequestItem"("returnRequestId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_number_key" ON "CreditNote"("number");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_returnRequestId_key" ON "CreditNote"("returnRequestId");

-- CreateIndex
CREATE INDEX "CreditNote_taxInvoiceId_idx" ON "CreditNote"("taxInvoiceId");

-- CreateIndex
CREATE INDEX "CreditNote_status_idx" ON "CreditNote"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNoteItem_creditNoteId_lineNo_key" ON "CreditNoteItem"("creditNoteId", "lineNo");

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_taxInvoiceId_fkey" FOREIGN KEY ("taxInvoiceId") REFERENCES "TaxInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequestItem" ADD CONSTRAINT "ReturnRequestItem_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequestItem" ADD CONSTRAINT "ReturnRequestItem_taxInvoiceItemId_fkey" FOREIGN KEY ("taxInvoiceItemId") REFERENCES "TaxInvoiceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_taxInvoiceId_fkey" FOREIGN KEY ("taxInvoiceId") REFERENCES "TaxInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNoteItem" ADD CONSTRAINT "CreditNoteItem_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNoteItem" ADD CONSTRAINT "CreditNoteItem_taxInvoiceItemId_fkey" FOREIGN KEY ("taxInvoiceItemId") REFERENCES "TaxInvoiceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
