-- CreateEnum
CREATE TYPE "PurchaseReceiptStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReceipt" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierReference" TEXT,
    "status" "PurchaseReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "postedAt" TIMESTAMP(3),
    "postedByUserId" TEXT,
    "notes" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseReceipt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PurchaseReceipt_posted_fields" CHECK (
      ("status" = 'DRAFT' AND "postedAt" IS NULL AND "postedByUserId" IS NULL)
      OR ("status" IN ('POSTED', 'REVERSED') AND "postedAt" IS NOT NULL AND "postedByUserId" IS NOT NULL)
    )
);

-- CreateTable
CREATE TABLE "PurchaseReceiptItem" (
    "id" TEXT NOT NULL,
    "purchaseReceiptId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    CONSTRAINT "PurchaseReceiptItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PurchaseReceiptItem_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "PurchaseReceiptItem_unitCost_nonnegative" CHECK ("unitCost" >= 0),
    CONSTRAINT "PurchaseReceiptItem_lineTotal_nonnegative" CHECK ("lineTotal" >= 0)
);

-- CreateIndex
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");

-- CreateIndex
CREATE INDEX "Supplier_active_idx" ON "Supplier"("active");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceipt_receiptNumber_key" ON "PurchaseReceipt"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceipt_idempotencyKey_key" ON "PurchaseReceipt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PurchaseReceipt_status_receivedAt_idx" ON "PurchaseReceipt"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "PurchaseReceipt_supplierId_receivedAt_idx" ON "PurchaseReceipt"("supplierId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceiptItem_purchaseReceiptId_productId_key"
ON "PurchaseReceiptItem"("purchaseReceiptId", "productId");

-- CreateIndex
CREATE INDEX "PurchaseReceiptItem_productId_idx" ON "PurchaseReceiptItem"("productId");

-- AddForeignKey
ALTER TABLE "PurchaseReceipt"
ADD CONSTRAINT "PurchaseReceipt_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceipt"
ADD CONSTRAINT "PurchaseReceipt_postedByUserId_fkey"
FOREIGN KEY ("postedByUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptItem"
ADD CONSTRAINT "PurchaseReceiptItem_purchaseReceiptId_fkey"
FOREIGN KEY ("purchaseReceiptId") REFERENCES "PurchaseReceipt"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptItem"
ADD CONSTRAINT "PurchaseReceiptItem_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Receipt lines are historical receiving evidence and are append-only.
CREATE TRIGGER "PurchaseReceiptItem_append_only"
BEFORE UPDATE OR DELETE ON "PurchaseReceiptItem"
FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();

-- Posted receipts cannot be edited or deleted. A future explicit reversal flow
-- may transition POSTED -> REVERSED while keeping all receipt facts unchanged.
CREATE OR REPLACE FUNCTION "protect_posted_purchase_receipt"()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD."status" IN ('POSTED', 'REVERSED') THEN
        RAISE EXCEPTION 'posted purchase receipts cannot be deleted';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD."status" IN ('POSTED', 'REVERSED') THEN
        IF NOT (
          OLD."status" = 'POSTED'
          AND NEW."status" = 'REVERSED'
          AND NEW."id" = OLD."id"
          AND NEW."receiptNumber" = OLD."receiptNumber"
          AND NEW."supplierId" IS NOT DISTINCT FROM OLD."supplierId"
          AND NEW."supplierReference" IS NOT DISTINCT FROM OLD."supplierReference"
          AND NEW."receivedAt" = OLD."receivedAt"
          AND NEW."postedAt" = OLD."postedAt"
          AND NEW."postedByUserId" = OLD."postedByUserId"
          AND NEW."notes" IS NOT DISTINCT FROM OLD."notes"
          AND NEW."idempotencyKey" = OLD."idempotencyKey"
          AND NEW."createdAt" = OLD."createdAt"
        ) THEN
          RAISE EXCEPTION 'posted purchase receipt facts are immutable';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;

    RETURN NEW;
END;
$ LANGUAGE plpgsql;

CREATE TRIGGER "PurchaseReceipt_protect_posted"
BEFORE UPDATE OR DELETE ON "PurchaseReceipt"
FOR EACH ROW EXECUTE FUNCTION "protect_posted_purchase_receipt"();
