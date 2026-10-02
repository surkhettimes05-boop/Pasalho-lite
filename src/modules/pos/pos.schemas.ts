import { z } from "zod";
import { PaymentMethod } from "@/generated/prisma/client";

const quantityString = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,3})?$/, "Enter a valid quantity with up to 3 decimals.")
  .refine((value) => Number(value) > 0, "Quantity must be greater than zero.");

const saleItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: quantityString,
});

export const finalizeSaleInputSchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(200),
    paymentMethod: z.enum([
      PaymentMethod.CASH,
      PaymentMethod.QR_NON_CASH,
    ]),
    customerId: z.string().uuid().nullable(),
    items: z.array(saleItemSchema).min(1).max(100),
  })
  .superRefine((value, context) => {
    const productIds = value.items.map((item) => item.productId);

    if (new Set(productIds).size !== productIds.length) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Each product may appear only once in the POS cart.",
      });
    }
  });

export type FinalizeSaleInput = z.infer<typeof finalizeSaleInputSchema>;
