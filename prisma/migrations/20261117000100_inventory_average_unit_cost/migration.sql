-- Persist moving-average unit cost by location and the cost transferred between locations.
-- NULL means cost evidence is incomplete; do not fall back to catalog costPrice.

ALTER TABLE "StockBalance"
  ADD COLUMN "averageUnitCost" DECIMAL(12,2);

ALTER TABLE "TransferItem"
  ADD COLUMN "unitCostSnapshot" DECIMAL(12,2);

ALTER TABLE "StockBalance"
  ADD CONSTRAINT "StockBalance_averageUnitCost_nonnegative"
  CHECK ("averageUnitCost" IS NULL OR "averageUnitCost" >= 0);

ALTER TABLE "TransferItem"
  ADD CONSTRAINT "TransferItem_unitCostSnapshot_nonnegative"
  CHECK ("unitCostSnapshot" IS NULL OR "unitCostSnapshot" >= 0);
