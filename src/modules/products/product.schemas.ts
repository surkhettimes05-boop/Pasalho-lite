import { z } from "zod";

const moneyString = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,2})?$/, "Enter a valid amount with up to 2 decimals.");

const quantityString = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,3})?$/, "Enter a valid quantity with up to 3 decimals.");

export const productInputSchema = z.object({
  sku: z.string().trim().min(1).max(80).transform((value) => value.toUpperCase()),
  barcode: z
    .string()
    .trim()
    .max(80)
    .transform((value) => (value.length === 0 ? null : value)),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(40),
  costPrice: moneyString,
  sellingPrice: moneyString,
  mrp: z
    .string()
    .trim()
    .transform((value) => (value.length === 0 ? null : value))
    .pipe(moneyString.nullable()),
  warehouseMinStock: quantityString,
  storeMinStock: quantityString,
  active: z.boolean().default(true),
});

export type ProductInput = z.infer<typeof productInputSchema>;
