import { z } from "zod";

const nonNegativeMoney = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,2})?$/, "Enter a valid amount with up to 2 decimals.")
  .refine((value) => Number(value) >= 0, "Amount cannot be negative.");

export const closeDailyInputSchema = z.object({
  operatingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  actualCash: nonNegativeMoney,
  notes: z
    .string()
    .trim()
    .max(1000)
    .transform((value) => (value.length === 0 ? null : value)),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export const reopenDailyCloseInputSchema = z.object({
  closeId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export type CloseDailyInput = z.infer<typeof closeDailyInputSchema>;
export type ReopenDailyCloseInput = z.infer<
  typeof reopenDailyCloseInputSchema
>;
