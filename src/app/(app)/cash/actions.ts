"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import {
  CashMovementEffect,
  CashMovementType,
} from "@/generated/prisma/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { BusinessError } from "@/lib/business-error";
import { recordCashMovement } from "@/modules/cash/cash.service";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "");
}

function errorCode(error: unknown) {
  if (error instanceof BusinessError) return error.code;
  if (error instanceof ZodError) return "INVALID_CASH_MOVEMENT";
  return "CASH_MOVEMENT_FAILED";
}

export async function recordCashMovementAction(formData: FormData) {
  const user = await requireCurrentUser();
  const operatingDate = value(formData, "operatingDate");
  const typeValue = value(formData, "type");
  const effectValue = value(formData, "effect");

  const manualTypes = new Set<string>([
    CashMovementType.OPENING_CASH,
    CashMovementType.CASH_ADDED,
    CashMovementType.EXPENSE,
    CashMovementType.CASH_PAYOUT,
    CashMovementType.OTHER_APPROVED,
  ]);

  if (!manualTypes.has(typeValue)) {
    redirect(`/cash?date=${operatingDate}&error=INVALID_CASH_MOVEMENT`);
  }

  let movementId: string;

  try {
    const movement = await recordCashMovement(user, {
      operatingDate,
      type: typeValue as
        | typeof CashMovementType.OPENING_CASH
        | typeof CashMovementType.CASH_ADDED
        | typeof CashMovementType.EXPENSE
        | typeof CashMovementType.CASH_PAYOUT
        | typeof CashMovementType.OTHER_APPROVED,
      effect:
        effectValue === CashMovementEffect.IN ||
        effectValue === CashMovementEffect.OUT
          ? effectValue
          : null,
      amount: value(formData, "amount"),
      category: value(formData, "category"),
      reason: value(formData, "reason"),
      idempotencyKey: value(formData, "idempotencyKey"),
    });
    movementId = movement.id;
  } catch (error) {
    redirect(
      `/cash?date=${operatingDate}&error=${encodeURIComponent(errorCode(error))}`,
    );
  }

  revalidatePath("/cash");
  revalidatePath("/daily-close");
  redirect(
    `/cash?date=${operatingDate}&success=recorded&movement=${movementId}`,
  );
}
