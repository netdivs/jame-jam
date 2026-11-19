-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('LOGO', 'STAMP', 'PETTY_RECEIPT');

-- AlterTable
ALTER TABLE "CompanySetting" ADD COLUMN     "logoFileId" TEXT,
ADD COLUMN     "stampFileId" TEXT;

-- AlterTable
ALTER TABLE "PettyCashTransaction" ADD COLUMN     "attachmentFileId" TEXT;

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "kind" "FileKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoredFile_kind_idx" ON "StoredFile"("kind");
