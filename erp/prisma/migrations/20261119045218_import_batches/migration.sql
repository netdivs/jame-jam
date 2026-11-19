-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "rowsTotal" INTEGER NOT NULL,
    "rowsOk" INTEGER NOT NULL,
    "rowsFailed" INTEGER NOT NULL,
    "errors" JSONB NOT NULL,
    "committed" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportBatch_entity_createdAt_idx" ON "ImportBatch"("entity", "createdAt");
