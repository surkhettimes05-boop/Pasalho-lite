-- Create a durable POS outbox for creator-attributed purchase events.
-- POS finalization must not depend on the commerce API being available.

CREATE TABLE "CreatorAttributionOutbox" (
  "id" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastErrorCode" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreatorAttributionOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreatorAttributionOutbox_saleId_key"
  ON "CreatorAttributionOutbox"("saleId");
CREATE UNIQUE INDEX "CreatorAttributionOutbox_eventKey_key"
  ON "CreatorAttributionOutbox"("eventKey");
CREATE INDEX "CreatorAttributionOutbox_status_nextAttemptAt_idx"
  ON "CreatorAttributionOutbox"("status", "nextAttemptAt");
