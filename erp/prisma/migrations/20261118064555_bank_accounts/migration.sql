-- AlterTable
ALTER TABLE "SupplierPayment" ADD COLUMN     "bankAccountId" TEXT;

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bankName" TEXT,
    "branch" TEXT,
    "accountNo" TEXT,
    "iban" TEXT,
    "swift" TEXT,
    "accountId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_code_key" ON "BankAccount"("code");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_accountId_key" ON "BankAccount"("accountId");

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data: the existing "Bank - Main Account" GL account becomes the default bank account,
-- and earlier bank payments are linked to it. Does nothing on an empty database (the seed creates it).
INSERT INTO "BankAccount" ("id", "code", "name", "accountId", "isDefault", "active", "createdAt", "updatedAt")
SELECT 'bank_main', 'BANK-0001', 'Main account', "id", true, true, NOW(), NOW()
FROM "Account" WHERE "systemKey" = 'BANK_MAIN'
ON CONFLICT DO NOTHING;

UPDATE "SupplierPayment" SET "bankAccountId" = 'bank_main'
WHERE "mode" = 'BANK' AND "bankAccountId" IS NULL AND EXISTS (SELECT 1 FROM "BankAccount" WHERE "id" = 'bank_main');
