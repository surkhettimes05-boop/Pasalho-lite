"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { BusinessError } from "@/lib/business-error";
import {
  closeOperatingDay,
  reopenDailyClose,
} from "@/modules/daily-close/daily-close.service";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "");
}

function errorCode(error: unknown) {
  if (error instanceof BusinessError) return error.code;
  if (error instanceof ZodError) return "INVALID_DAILY_CLOSE";
  return "DAILY_CLOSE_FAILED";
}

export async function closeOperatingDayAction(formData: FormData) {
  const user = await requireCurrentUser();
  const operatingDate = value(formData, "operatingDate");
  let closeId: string;

  try {
    const close = await closeOperatingDay(user, {
      operatingDate,
      actualCash: value(formData, "actualCash"),
      notes: value(formData, "notes"),
      idempotencyKey: value(formData, "idempotencyKey"),
    });
    closeId = close.id;
  } catch (error) {
    redirect(
      `/daily-close?date=${operatingDate}&error=${encodeURIComponent(errorCode(error))}`,
    );
  }

  revalidatePath("/daily-close");
  revalidatePath("/cash");
  redirect(`/daily-close/${closeId}?success=closed`);
}

export async function reopenDailyCloseAction(formData: FormData) {
  const user = await requireCurrentUser();
  const closeId = value(formData, "closeId");

  try {
    await reopenDailyClose(user, {
      closeId,
      reason: value(formData, "reason"),
      idempotencyKey: value(formData, "idempotencyKey"),
    });
  } catch (error) {
    redirect(
      `/daily-close/${closeId}?error=${encodeURIComponent(errorCode(error))}`,
    );
  }

  revalidatePath("/daily-close");
  revalidatePath("/cash");
  redirect(`/daily-close/${closeId}?success=reopened`);
}
