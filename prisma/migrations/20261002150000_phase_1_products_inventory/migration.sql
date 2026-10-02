-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM (
    'PURCHASE_RECEIPT',
    'TRANSFER_OUT',
    'TRANSFER_IN',
    'POS_SALE',
    'COD_DISPATCH',
    'RETURN_IN',
    'ADJUSTMENT_IN',
    'ADJUSTMENT_OUT'
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "costPrice" DECIMAL(12,2) NOT NULL,
    "sellingPrice" DECIMAL(12,2) NOT NULL,
    "mrp" DECIMAL(12,2),
    "warehouseMinStock" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "storeMinStock" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Product_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Product_costPrice_nonnegative" CHECK ("costPrice" >= 0),
    CONSTRAINT "Product_sellingPrice_nonnegative" CHECK ("sellingPrice" >= 0),
    CONSTRAINT "Product_mrp_nonnegative" CHECK ("mrp" IS NULL OR "mrp" >= 0),
    CONSTRAINT "Product_warehouseMinStock_nonnegative" CHECK ("warehouseMinStock" >= 0),
    CONSTRAINT "Product_storeMinStock_nonnegative" CHECK ("storeMinStock" >= 0)
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "onHand" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StockBalance_onHand_nonnegative" CHECK ("onHand" >= 0),
    CONSTRAINT "StockBalance_reserved_nonnegative" CHECK ("reserved" >= 0),
    CONSTRAINT "StockBalance_reserved_lte_onHand" CHECK ("reserved" <= "onHand")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "type" "InventoryMovementType" NOT NULL,
    "quantityDelta" DECIMAL(14,3) NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reason" TEXT,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryMovement_nonzero" CHECK ("quantityDelta" <> 0)
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product"("name");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX "Product_active_idx" ON "Product"("active");

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_productId_locationId_key"
ON "StockBalance"("productId", "locationId");

-- CreateIndex
CREATE INDEX "StockBalance_locationId_idx" ON "StockBalance"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_idempotencyKey_key"
ON "InventoryMovement"("idempotencyKey");

-- CreateIndex
CREATE INDEX "InventoryMovement_productId_locationId_createdAt_idx"
ON "InventoryMovement"("productId", "locationId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_referenceType_referenceId_idx"
ON "InventoryMovement"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "InventoryMovement_actorUserId_idx"
ON "InventoryMovement"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx"
ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- AddForeignKey
ALTER TABLE "StockBalance"
ADD CONSTRAINT "StockBalance_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance"
ADD CONSTRAINT "StockBalance_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement"
ADD CONSTRAINT "InventoryMovement_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement"
ADD CONSTRAINT "InventoryMovement_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement"
ADD CONSTRAINT "InventoryMovement_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog"
ADD CONSTRAINT "AuditLog_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Enforce append-only movement and audit history at the database layer.
CREATE OR REPLACE FUNCTION "prevent_append_only_mutation"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'append-only records cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InventoryMovement_append_only"
BEFORE UPDATE OR DELETE ON "InventoryMovement"
FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();

CREATE TRIGGER "AuditLog_append_only"
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();
