"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { BusinessError } from "@/lib/business-error";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { adjustInventory } from "@/modules/inventory/inventory.service";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "");
}

function errorCode(error: unknown) {
  if (error instanceof BusinessError) {
    return error.code;
  }

  if (error instanceof ZodError) {
    return "INVALID_ADJUSTMENT";
  }

  return "ADJUSTMENT_FAILED";
}

export async function adjustInventoryAction(formData: FormData) {
  const user = await requireCurrentUser();

  try {
    await adjustInventory(user, {
      productId: value(formData, "productId"),
      locationId: value(formData, "locationId"),
      direction: value(formData, "direction") as "IN" | "OUT",
      quantity: value(formData, "quantity"),
      reason: value(formData, "reason"),
      idempotencyKey: value(formData, "idempotencyKey"),
    });
  } catch (error) {
    redirect(`/inventory?error=${encodeURIComponent(errorCode(error))}`);
  }

  revalidatePath("/inventory");
  redirect("/inventory?success=adjusted");
}
