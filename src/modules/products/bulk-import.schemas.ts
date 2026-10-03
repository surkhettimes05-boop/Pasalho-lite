import { z } from "zod";

export const BULK_HEADERS = [
  "SKU", "Barcode", "Product Name", "Category", "Unit", "Cost Price",
  "Selling Price", "MRP", "Warehouse Minimum", "Store Minimum", "Active",
] as const;

export const bulkRowSchema = z.object({
  sku: z.string(), barcode: z.string(), name: z.string(), category: z.string(),
  unit: z.string(), costPrice: z.string(), sellingPrice: z.string(), mrp: z.string(),
  warehouseMinStock: z.string(), storeMinStock: z.string(), active: z.string(),
});

export type BulkRow = z.infer<typeof bulkRowSchema>;
export type BulkPreviewRow = BulkRow & { rowNumber: number; status: "VALID" | "INVALID"; error?: string };

export function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

export const HEADER_ALIASES: Record<string, string> = Object.fromEntries([
  ["sku", "SKU"], ["barcode", "Barcode"], ["product name", "Product Name"],
  ["category", "Category"], ["unit", "Unit"], ["cost price", "Cost Price"],
  ["selling price", "Selling Price"], ["mrp", "MRP"],
  ["warehouse minimum", "Warehouse Minimum"], ["store minimum", "Store Minimum"],
  ["active", "Active"],
].map(([key, value]) => [normalizeHeader(key), value]));

export function parseBoolean(value: string) {
  if (!value.trim()) return true;
  if (["true", "1", "yes", "y"].includes(value.trim().toLowerCase())) return true;
  if (["false", "0", "no", "n"].includes(value.trim().toLowerCase())) return false;
  return null;
}
