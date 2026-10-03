CREATE TABLE "ProductImportBatch" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "createdCount" INTEGER NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductImportBatch_idempotencyKey_key"
ON "ProductImportBatch"("idempotencyKey");

CREATE INDEX "ProductImportBatch_createdByUserId_createdAt_idx"
ON "ProductImportBatch"("createdByUserId", "createdAt");

ALTER TABLE "ProductImportBatch"
ADD CONSTRAINT "ProductImportBatch_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
