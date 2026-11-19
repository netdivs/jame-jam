-- CreateTable
CREATE TABLE "TaxInvoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "proformaInvoiceId" TEXT,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerAddress" TEXT,
    "customerTrn" TEXT,
    "customerMobile" TEXT,
    "companyName" TEXT NOT NULL,
    "companyAddress" TEXT,
    "companyTrn" TEXT,
    "date" DATE NOT NULL,
    "priceMode" "PriceMode" NOT NULL,
    "discount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netTotal" DECIMAL(18,2) NOT NULL,
    "vatTotal" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "settledAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxInvoiceItem" (
    "id" TEXT NOT NULL,
    "taxInvoiceId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "salesOrderItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "description" TEXT,
    "sqm" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "headerDiscount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxCodeId" TEXT NOT NULL,
    "taxReason" TEXT,
    "netAmount" DECIMAL(18,2) NOT NULL,
    "vatAmount" DECIMAL(18,2) NOT NULL,
    "grossAmount" DECIMAL(18,2) NOT NULL,
    "deliveredSqm" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "TaxInvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceAllocation" (
    "id" TEXT NOT NULL,
    "taxInvoiceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "proformaInvoiceId" TEXT,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxInvoice_number_key" ON "TaxInvoice"("number");

-- CreateIndex
CREATE INDEX "TaxInvoice_customerId_idx" ON "TaxInvoice"("customerId");

-- CreateIndex
CREATE INDEX "TaxInvoice_salesOrderId_idx" ON "TaxInvoice"("salesOrderId");

-- CreateIndex
CREATE INDEX "TaxInvoice_date_idx" ON "TaxInvoice"("date");

-- CreateIndex
CREATE UNIQUE INDEX "TaxInvoiceItem_taxInvoiceId_lineNo_key" ON "TaxInvoiceItem"("taxInvoiceId", "lineNo");

-- CreateIndex
CREATE INDEX "InvoiceAllocation_taxInvoiceId_idx" ON "InvoiceAllocation"("taxInvoiceId");

-- CreateIndex
CREATE INDEX "InvoiceAllocation_customerId_idx" ON "InvoiceAllocation"("customerId");

-- AddForeignKey
ALTER TABLE "TaxInvoice" ADD CONSTRAINT "TaxInvoice_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxInvoice" ADD CONSTRAINT "TaxInvoice_proformaInvoiceId_fkey" FOREIGN KEY ("proformaInvoiceId") REFERENCES "ProformaInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxInvoice" ADD CONSTRAINT "TaxInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxInvoiceItem" ADD CONSTRAINT "TaxInvoiceItem_taxInvoiceId_fkey" FOREIGN KEY ("taxInvoiceId") REFERENCES "TaxInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxInvoiceItem" ADD CONSTRAINT "TaxInvoiceItem_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxInvoiceItem" ADD CONSTRAINT "TaxInvoiceItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxInvoiceItem" ADD CONSTRAINT "TaxInvoiceItem_taxCodeId_fkey" FOREIGN KEY ("taxCodeId") REFERENCES "TaxCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceAllocation" ADD CONSTRAINT "InvoiceAllocation_taxInvoiceId_fkey" FOREIGN KEY ("taxInvoiceId") REFERENCES "TaxInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceAllocation" ADD CONSTRAINT "InvoiceAllocation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceAllocation" ADD CONSTRAINT "InvoiceAllocation_proformaInvoiceId_fkey" FOREIGN KEY ("proformaInvoiceId") REFERENCES "ProformaInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
