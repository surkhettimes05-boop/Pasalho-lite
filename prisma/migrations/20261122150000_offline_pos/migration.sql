CREATE TABLE "OfflineTerminal" (
  "id" TEXT NOT NULL,
  "storeLocationId" TEXT NOT NULL,
  "cashierUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT NOT NULL,
  "publicKey" JSONB NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfflineTerminal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfflineSnapshot" (
  "id" TEXT NOT NULL,
  "terminalId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfflineSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OfflineSubmission" (
  "transactionId" UUID NOT NULL,
  "terminalId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "reason" TEXT,
  "saleId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfflineSubmission_pkey" PRIMARY KEY ("transactionId")
);

CREATE INDEX "OfflineTerminal_cashierUserId_revokedAt_idx" ON "OfflineTerminal"("cashierUserId", "revokedAt");
CREATE INDEX "OfflineSnapshot_terminalId_createdAt_idx" ON "OfflineSnapshot"("terminalId", "createdAt");
CREATE INDEX "OfflineSubmission_status_createdAt_idx" ON "OfflineSubmission"("status", "createdAt");
CREATE UNIQUE INDEX "OfflineSubmission_saleId_key" ON "OfflineSubmission"("saleId");
ALTER TABLE "OfflineTerminal" ADD CONSTRAINT "OfflineTerminal_storeLocationId_fkey" FOREIGN KEY ("storeLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfflineTerminal" ADD CONSTRAINT "OfflineTerminal_cashierUserId_fkey" FOREIGN KEY ("cashierUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfflineTerminal" ADD CONSTRAINT "OfflineTerminal_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfflineSnapshot" ADD CONSTRAINT "OfflineSnapshot_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "OfflineTerminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfflineSubmission" ADD CONSTRAINT "OfflineSubmission_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "OfflineTerminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfflineSubmission" ADD CONSTRAINT "OfflineSubmission_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "OfflineSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfflineSubmission" ADD CONSTRAINT "OfflineSubmission_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
