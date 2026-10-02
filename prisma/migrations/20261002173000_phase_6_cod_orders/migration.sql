-- CreateEnum
CREATE TYPE "CustomerOrderStatus" AS ENUM ('NEW', 'CONFIRMED', 'PACKED', 'DISPATCHED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED');

-- CreateEnum
CREATE TYPE "ReservationSourceType" AS ENUM ('CUSTOMER_ORDER');

-- CreateTable
CREATE TABLE "CustomerOrder" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "storeLocationId" TEXT NOT NULL,
    "status" "CustomerOrderStatus" NOT NULL DEFAULT 'NEW',
    "phoneSnapshot" TEXT NOT NULL,
    "addressText" TEXT NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deliveryCharge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'COD',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "packedAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createIdempotencyKey" TEXT NOT NULL,
    "confirmIdempotencyKey" TEXT,
    "packIdempotencyKey" TEXT,
    "dispatchIdempotencyKey" TEXT,
    "deliverIdempotencyKey" TEXT,
    "cancelIdempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerOrder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CustomerOrder_subtotal_nonnegative" CHECK ("subtotal" >= 0),
    CONSTRAINT "CustomerOrder_discount_nonnegative" CHECK ("discountTotal" >= 0),
    CONSTRAINT "CustomerOrder_delivery_nonnegative" CHECK ("deliveryCharge" >= 0),
    CONSTRAINT "CustomerOrder_total_math" CHECK ("total" = "subtotal" - "discountTotal" + "deliveryCharge"),
    CONSTRAINT "CustomerOrder_cod_only" CHECK ("paymentMethod" = 'COD')
);

-- CreateTable
CREATE TABLE "CustomerOrderItem" (
    "id" TEXT NOT NULL,
    "customerOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "skuSnapshot" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    CONSTRAINT "CustomerOrderItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CustomerOrderItem_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "CustomerOrderItem_price_nonnegative" CHECK ("unitPrice" >= 0),
    CONSTRAINT "CustomerOrderItem_discount_nonnegative" CHECK ("discountAmount" >= 0),
    CONSTRAINT "CustomerOrderItem_lineTotal_nonnegative" CHECK ("lineTotal" >= 0)
);

-- CreateTable
CREATE TABLE "InventoryReservation" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sourceType" "ReservationSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryReservation_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "InventoryReservation_status_times" CHECK (
      ("status" = 'ACTIVE' AND "consumedAt" IS NULL AND "releasedAt" IS NULL)
      OR ("status" = 'CONSUMED' AND "consumedAt" IS NOT NULL AND "releasedAt" IS NULL)
      OR ("status" = 'RELEASED' AND "consumedAt" IS NULL AND "releasedAt" IS NOT NULL)
    )
);

-- Indexes
CREATE UNIQUE INDEX "CustomerOrder_orderNumber_key" ON "CustomerOrder"("orderNumber");
CREATE UNIQUE INDEX "CustomerOrder_createIdempotencyKey_key" ON "CustomerOrder"("createIdempotencyKey");
CREATE UNIQUE INDEX "CustomerOrder_confirmIdempotencyKey_key" ON "CustomerOrder"("confirmIdempotencyKey");
CREATE UNIQUE INDEX "CustomerOrder_packIdempotencyKey_key" ON "CustomerOrder"("packIdempotencyKey");
CREATE UNIQUE INDEX "CustomerOrder_dispatchIdempotencyKey_key" ON "CustomerOrder"("dispatchIdempotencyKey");
CREATE UNIQUE INDEX "CustomerOrder_deliverIdempotencyKey_key" ON "CustomerOrder"("deliverIdempotencyKey");
CREATE UNIQUE INDEX "CustomerOrder_cancelIdempotencyKey_key" ON "CustomerOrder"("cancelIdempotencyKey");
CREATE INDEX "CustomerOrder_status_createdAt_idx" ON "CustomerOrder"("status", "createdAt");
CREATE INDEX "CustomerOrder_customerId_createdAt_idx" ON "CustomerOrder"("customerId", "createdAt");
CREATE INDEX "CustomerOrder_storeLocationId_createdAt_idx" ON "CustomerOrder"("storeLocationId", "createdAt");

CREATE UNIQUE INDEX "CustomerOrderItem_customerOrderId_productId_key" ON "CustomerOrderItem"("customerOrderId", "productId");
CREATE INDEX "CustomerOrderItem_productId_idx" ON "CustomerOrderItem"("productId");

