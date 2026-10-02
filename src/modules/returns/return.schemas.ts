import { z } from "zod";
import { ReturnSourceType } from "@/generated/prisma/client";

const quantityString = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,3})?$/, "Enter a valid quantity with up to 3 decimals.")
  .refine((value) => Number(value) > 0, "Return quantity must be greater than zero.");

const nonNegativeQuantityString = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,3})?$/, "Enter a valid quantity with up to 3 decimals.")
  .refine((value) => Number(value) >= 0, "Restock quantity cannot be negative.");

const returnItemInputSchema = z
  .object({
    originalLineId: z.string().uuid(),
    quantity: quantityString,
    physicallyReturned: z.boolean(),
    restockQuantity: nonNegativeQuantityString,
  })
  .superRefine((value, context) => {
    if (Number(value.restockQuantity) > Number(value.quantity)) {
      context.addIssue({
        code: "custom",
        path: ["restockQuantity"],
        message: "Restock quantity cannot exceed return quantity.",
      });
    }

    if (!value.physicallyReturned && Number(value.restockQuantity) > 0) {
      context.addIssue({
        code: "custom",
        path: ["restockQuantity"],
        message: "Goods must be physically returned before they can be restocked.",
      });
    }
  });

export const processReturnInputSchema = z
  .object({
    sourceType: z.enum([
      ReturnSourceType.SALE,
      ReturnSourceType.CUSTOMER_ORDER,
    ]),
    sourceId: z.string().uuid(),
    reason: z.string().trim().min(3).max(500),
    idempotencyKey: z.string().trim().min(8).max(200),
    items: z.array(returnItemInputSchema).min(1).max(100),
  })
  .superRefine((value, context) => {
    const lineIds = value.items.map((item) => item.originalLineId);

    if (new Set(lineIds).size !== lineIds.length) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Each original line may appear only once in a return.",
      });
    }
  });

export type ProcessReturnInput = z.infer<typeof processReturnInputSchema>;
