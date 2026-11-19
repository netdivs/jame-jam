-- CreateEnum
CREATE TYPE "RefundParty" AS ENUM ('CUSTOMER', 'SUPPLIER');

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "partyType" "RefundParty" NOT NULL,
    "customerId" TEXT,
    "supplierId" TEXT,
    "proformaInvoiceId" TEXT,
    "purchaseOrderId" TEXT,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "bankAccountId" TEXT,
    "reference" TEXT,
    "reason" TEXT NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'POSTED',
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierAdvanceTransfer" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "fromPurchaseOrderId" TEXT NOT NULL,
    "toPurchaseOrderId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "toPayable" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "toAdvance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'POSTED',
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierAdvanceTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Refund_number_key" ON "Refund"("number");

-- CreateIndex
CREATE INDEX "Refund_customerId_idx" ON "Refund"("customerId");

-- CreateIndex
CREATE INDEX "Refund_supplierId_idx" ON "Refund"("supplierId");

-- CreateIndex
CREATE INDEX "Refund_proformaInvoiceId_idx" ON "Refund"("proformaInvoiceId");

-- CreateIndex
CREATE INDEX "Refund_purchaseOrderId_idx" ON "Refund"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierAdvanceTransfer_number_key" ON "SupplierAdvanceTransfer"("number");

-- CreateIndex
CREATE INDEX "SupplierAdvanceTransfer_supplierId_idx" ON "SupplierAdvanceTransfer"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierAdvanceTransfer_fromPurchaseOrderId_idx" ON "SupplierAdvanceTransfer"("fromPurchaseOrderId");

-- CreateIndex
CREATE INDEX "SupplierAdvanceTransfer_toPurchaseOrderId_idx" ON "SupplierAdvanceTransfer"("toPurchaseOrderId");

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_proformaInvoiceId_fkey" FOREIGN KEY ("proformaInvoiceId") REFERENCES "ProformaInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAdvanceTransfer" ADD CONSTRAINT "SupplierAdvanceTransfer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAdvanceTransfer" ADD CONSTRAINT "SupplierAdvanceTransfer_fromPurchaseOrderId_fkey" FOREIGN KEY ("fromPurchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAdvanceTransfer" ADD CONSTRAINT "SupplierAdvanceTransfer_toPurchaseOrderId_fkey" FOREIGN KEY ("toPurchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
