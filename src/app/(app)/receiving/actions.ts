"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { BusinessError } from "@/lib/business-error";
import { postPurchaseReceipt } from "@/modules/receiving/receipt.service";
import { createSupplier } from "@/modules/receiving/supplier.service";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "");
}

function operationError(error: unknown) {
  if (error instanceof BusinessError) {
    return error.code;
  }

  if (error instanceof ZodError) {
    return "INVALID_RECEIVING_INPUT";
  }

  return "RECEIVING_OPERATION_FAILED";
}

export async function createSupplierAction(formData: FormData) {
  const user = await requireCurrentUser();

  try {
    await createSupplier(user, {
      name: value(formData, "name"),
      phone: value(formData, "phone"),
      notes: value(formData, "notes"),
    });
  } catch (error) {
    redirect(
      `/receiving?error=${encodeURIComponent(operationError(error))}`,
    );
  }

  revalidatePath("/receiving");
  redirect("/receiving?success=supplier");
}

export async function postReceiptAction(formData: FormData) {
  const user = await requireCurrentUser();
  const lineCount = Number(value(formData, "lineCount"));

  if (!Number.isInteger(lineCount) || lineCount < 1 || lineCount > 100) {
    redirect("/receiving?error=INVALID_RECEIVING_INPUT");
  }

  const items = Array.from({ length: lineCount }, (_, index) => ({
    productId: value(formData, `productId_${index}`),
    quantity: value(formData, `quantity_${index}`),
    unitCost: value(formData, `unitCost_${index}`),
  }));

  let receiptId: string;

  try {
    const receipt = await postPurchaseReceipt(user, {
      supplierId: value(formData, "supplierId"),
      supplierReference: value(formData, "supplierReference"),
      notes: value(formData, "notes"),
      idempotencyKey: value(formData, "idempotencyKey"),
      items,
    });

    receiptId = receipt.id;
  } catch (error) {
    redirect(
      `/receiving?error=${encodeURIComponent(operationError(error))}`,
    );
  }

  revalidatePath("/receiving");
  revalidatePath("/inventory");
  revalidatePath("/inventory/movements");
  redirect(`/receiving/${receiptId}?success=posted`);
}
