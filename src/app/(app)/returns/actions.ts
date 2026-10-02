"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { ReturnSourceType } from "@/generated/prisma/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { BusinessError } from "@/lib/business-error";
import { processReturn } from "@/modules/returns/return.service";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "");
}

function operationError(error: unknown) {
  if (error instanceof BusinessError) return error.code;
  if (error instanceof ZodError) return "INVALID_RETURN_INPUT";
  return "RETURN_OPERATION_FAILED";
}

export async function processReturnAction(formData: FormData) {
  const user = await requireCurrentUser();
  const sourceType = value(formData, "sourceType");

  if (
    sourceType !== ReturnSourceType.SALE &&
    sourceType !== ReturnSourceType.CUSTOMER_ORDER
  ) {
    redirect("/returns?error=INVALID_RETURN_INPUT");
  }

  const sourceId = value(formData, "sourceId");
  const lineCount = Number(value(formData, "lineCount"));

  if (!Number.isInteger(lineCount) || lineCount < 1 || lineCount > 100) {
    redirect(
      `/returns/new?sourceType=${sourceType}&sourceId=${sourceId}&error=INVALID_RETURN_INPUT`,
    );
  }

  const items = Array.from({ length: lineCount }, (_, index) => ({
    originalLineId: value(formData, `originalLineId_${index}`),
    quantity: value(formData, `quantity_${index}`) || "0",
    physicallyReturned:
      value(formData, `physicallyReturned_${index}`) === "on",
    restockQuantity: value(formData, `restockQuantity_${index}`) || "0",
  })).filter((item) => Number(item.quantity) > 0);

  let returnId: string;

  try {
    const result = await processReturn(user, {
      sourceType,
      sourceId,
      reason: value(formData, "reason"),
      idempotencyKey: value(formData, "idempotencyKey"),
      items,
    });

    returnId = result.id;
  } catch (error) {
    const code = encodeURIComponent(operationError(error));
    redirect(
      `/returns/new?sourceType=${sourceType}&sourceId=${sourceId}&error=${code}`,
    );
  }

  revalidatePath("/returns");
  revalidatePath("/inventory");
  revalidatePath("/inventory/movements");
  revalidatePath("/pos");
  revalidatePath("/orders");
  revalidatePath("/customers");
  revalidatePath(
    sourceType === ReturnSourceType.SALE
      ? `/pos/${sourceId}`
      : `/orders/${sourceId}`,
  );

  redirect(`/returns/${returnId}?success=completed`);
}
