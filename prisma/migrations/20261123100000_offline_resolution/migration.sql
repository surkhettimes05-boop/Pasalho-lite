CREATE TABLE "OfflineResolution" (
  "id" TEXT NOT NULL,
  "transactionId" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "cashAmount" DECIMAL(14,2) NOT NULL,
  "evidence" TEXT NOT NULL,
  "saleId" TEXT,
  "resolvedByUserId" TEXT NOT NULL,
  "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfflineResolution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OfflineResolution_action_check" CHECK ("action" IN ('POST_SALE', 'CASH_REFUNDED')),
  CONSTRAINT "OfflineResolution_cash_check" CHECK ("cashAmount" > 0),
  CONSTRAINT "OfflineResolution_evidence_check" CHECK (length(trim("evidence")) >= 20),
  CONSTRAINT "OfflineResolution_action_sale_check" CHECK (("action" = 'POST_SALE' AND "saleId" IS NOT NULL) OR ("action" = 'CASH_REFUNDED' AND "saleId" IS NULL))
);
CREATE UNIQUE INDEX "OfflineResolution_transactionId_key" ON "OfflineResolution"("transactionId");
CREATE UNIQUE INDEX "OfflineResolution_saleId_key" ON "OfflineResolution"("saleId");
CREATE INDEX "OfflineResolution_action_resolvedAt_idx" ON "OfflineResolution"("action", "resolvedAt");
ALTER TABLE "OfflineResolution" ADD CONSTRAINT "OfflineResolution_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "OfflineSubmission"("transactionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfflineResolution" ADD CONSTRAINT "OfflineResolution_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfflineResolution" ADD CONSTRAINT "OfflineResolution_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER "OfflineResolution_immutable" BEFORE UPDATE OR DELETE ON "OfflineResolution" FOR EACH ROW EXECUTE FUNCTION "prevent_offline_history_mutation"();
