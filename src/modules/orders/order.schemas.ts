import { z } from "zod";

const quantityString = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,3})?$/, "Enter a valid quantity with up to 3 decimals.")
  .refine((value) => Number(value) > 0, "Quantity must be greater than zero.");

const moneyString = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,2})?$/, "Enter a valid amount with up to 2 decimals.")
  .refine((value) => Number(value) >= 0, "Amount cannot be negative.");

const orderItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: quantityString,
});

export const createCustomerOrderInputSchema = z
  .object({
    customerId: z.string().uuid(),
    addressText: z.string().trim().min(3).max(500),
    deliveryCharge: moneyString,
    notes: z
      .string()
      .trim()
      .max(500)
      .transform((value) => (value.length === 0 ? null : value)),
    idempotencyKey: z.string().trim().min(8).max(200),
    items: z.array(orderItemSchema).min(1).max(100),
  })
  .superRefine((value, context) => {
    const ids = value.items.map((item) => item.productId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Each product may appear only once on an order.",
      });
    }
  });

export const orderCommandSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
});

export type CreateCustomerOrderInput = z.infer<
  typeof createCustomerOrderInputSchema
>;
export type OrderCommandInput = z.infer<typeof orderCommandSchema>;
