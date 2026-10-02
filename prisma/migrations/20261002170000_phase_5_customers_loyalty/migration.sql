-- CreateEnum
CREATE TYPE "LoyaltyTransactionType" AS ENUM ('EARN', 'REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LoyaltySourceType" AS ENUM ('SALE', 'CUSTOMER_ORDER', 'MANUAL');

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "phoneDisplay" TEXT NOT NULL,
    "name" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyAccount" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "pointBalance" INTEGER NOT NULL DEFAULT 0,
    "spendRemainder" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LoyaltyAccount_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LoyaltyAccount_pointBalance_nonnegative" CHECK ("pointBalance" >= 0),
    CONSTRAINT "LoyaltyAccount_remainder_range" CHECK (
      "spendRemainder" >= 0 AND "spendRemainder" < 500
    )
);

-- CreateTable
CREATE TABLE "LoyaltyTransaction" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "LoyaltyTransactionType" NOT NULL,
    "pointsDelta" INTEGER NOT NULL,
    "eligibleSpendDelta" DECIMAL(14,2) NOT NULL,
    "sourceType" "LoyaltySourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reason" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phoneNormalized_key"
ON "Customer"("phoneNormalized");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE INDEX "Customer_active_idx" ON "Customer"("active");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyAccount_customerId_key"
ON "LoyaltyAccount"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyTransaction_idempotencyKey_key"
ON "LoyaltyTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_customerId_createdAt_idx"
ON "LoyaltyTransaction"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_sourceType_sourceId_idx"
ON "LoyaltyTransaction"("sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "LoyaltyAccount"
ADD CONSTRAINT "LoyaltyAccount_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction"
ADD CONSTRAINT "LoyaltyTransaction_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction"
ADD CONSTRAINT "LoyaltyTransaction_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Loyalty history is append-only. Reversals are new transactions.
CREATE TRIGGER "LoyaltyTransaction_append_only"
BEFORE UPDATE OR DELETE ON "LoyaltyTransaction"
FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();

-- Customer phone identity is stable after creation. Display/name/notes/active may
-- be updated later, but normalized identity cannot be silently reassigned.
CREATE OR REPLACE FUNCTION "protect_customer_identity"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."phoneNormalized" <> OLD."phoneNormalized" THEN
    RAISE EXCEPTION 'customer normalized phone is immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Customer_protect_identity"
BEFORE UPDATE ON "Customer"
FOR EACH ROW EXECUTE FUNCTION "protect_customer_identity"();
