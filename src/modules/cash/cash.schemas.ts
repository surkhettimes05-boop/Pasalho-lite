import { z } from "zod";
import {
  CashMovementEffect,
  CashMovementType,
} from "@/generated/prisma/client";

const moneyString = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,2})?$/, "Enter a valid amount with up to 2 decimals.")
  .refine((value) => Number(value) > 0, "Amount must be greater than zero.");

export const cashMovementInputSchema = z.object({
  operatingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum([
    CashMovementType.OPENING_CASH,
    CashMovementType.CASH_ADDED,
    CashMovementType.EXPENSE,
    CashMovementType.CASH_PAYOUT,
    CashMovementType.OTHER_APPROVED,
  ]),
  effect: z
    .enum([CashMovementEffect.IN, CashMovementEffect.OUT])
    .nullable()
    .optional(),
  amount: moneyString,
  category: z.string().trim().min(2).max(100),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export type CashMovementInput = z.infer<typeof cashMovementInputSchema>;
