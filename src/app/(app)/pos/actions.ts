"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { PaymentMethod } from "@/generated/prisma/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { BusinessError } from "@/lib/business-error";
import { finalizeSale } from "@/modules/pos/pos.service";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "");
}

function operationError(error: unknown) {
  if (error instanceof BusinessError) {
    return error.code;
  }

  if (error instanceof ZodError) {
    return "INVALID_POS_INPUT";
  }

  return "POS_OPERATION_FAILED";
}

export async function finalizeSaleAction(formData: FormData) {
  const user = await requireCurrentUser();
  const lineCount = Number(value(formData, "lineCount"));

  if (!Number.isInteger(lineCount) || lineCount < 1 || lineCount > 100) {
    redirect("/pos?error=INVALID_POS_INPUT");
  }

  const items = Array.from({ length: lineCount }, (_, index) => ({
    productId: value(formData, `productId_${index}`),
    quantity: value(formData, `quantity_${index}`),
  }));

  const paymentMethod = value(formData, "paymentMethod");

  if (
    paymentMethod !== PaymentMethod.CASH &&
    paymentMethod !== PaymentMethod.QR_NON_CASH
  ) {
    redirect("/pos?error=INVALID_POS_INPUT");
  }

  let saleId: string;

  try {
    const result = await finalizeSale(user, {
      idempotencyKey: value(formData, "idempotencyKey"),
      paymentMethod,
      items,
    });

    saleId = result.sale.id;
  } catch (error) {
    redirect(`/pos?error=${encodeURIComponent(operationError(error))}`);
  }

  revalidatePath("/pos");
  revalidatePath("/inventory");
  revalidatePath("/inventory/movements");
  redirect(`/pos/${saleId}?success=finalized`);
}