CREATE UNIQUE INDEX "InventoryReservation_idempotencyKey_key" ON "InventoryReservation"("idempotencyKey");
CREATE UNIQUE INDEX "InventoryReservation_sourceType_sourceId_productId_key"
ON "InventoryReservation"("sourceType", "sourceId", "productId");
CREATE INDEX "InventoryReservation_productId_locationId_status_idx"
ON "InventoryReservation"("productId", "locationId", "status");
CREATE INDEX "InventoryReservation_sourceType_sourceId_idx"
ON "InventoryReservation"("sourceType", "sourceId");

-- Foreign keys
ALTER TABLE "CustomerOrder"
ADD CONSTRAINT "CustomerOrder_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerOrder"
ADD CONSTRAINT "CustomerOrder_storeLocationId_fkey"
FOREIGN KEY ("storeLocationId") REFERENCES "Location"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerOrder"
ADD CONSTRAINT "CustomerOrder_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerOrderItem"
ADD CONSTRAINT "CustomerOrderItem_customerOrderId_fkey"
FOREIGN KEY ("customerOrderId") REFERENCES "CustomerOrder"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerOrderItem"
ADD CONSTRAINT "CustomerOrderItem_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryReservation"
ADD CONSTRAINT "InventoryReservation_sourceId_fkey"
FOREIGN KEY ("sourceId") REFERENCES "CustomerOrder"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryReservation"
ADD CONSTRAINT "InventoryReservation_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryReservation"
ADD CONSTRAINT "InventoryReservation_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutable order line snapshots.
CREATE TRIGGER "CustomerOrderItem_append_only"
BEFORE UPDATE OR DELETE ON "CustomerOrderItem"
FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();

-- Order commercial facts remain immutable; lifecycle fields may advance.
CREATE OR REPLACE FUNCTION "protect_customer_order_facts"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'customer orders cannot be deleted';
  END IF;

  IF NEW."id" <> OLD."id"
     OR NEW."orderNumber" <> OLD."orderNumber"
     OR NEW."customerId" <> OLD."customerId"
     OR NEW."storeLocationId" <> OLD."storeLocationId"
     OR NEW."phoneSnapshot" <> OLD."phoneSnapshot"
     OR NEW."addressText" <> OLD."addressText"
     OR NEW."subtotal" <> OLD."subtotal"
     OR NEW."discountTotal" <> OLD."discountTotal"
     OR NEW."deliveryCharge" <> OLD."deliveryCharge"
     OR NEW."total" <> OLD."total"
     OR NEW."paymentMethod" <> OLD."paymentMethod"
     OR NEW."notes" IS DISTINCT FROM OLD."notes"
     OR NEW."createdByUserId" <> OLD."createdByUserId"
     OR NEW."createIdempotencyKey" <> OLD."createIdempotencyKey"
     OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'customer order facts are immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CustomerOrder_protect_facts"
BEFORE UPDATE OR DELETE ON "CustomerOrder"
FOR EACH ROW EXECUTE FUNCTION "protect_customer_order_facts"();

-- Reservation quantity/source facts are immutable; only lifecycle status/times advance.
CREATE OR REPLACE FUNCTION "protect_reservation_facts"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'inventory reservations cannot be deleted';
  END IF;

  IF NEW."productId" <> OLD."productId"
     OR NEW."locationId" <> OLD."locationId"
     OR NEW."sourceType" <> OLD."sourceType"
     OR NEW."sourceId" <> OLD."sourceId"
     OR NEW."quantity" <> OLD."quantity"
     OR NEW."idempotencyKey" <> OLD."idempotencyKey"
     OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'inventory reservation facts are immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InventoryReservation_protect_facts"
BEFORE UPDATE OR DELETE ON "InventoryReservation"
FOR EACH ROW EXECUTE FUNCTION "protect_reservation_facts"();

-- COD payments are created PENDING and later collected. Original source/method/
-- amount remain immutable; collectedAt may transition only from NULL to a value.
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
     OR (OLD."collectedAt" IS NOT NULL AND NEW."collectedAt" IS DISTINCT FROM OLD."collectedAt")
     OR NEW."idempotencyKey" <> OLD."idempotencyKey"
     OR NEW."recordedByUserId" <> OLD."recordedByUserId"
     OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'payment facts are immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
