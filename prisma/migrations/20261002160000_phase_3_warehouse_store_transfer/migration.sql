-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('DRAFT', 'READY', 'DISPATCHED', 'RECEIVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "transferNumber" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'DRAFT',
    "dispatchedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "dispatchedByUserId" TEXT,
    "receivedByUserId" TEXT,
    "notes" TEXT,
    "dispatchIdempotencyKey" TEXT,
    "receiveIdempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Transfer_different_locations" CHECK ("fromLocationId" <> "toLocationId"),
    CONSTRAINT "Transfer_state_fields" CHECK (
      (
        "status" IN ('DRAFT', 'READY', 'CANCELLED')
        AND "dispatchedAt" IS NULL
        AND "dispatchedByUserId" IS NULL
        AND "receivedAt" IS NULL
        AND "receivedByUserId" IS NULL
      )
      OR (
        "status" = 'DISPATCHED'
        AND "dispatchedAt" IS NOT NULL
        AND "dispatchedByUserId" IS NOT NULL
        AND "receivedAt" IS NULL
        AND "receivedByUserId" IS NULL
      )
      OR (
        "status" = 'RECEIVED'
        AND "dispatchedAt" IS NOT NULL
        AND "dispatchedByUserId" IS NOT NULL
        AND "receivedAt" IS NOT NULL
        AND "receivedByUserId" IS NOT NULL
      )
    )
);

-- CreateTable
CREATE TABLE "TransferItem" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "requestedQuantity" DECIMAL(14,3) NOT NULL,
    "dispatchedQuantity" DECIMAL(14,3),
    "receivedQuantity" DECIMAL(14,3),
    "discrepancyReason" TEXT,
    CONSTRAINT "TransferItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TransferItem_requested_positive" CHECK ("requestedQuantity" > 0),
    CONSTRAINT "TransferItem_dispatched_positive" CHECK (
      "dispatchedQuantity" IS NULL OR "dispatchedQuantity" > 0
    ),
    CONSTRAINT "TransferItem_received_valid" CHECK (
      "receivedQuantity" IS NULL
      OR (
        "dispatchedQuantity" IS NOT NULL
        AND "receivedQuantity" >= 0
        AND "receivedQuantity" <= "dispatchedQuantity"
      )
    ),
    CONSTRAINT "TransferItem_discrepancy_reason" CHECK (
      "receivedQuantity" IS NULL
      OR "dispatchedQuantity" IS NULL
      OR "receivedQuantity" = "dispatchedQuantity"
      OR (
        "discrepancyReason" IS NOT NULL
        AND length(trim("discrepancyReason")) >= 3
      )
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_transferNumber_key" ON "Transfer"("transferNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_dispatchIdempotencyKey_key"
ON "Transfer"("dispatchIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_receiveIdempotencyKey_key"
ON "Transfer"("receiveIdempotencyKey");

-- CreateIndex
CREATE INDEX "Transfer_status_createdAt_idx"
ON "Transfer"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Transfer_fromLocationId_createdAt_idx"
ON "Transfer"("fromLocationId", "createdAt");

-- CreateIndex
CREATE INDEX "Transfer_toLocationId_createdAt_idx"
ON "Transfer"("toLocationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TransferItem_transferId_productId_key"
ON "TransferItem"("transferId", "productId");

-- CreateIndex
CREATE INDEX "TransferItem_productId_idx" ON "TransferItem"("productId");

-- AddForeignKey
ALTER TABLE "Transfer"
ADD CONSTRAINT "Transfer_fromLocationId_fkey"
FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer"
ADD CONSTRAINT "Transfer_toLocationId_fkey"
FOREIGN KEY ("toLocationId") REFERENCES "Location"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer"
ADD CONSTRAINT "Transfer_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer"
ADD CONSTRAINT "Transfer_dispatchedByUserId_fkey"
FOREIGN KEY ("dispatchedByUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer"
ADD CONSTRAINT "Transfer_receivedByUserId_fkey"
FOREIGN KEY ("receivedByUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferItem"
ADD CONSTRAINT "TransferItem_transferId_fkey"
FOREIGN KEY ("transferId") REFERENCES "Transfer"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferItem"
ADD CONSTRAINT "TransferItem_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Transfers are historical operating records. Use status transitions, not deletes.
CREATE OR REPLACE FUNCTION "prevent_transfer_delete"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'transfers and transfer items cannot be deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Transfer_no_delete"
BEFORE DELETE ON "Transfer"
FOR EACH ROW EXECUTE FUNCTION "prevent_transfer_delete"();

CREATE TRIGGER "TransferItem_no_delete"
BEFORE DELETE ON "TransferItem"
FOR EACH ROW EXECUTE FUNCTION "prevent_transfer_delete"();

-- Product/requested quantity define the original request and may never be rewritten.
CREATE OR REPLACE FUNCTION "protect_transfer_item_request"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."transferId" <> OLD."transferId"
     OR NEW."productId" <> OLD."productId"
     OR NEW."requestedQuantity" <> OLD."requestedQuantity" THEN
    RAISE EXCEPTION 'transfer request facts are immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TransferItem_protect_request"
BEFORE UPDATE ON "TransferItem"
FOR EACH ROW EXECUTE FUNCTION "protect_transfer_item_request"();
