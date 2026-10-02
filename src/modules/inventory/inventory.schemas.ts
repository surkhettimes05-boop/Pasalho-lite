import { z } from "zod";

export const adjustmentInputSchema = z.object({
  productId: z.string().uuid(),
  locationId: z.string().uuid(),
  direction: z.enum(["IN", "OUT"]),
  quantity: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,3})?$/, "Enter a valid quantity.")
    .refine((value) => Number(value) > 0, "Quantity must be greater than zero."),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export type AdjustmentInput = z.infer<typeof adjustmentInputSchema>;
