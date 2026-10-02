-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('FINALIZED', 'PARTIALLY_RETURNED', 'RETURNED');

-- CreateEnum
CREATE TYPE "PaymentSourceType" AS ENUM ('SALE', 'CUSTOMER_ORDER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'QR_NON_CASH', 'COD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "storeLocationId" TEXT NOT NULL,
    "customerId" TEXT,
    "status" "SaleStatus" NOT NULL DEFAULT 'FINALIZED',
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PAID',
    "finalizedAt" TIMESTAMP(3) NOT NULL,
    "finalizedByUserId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Sale_subtotal_nonnegative" CHECK ("subtotal" >= 0),
    CONSTRAINT "Sale_discount_nonnegative" CHECK ("discountTotal" >= 0),
    CONSTRAINT "Sale_total_nonnegative" CHECK ("total" >= 0),
    CONSTRAINT "Sale_total_math" CHECK ("total" = "subtotal" - "discountTotal")
);

-- CreateTable
CREATE TABLE "SaleItem" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "skuSnapshot" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "unitCostSnapshot" DECIMAL(12,2),
    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SaleItem_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "SaleItem_unitPrice_nonnegative" CHECK ("unitPrice" >= 0),
    CONSTRAINT "SaleItem_discount_nonnegative" CHECK ("discountAmount" >= 0),
    CONSTRAINT "SaleItem_lineTotal_nonnegative" CHECK ("lineTotal" >= 0)
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "sourceType" "PaymentSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "collectedAt" TIMESTAMP(3),
    "refundedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Payment_amount_nonnegative" CHECK ("amount" >= 0),
    CONSTRAINT "Payment_refunded_nonnegative" CHECK ("refundedAmount" >= 0),
    CONSTRAINT "Payment_refunded_lte_amount" CHECK ("refundedAmount" <= "amount"),
    CONSTRAINT "Payment_paid_collected" CHECK (
      "status" <> 'PAID' OR "collectedAt" IS NOT NULL
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "Sale_receiptNumber_key" ON "Sale"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_idempotencyKey_key" ON "Sale"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Sale_storeLocationId_finalizedAt_idx"
ON "Sale"("storeLocationId", "finalizedAt");

-- CreateIndex
CREATE INDEX "Sale_finalizedByUserId_finalizedAt_idx"
ON "Sale"("finalizedByUserId", "finalizedAt");

-- CreateIndex
CREATE INDEX "Sale_customerId_finalizedAt_idx"
ON "Sale"("customerId", "finalizedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SaleItem_saleId_productId_key"
ON "SaleItem"("saleId", "productId");

-- CreateIndex
CREATE INDEX "SaleItem_productId_idx" ON "SaleItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key"
ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_sourceType_sourceId_key"
ON "Payment"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx"
ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_method_createdAt_idx"
ON "Payment"("method", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_recordedByUserId_createdAt_idx"
ON "Payment"("recordedByUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_storeLocationId_fkey"
FOREIGN KEY ("storeLocationId") REFERENCES "Location"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_finalizedByUserId_fkey"
FOREIGN KEY ("finalizedByUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem"
ADD CONSTRAINT "SaleItem_saleId_fkey"
FOREIGN KEY ("saleId") REFERENCES "Sale"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem"
ADD CONSTRAINT "SaleItem_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_recordedByUserId_fkey"
FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sale lines are immutable receipt evidence.
CREATE TRIGGER "SaleItem_append_only"
BEFORE UPDATE OR DELETE ON "SaleItem"
FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();

-- Finalized commercial facts must never be rewritten. Future returns may update
-- status/paymentStatus only while keeping the original receipt intact.
CREATE OR REPLACE FUNCTION "protect_sale_facts"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sales cannot be deleted';
  END IF;

  IF NEW."id" <> OLD."id"
     OR NEW."receiptNumber" <> OLD."receiptNumber"
     OR NEW."storeLocationId" <> OLD."storeLocationId"
     OR NEW."customerId" IS DISTINCT FROM OLD."customerId"
     OR NEW."subtotal" <> OLD."subtotal"
     OR NEW."discountTotal" <> OLD."discountTotal"
     OR NEW."total" <> OLD."total"
     OR NEW."finalizedAt" <> OLD."finalizedAt"
     OR NEW."finalizedByUserId" <> OLD."finalizedByUserId"
     OR NEW."idempotencyKey" <> OLD."idempotencyKey"
     OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'finalized sale facts are immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Sale_protect_facts"
BEFORE UPDATE OR DELETE ON "Sale"
FOR EACH ROW EXECUTE FUNCTION "protect_sale_facts"();

-- Payment source, method and collected amount are immutable evidence. Refund
-- phases may update status/refundedAmount later.
CREATE OR REPLACE FUNCTION "protect_payment_facts"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments cannot be deleted';
  END IF;

  IF NEW."id" <> OLD."id"
     OR NEW."sourceType" <> OLD."sourceType"
     OR NEW."sourceId" <> OLD."sourceId"
     OR NEW."method" <> OLD."method"
     OR NEW."amount" <> OLD."amount"
     OR NEW."collectedAt" IS DISTINCT FROM OLD."collectedAt"
     OR NEW."idempotencyKey" <> OLD."idempotencyKey"
     OR NEW."recordedByUserId" <> OLD."recordedByUserId"
     OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'payment facts are immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Payment_protect_facts"
BEFORE UPDATE OR DELETE ON "Payment"
FOR EACH ROW EXECUTE FUNCTION "protect_payment_facts"();
