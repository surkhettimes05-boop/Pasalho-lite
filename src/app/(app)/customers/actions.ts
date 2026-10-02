"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { BusinessError } from "@/lib/business-error";
import { createCustomer } from "@/modules/customers/customer.service";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "");
}

function errorCode(error: unknown) {
  if (error instanceof BusinessError) {
    return error.code;
  }

  if (error instanceof ZodError) {
    return "INVALID_CUSTOMER";
  }

  return "CUSTOMER_OPERATION_FAILED";
}

export async function createCustomerAction(formData: FormData) {
  const user = await requireCurrentUser();

  try {
    const customer = await createCustomer(user, {
      phone: value(formData, "phone"),
      name: value(formData, "name"),
      notes: value(formData, "notes"),
    });

    revalidatePath("/customers");
    redirect(`/customers/${customer.id}?success=created`);
  } catch (error) {
    redirect(
      `/customers?error=${encodeURIComponent(errorCode(error))}`,
    );
  }
}
