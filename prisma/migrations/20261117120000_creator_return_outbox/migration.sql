-- Extend the durable creator outbox to carry return/refund reversals.
ALTER TABLE "CreatorAttributionOutbox" ALTER COLUMN "saleId" DROP NOT NULL;
ALTER TABLE "CreatorAttributionOutbox" ADD COLUMN "returnId" TEXT;
CREATE UNIQUE INDEX "CreatorAttributionOutbox_returnId_key"
  ON "CreatorAttributionOutbox"("returnId");
