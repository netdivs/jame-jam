-- CreateEnum
CREATE TYPE "PettyCashType" AS ENUM ('TOP_UP', 'EXPENSE');

-- CreateTable
CREATE TABLE "PettyCashAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "custodianId" TEXT,
    "accountId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PettyCashAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PettyCashTransaction" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "pettyCashAccountId" TEXT NOT NULL,
    "type" "PettyCashType" NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "mode" "PaymentMode",
    "bankAccountId" TEXT,
    "categoryId" TEXT,
    "taxCodeId" TEXT,
    "netAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "payee" TEXT,
    "reference" TEXT,
    "description" TEXT NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'POSTED',
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PettyCashTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PettyCashAccount_code_key" ON "PettyCashAccount"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PettyCashAccount_accountId_key" ON "PettyCashAccount"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_name_key" ON "ExpenseCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PettyCashTransaction_number_key" ON "PettyCashTransaction"("number");

-- CreateIndex
CREATE INDEX "PettyCashTransaction_pettyCashAccountId_date_idx" ON "PettyCashTransaction"("pettyCashAccountId", "date");

-- CreateIndex
CREATE INDEX "PettyCashTransaction_categoryId_idx" ON "PettyCashTransaction"("categoryId");

-- AddForeignKey
ALTER TABLE "PettyCashAccount" ADD CONSTRAINT "PettyCashAccount_custodianId_fkey" FOREIGN KEY ("custodianId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashAccount" ADD CONSTRAINT "PettyCashAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashTransaction" ADD CONSTRAINT "PettyCashTransaction_pettyCashAccountId_fkey" FOREIGN KEY ("pettyCashAccountId") REFERENCES "PettyCashAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashTransaction" ADD CONSTRAINT "PettyCashTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashTransaction" ADD CONSTRAINT "PettyCashTransaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashTransaction" ADD CONSTRAINT "PettyCashTransaction_taxCodeId_fkey" FOREIGN KEY ("taxCodeId") REFERENCES "TaxCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data: the existing "Petty Cash" GL account becomes the first petty cash box, and default expense
-- categories are mapped to existing expense accounts. Does nothing on an empty database (the seed creates them).
INSERT INTO "PettyCashAccount" ("id", "code", "name", "accountId", "active", "createdAt", "updatedAt")
SELECT 'petty_main', 'PETTY-01', 'Main petty cash', "id", true, NOW(), NOW()
FROM "Account" WHERE "systemKey" = 'PETTY_CASH'
ON CONFLICT DO NOTHING;

INSERT INTO "ExpenseCategory" ("id", "name", "accountId", "active", "createdAt", "updatedAt")
SELECT 'expcat_' || lower(c.key), c.name, a."id", true, NOW(), NOW()
FROM (VALUES
  ('GENERAL_EXPENSE', 'General & office'),
  ('DELIVERY_EXPENSE', 'Local delivery & transport'),
  ('UTILITIES', 'Utilities'),
  ('BANK_CHARGES', 'Bank charges')
) AS c(key, name)
JOIN "Account" a ON a."systemKey" = c.key
ON CONFLICT DO NOTHING;
