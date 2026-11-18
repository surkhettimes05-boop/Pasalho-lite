ALTER TABLE "Sale"
  ADD COLUMN "pricingQuoteId" TEXT,
  ADD COLUMN "pricingRuleVersion" INTEGER,
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'NPR',
  ADD COLUMN "membershipTierSnapshot" TEXT,
  ADD COLUMN "membershipStatusSnapshot" TEXT,
  ADD COLUMN "pricingQuoteSnapshot" JSONB;

CREATE UNIQUE INDEX "Sale_pricingQuoteId_key"
  ON "Sale"("pricingQuoteId");

ALTER TABLE "SaleItem"
  ADD COLUMN "regularUnitPrice" DECIMAL(12, 2),
  ADD COLUMN "appliedUnitPrice" DECIMAL(12, 2),
  ADD COLUMN "pricingQuoteId" TEXT,
  ADD COLUMN "promotionReference" TEXT,
  ADD COLUMN "promotionSnapshot" JSONB,
  ADD COLUMN "currency" TEXT;
