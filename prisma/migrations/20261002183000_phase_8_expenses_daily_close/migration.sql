-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM (
  'OPENING_CASH',
  'CASH_ADDED',
  'EXPENSE',
  'CASH_PAYOUT',
  'REFUND_OUT',
  'OTHER_APPROVED'
);

-- CreateEnum
CREATE TYPE "CashMovementEffect" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "DailyCloseStatus" AS ENUM ('CLOSED', 'REOPENED');

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" TEXT NOT NULL,
    "storeLocationId" TEXT NOT NULL,
    "operatingDate" DATE NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "effect" "CashMovementEffect" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "category" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CashMovement_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "CashMovement_category_required" CHECK (length(trim("category")) > 0),
    CONSTRAINT "CashMovement_reason_required" CHECK (length(trim("reason")) > 0),
    CONSTRAINT "CashMovement_type_effect" CHECK (
      ("type" IN ('OPENING_CASH', 'CASH_ADDED') AND "effect" = 'IN')
      OR ("type" IN ('EXPENSE', 'CASH_PAYOUT', 'REFUND_OUT') AND "effect" = 'OUT')
      OR ("type" = 'OTHER_APPROVED')
    )
);

-- CreateTable
CREATE TABLE "DailyClose" (
    "id" TEXT NOT NULL,
    "storeLocationId" TEXT NOT NULL,
    "operatingDate" DATE NOT NULL,
    "openingCash" DECIMAL(14,2) NOT NULL,
    "cashPosSales" DECIMAL(14,2) NOT NULL,
    "codCashCollected" DECIMAL(14,2) NOT NULL,
    "cashAdded" DECIMAL(14,2) NOT NULL,
    "cashRefunds" DECIMAL(14,2) NOT NULL,
    "cashExpenses" DECIMAL(14,2) NOT NULL,
    "expectedCash" DECIMAL(14,2) NOT NULL,
    "actualCash" DECIMAL(14,2) NOT NULL,
    "variance" DECIMAL(14,2) NOT NULL,
    "qrNonCashSales" DECIMAL(14,2) NOT NULL,
    "pendingCodAmount" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "status" "DailyCloseStatus" NOT NULL DEFAULT 'CLOSED',
    "closeIdempotencyKey" TEXT NOT NULL,
    "closedByUserId" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "reopenIdempotencyKey" TEXT,
    "reopenedByUserId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyClose_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DailyClose_nonnegative_values" CHECK (
      "openingCash" >= 0
      AND "cashPosSales" >= 0
      AND "codCashCollected" >= 0
      AND "cashAdded" >= 0
      AND "cashRefunds" >= 0
      AND "cashExpenses" >= 0
      AND "actualCash" >= 0
      AND "qrNonCashSales" >= 0
      AND "pendingCodAmount" >= 0
    ),
    CONSTRAINT "DailyClose_expected_math" CHECK (
      "expectedCash" = "openingCash" + "cashPosSales" + "codCashCollected"
        + "cashAdded" - "cashRefunds" - "cashExpenses"
    ),
    CONSTRAINT "DailyClose_variance_math" CHECK ("variance" = "actualCash" - "expectedCash"),
    CONSTRAINT "DailyClose_reopen_fields" CHECK (
      ("status" = 'CLOSED' AND "reopenedByUserId" IS NULL AND "reopenedAt" IS NULL AND "reopenIdempotencyKey" IS NULL)
      OR ("status" = 'REOPENED' AND "reopenedByUserId" IS NOT NULL AND "reopenedAt" IS NOT NULL AND "reopenIdempotencyKey" IS NOT NULL)
    )
);

-- Indexes
CREATE UNIQUE INDEX "CashMovement_idempotencyKey_key"
ON "CashMovement"("idempotencyKey");

CREATE INDEX "CashMovement_storeLocationId_operatingDate_type_idx"
ON "CashMovement"("storeLocationId", "operatingDate", "type");

CREATE INDEX "CashMovement_operatingDate_createdAt_idx"
ON "CashMovement"("operatingDate", "createdAt");

CREATE INDEX "CashMovement_referenceType_referenceId_idx"
ON "CashMovement"("referenceType", "referenceId");

