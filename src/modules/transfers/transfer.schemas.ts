import { z } from "zod";

const positiveQuantity = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,3})?$/, "Enter a valid quantity with up to 3 decimals.")
  .refine((value) => Number(value) > 0, "Quantity must be greater than zero.");

const nonNegativeQuantity = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,3})?$/, "Enter a valid quantity with up to 3 decimals.")
  .refine((value) => Number(value) >= 0, "Quantity cannot be negative.");

const transferItemSchema = z.object({
  productId: z.string().uuid(),
  requestedQuantity: positiveQuantity,
});

export const createTransferInputSchema = z
  .object({
    notes: z
      .string()
      .trim()
      .max(500)
      .transform((value) => (value.length === 0 ? null : value)),
    items: z.array(transferItemSchema).min(1).max(100),
  })
  .superRefine((value, context) => {
    const productIds = value.items.map((item) => item.productId);

    if (new Set(productIds).size !== productIds.length) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Each product may appear only once on a transfer.",
      });
    }
  });

export const dispatchTransferInputSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
});

const receiveLineSchema = z.object({
  transferItemId: z.string().uuid(),
  receivedQuantity: nonNegativeQuantity,
  discrepancyReason: z
    .string()
    .trim()
    .max(500)
    .transform((value) => (value.length === 0 ? null : value)),
});

export const receiveTransferInputSchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(200),
    items: z.array(receiveLineSchema).min(1).max(100),
  })
  .superRefine((value, context) => {
    const ids = value.items.map((item) => item.transferItemId);

    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Each transfer item may be received only once.",
      });
    }
  });

export type CreateTransferInput = z.infer<typeof createTransferInputSchema>;
export type DispatchTransferInput = z.infer<typeof dispatchTransferInputSchema>;
export type ReceiveTransferInput = z.infer<typeof receiveTransferInputSchema>;
