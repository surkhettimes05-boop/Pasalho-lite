"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { BusinessError } from "@/lib/business-error";
import {
  cancelTransfer,
  createTransfer,
  dispatchTransfer,
  markTransferReady,
  receiveTransfer,
} from "@/modules/transfers/transfer.service";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "");
}

function operationError(error: unknown) {
  if (error instanceof BusinessError) {
    return error.code;
  }

  if (error instanceof ZodError) {
    return "INVALID_TRANSFER_INPUT";
  }

  return "TRANSFER_OPERATION_FAILED";
}

function redirectError(transferId: string | null, error: unknown): never {
  const code = encodeURIComponent(operationError(error));
  redirect(transferId ? `/transfers/${transferId}?error=${code}` : `/transfers?error=${code}`);
}

export async function createTransferAction(formData: FormData) {
  const user = await requireCurrentUser();
  const lineCount = Number(value(formData, "lineCount"));

  if (!Number.isInteger(lineCount) || lineCount < 1 || lineCount > 100) {
    redirect("/transfers?error=INVALID_TRANSFER_INPUT");
  }

  const items = Array.from({ length: lineCount }, (_, index) => ({
    productId: value(formData, `productId_${index}`),
    requestedQuantity: value(formData, `quantity_${index}`),
  }));

  let transferId: string;

  try {
    const transfer = await createTransfer(user, {
      notes: value(formData, "notes"),
      items,
    });
    transferId = transfer.id;
  } catch (error) {
    redirectError(null, error);
  }

  revalidatePath("/transfers");
  redirect(`/transfers/${transferId}?success=created`);
}

export async function markTransferReadyAction(formData: FormData) {
  const user = await requireCurrentUser();
  const transferId = value(formData, "transferId");

  try {
    await markTransferReady(user, transferId);
  } catch (error) {
    redirectError(transferId, error);
  }

  revalidatePath("/transfers");
  revalidatePath(`/transfers/${transferId}`);
  redirect(`/transfers/${transferId}?success=ready`);
}

export async function cancelTransferAction(formData: FormData) {
  const user = await requireCurrentUser();
  const transferId = value(formData, "transferId");

  try {
    await cancelTransfer(user, transferId);
  } catch (error) {
    redirectError(transferId, error);
  }

  revalidatePath("/transfers");
  revalidatePath(`/transfers/${transferId}`);
  redirect(`/transfers/${transferId}?success=cancelled`);
}

export async function dispatchTransferAction(formData: FormData) {
  const user = await requireCurrentUser();
  const transferId = value(formData, "transferId");

  try {
    await dispatchTransfer(user, transferId, {
      idempotencyKey: value(formData, "idempotencyKey"),
    });
  } catch (error) {
    redirectError(transferId, error);
  }

  revalidatePath("/transfers");
  revalidatePath(`/transfers/${transferId}`);
  revalidatePath("/inventory");
  revalidatePath("/inventory/movements");
  redirect(`/transfers/${transferId}?success=dispatched`);
}

export async function receiveTransferAction(formData: FormData) {
  const user = await requireCurrentUser();
  const transferId = value(formData, "transferId");
  const lineCount = Number(value(formData, "lineCount"));

  if (!Number.isInteger(lineCount) || lineCount < 1 || lineCount > 100) {
    redirect(`/transfers/${transferId}?error=INVALID_TRANSFER_INPUT`);
  }

  const items = Array.from({ length: lineCount }, (_, index) => ({
    transferItemId: value(formData, `transferItemId_${index}`),
    receivedQuantity: value(formData, `receivedQuantity_${index}`),
    discrepancyReason: value(formData, `discrepancyReason_${index}`),
  }));

  try {
    await receiveTransfer(user, transferId, {
      idempotencyKey: value(formData, "idempotencyKey"),
      items,
    });
  } catch (error) {
    redirectError(transferId, error);
  }

  revalidatePath("/transfers");
  revalidatePath(`/transfers/${transferId}`);
  revalidatePath("/inventory");
  revalidatePath("/inventory/movements");
  redirect(`/transfers/${transferId}?success=received`);
}
