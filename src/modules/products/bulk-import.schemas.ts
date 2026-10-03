import { z } from "zod";

export const MAX_BULK_PRODUCT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_BULK_PRODUCT_ROWS = 5000;

export const bulkProductCommitSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
});

export type BulkProductPreviewRow = {
  rowNumber: number;
  sku: string;
  barcode: string;
  name: string;
  category: string;
  unit: string;
  costPrice: string;
  sellingPrice: string;
  mrp: string;
  warehouseMinStock: string;
  storeMinStock: string;
  active: boolean;
  errors: string[];
};

export type BulkProductPreview = {
  fileName: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  globalErrors: string[];
  rows: BulkProductPreviewRow[];
};

export type BulkProductImportResult = {
  batchId: string;
  fileName: string;
  rowCount: number;
  createdCount: number;
  replayed: boolean;
};
