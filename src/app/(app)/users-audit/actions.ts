"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { Role } from "@/generated/prisma/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { AuthorizationError } from "@/lib/auth/authorization";
import { BusinessError } from "@/lib/business-error";
import {
  createStaffUser,
  updateStaffUserAccess,
} from "@/modules/users/user.service";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "");
}

function errorCode(error: unknown) {
  if (error instanceof BusinessError || error instanceof AuthorizationError) {
    return error.code;
  }
  if (error instanceof ZodError) return "INVALID_USER_INPUT";
  return "USER_OPERATION_FAILED";
}

function parseRole(raw: string) {
  if (
    raw !== Role.OWNER_ADMIN &&
    raw !== Role.CASHIER_STORE &&
    raw !== Role.WAREHOUSE_STAFF
  ) {
    throw new BusinessError("INVALID_ROLE", "Invalid staff role.");
  }
  return raw;
}

export async function createStaffUserAction(formData: FormData) {
  const actor = await requireCurrentUser();

  try {
    await createStaffUser(actor, {
      name: value(formData, "name"),
      email: value(formData, "email"),
      password: value(formData, "password"),
      role: parseRole(value(formData, "role")),
    });
  } catch (error) {
    redirect(`/users-audit?error=${encodeURIComponent(errorCode(error))}`);
  }

  revalidatePath("/users-audit");
  redirect("/users-audit?success=created");
}

export async function updateStaffUserAccessAction(formData: FormData) {
  const actor = await requireCurrentUser();

  try {
    await updateStaffUserAccess(actor, {
      userId: value(formData, "userId"),
      role: parseRole(value(formData, "role")),
      active: value(formData, "active") === "true",
    });
  } catch (error) {
    redirect(`/users-audit?error=${encodeURIComponent(errorCode(error))}`);
  }

  revalidatePath("/users-audit");
  redirect("/users-audit?success=updated");
}
