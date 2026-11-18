ALTER TABLE "CustomerOrder"
  ADD COLUMN "pricingQuoteId" TEXT,
  ADD COLUMN "pricingQuoteSnapshot" JSONB;

CREATE UNIQUE INDEX "CustomerOrder_pricingQuoteId_key"
  ON "CustomerOrder"("pricingQuoteId");

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
     OR NEW."pricingQuoteId" IS DISTINCT FROM OLD."pricingQuoteId"
     OR NEW."pricingQuoteSnapshot" IS DISTINCT FROM OLD."pricingQuoteSnapshot"
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