CREATE INDEX "CashMovement_userId_createdAt_idx"
ON "CashMovement"("userId", "createdAt");

CREATE UNIQUE INDEX "CashMovement_one_opening_per_day"
ON "CashMovement"("storeLocationId", "operatingDate")
WHERE "type" = 'OPENING_CASH';

CREATE UNIQUE INDEX "DailyClose_closeIdempotencyKey_key"
ON "DailyClose"("closeIdempotencyKey");

CREATE UNIQUE INDEX "DailyClose_reopenIdempotencyKey_key"
ON "DailyClose"("reopenIdempotencyKey");

CREATE INDEX "DailyClose_storeLocationId_operatingDate_status_idx"
ON "DailyClose"("storeLocationId", "operatingDate", "status");

CREATE INDEX "DailyClose_operatingDate_closedAt_idx"
ON "DailyClose"("operatingDate", "closedAt");

CREATE UNIQUE INDEX "DailyClose_one_closed_per_day"
ON "DailyClose"("storeLocationId", "operatingDate")
WHERE "status" = 'CLOSED';

-- Foreign keys
ALTER TABLE "CashMovement"
ADD CONSTRAINT "CashMovement_storeLocationId_fkey"
FOREIGN KEY ("storeLocationId") REFERENCES "Location"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CashMovement"
ADD CONSTRAINT "CashMovement_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DailyClose"
ADD CONSTRAINT "DailyClose_storeLocationId_fkey"
FOREIGN KEY ("storeLocationId") REFERENCES "Location"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DailyClose"
ADD CONSTRAINT "DailyClose_closedByUserId_fkey"
FOREIGN KEY ("closedByUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DailyClose"
ADD CONSTRAINT "DailyClose_reopenedByUserId_fkey"
FOREIGN KEY ("reopenedByUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cash movements are evidence, not editable bookkeeping rows.
CREATE TRIGGER "CashMovement_append_only"
BEFORE UPDATE OR DELETE ON "CashMovement"
FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();

-- A close snapshot may only transition CLOSED -> REOPENED once.
CREATE OR REPLACE FUNCTION "protect_daily_close"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'daily closes cannot be deleted';
  END IF;

  IF OLD."status" = 'REOPENED' THEN
    RAISE EXCEPTION 'reopened daily close history is immutable';
  END IF;

  IF NEW."status" <> 'REOPENED'
     OR NEW."id" <> OLD."id"
     OR NEW."storeLocationId" <> OLD."storeLocationId"
     OR NEW."operatingDate" <> OLD."operatingDate"
     OR NEW."openingCash" <> OLD."openingCash"
     OR NEW."cashPosSales" <> OLD."cashPosSales"
     OR NEW."codCashCollected" <> OLD."codCashCollected"
     OR NEW."cashAdded" <> OLD."cashAdded"
     OR NEW."cashRefunds" <> OLD."cashRefunds"
     OR NEW."cashExpenses" <> OLD."cashExpenses"
     OR NEW."expectedCash" <> OLD."expectedCash"
     OR NEW."actualCash" <> OLD."actualCash"
     OR NEW."variance" <> OLD."variance"
     OR NEW."qrNonCashSales" <> OLD."qrNonCashSales"
     OR NEW."pendingCodAmount" <> OLD."pendingCodAmount"
     OR NEW."notes" IS DISTINCT FROM OLD."notes"
     OR NEW."closeIdempotencyKey" <> OLD."closeIdempotencyKey"
     OR NEW."closedByUserId" <> OLD."closedByUserId"
     OR NEW."closedAt" <> OLD."closedAt"
     OR NEW."createdAt" <> OLD."createdAt"
     OR NEW."reopenIdempotencyKey" IS NULL
     OR NEW."reopenedByUserId" IS NULL
     OR NEW."reopenedAt" IS NULL THEN
    RAISE EXCEPTION 'daily close facts are immutable except controlled reopen';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DailyClose_protect"
BEFORE UPDATE OR DELETE ON "DailyClose"
FOR EACH ROW EXECUTE FUNCTION "protect_daily_close"();
