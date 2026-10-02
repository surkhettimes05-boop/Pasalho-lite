-- CreateEnum
CREATE TYPE "ReturnSourceType" AS ENUM ('SALE', 'CUSTOMER_ORDER');

-- CreateEnum
CREATE TYPE "ReturnKind" AS ENUM ('REFUND', 'RECOVERY');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('COMPLETED');

-- CreateTable
CREATE TABLE "Return" (
    "id" TEXT NOT NULL,
    "returnNumber" TEXT NOT NULL,
    "sourceType" "ReturnSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "kind" "ReturnKind" NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'COMPLETED',
    "refundAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refundMethod" "PaymentMethod",
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Return_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Return_refund_nonnegative" CHECK ("refundAmount" >= 0),
    CONSTRAINT "Return_reason_required" CHECK (length(trim("reason")) > 0),
    CONSTRAINT "Return_kind_money" CHECK (
      ("kind" = 'RECOVERY' AND "refundAmount" = 0 AND "refundMethod" IS NULL)
      OR ("kind" = 'REFUND' AND "refundAmount" > 0 AND "refundMethod" IS NOT NULL)
    )
);

-- CreateTable
CREATE TABLE "ReturnItem" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "originalLineId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "physicallyReturned" BOOLEAN NOT NULL,
    "restockQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "refundAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    CONSTRAINT "ReturnItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReturnItem_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "ReturnItem_restock_nonnegative" CHECK ("restockQuantity" >= 0),
    CONSTRAINT "ReturnItem_restock_lte_quantity" CHECK ("restockQuantity" <= "quantity"),
    CONSTRAINT "ReturnItem_refund_nonnegative" CHECK ("refundAmount" >= 0),
    CONSTRAINT "ReturnItem_restock_requires_physical" CHECK (
      "physicallyReturned" OR "restockQuantity" = 0
    )
);

-- Indexes
CREATE UNIQUE INDEX "Return_returnNumber_key" ON "Return"("returnNumber");
CREATE UNIQUE INDEX "Return_idempotencyKey_key" ON "Return"("idempotencyKey");
CREATE INDEX "Return_sourceType_sourceId_createdAt_idx"
ON "Return"("sourceType", "sourceId", "createdAt");
CREATE INDEX "Return_completedAt_idx" ON "Return"("completedAt");

CREATE UNIQUE INDEX "ReturnItem_returnId_originalLineId_key"
ON "ReturnItem"("returnId", "originalLineId");
CREATE INDEX "ReturnItem_originalLineId_idx" ON "ReturnItem"("originalLineId");
CREATE INDEX "ReturnItem_productId_idx" ON "ReturnItem"("productId");

-- Foreign keys
ALTER TABLE "Return"
ADD CONSTRAINT "Return_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReturnItem"
ADD CONSTRAINT "ReturnItem_returnId_fkey"
FOREIGN KEY ("returnId") REFERENCES "Return"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReturnItem"
ADD CONSTRAINT "ReturnItem_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Completed returns and their item evidence are append-only.
CREATE TRIGGER "Return_append_only"
BEFORE UPDATE OR DELETE ON "Return"
FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();

CREATE TRIGGER "ReturnItem_append_only"
BEFORE UPDATE OR DELETE ON "ReturnItem"
FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();
