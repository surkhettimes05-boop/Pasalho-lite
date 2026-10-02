import { z } from "zod";

const quantityString = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,3})?$/, "Enter a valid quantity with up to 3 decimals.")
  .refine((value) => Number(value) > 0, "Quantity must be greater than zero.");

const moneyString = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,2})?$/, "Enter a valid cost with up to 2 decimals.");

const receiptItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: quantityString,
  unitCost: moneyString,
});

export const postReceiptInputSchema = z
  .object({
    supplierId: z.string().uuid(),
    supplierReference: z
      .string()
      .trim()
      .max(120)
      .transform((value) => (value.length === 0 ? null : value)),
    notes: z
      .string()
      .trim()
      .max(500)
      .transform((value) => (value.length === 0 ? null : value)),
    idempotencyKey: z.string().trim().min(8).max(200),
    items: z.array(receiptItemSchema).min(1).max(100),
  })
  .superRefine((value, context) => {
    const productIds = value.items.map((item) => item.productId);

    if (new Set(productIds).size !== productIds.length) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Each product may appear only once on a receipt.",
      });
    }
  });

export type PostReceiptInput = z.infer<typeof postReceiptInputSchema>;
