"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { PaymentMethod, Role } from "@/generated/prisma/client";
import { assertRole } from "@/lib/auth/authorization";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { BusinessError } from "@/lib/business-error";
import {
  createCustomer,
  findCustomerByPhone,
} from "@/modules/customers/customer.service";
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

function customerPayload(customer: {
  id: string;
  phoneDisplay: string;
  phoneNormalized: string;
  name: string | null;
  active: boolean;
  loyaltyAccount: {
    pointBalance: number;
    spendRemainder: { toFixed: (digits: number) => string };
  } | null;
}) {
  return {
    id: customer.id,
    phoneDisplay: customer.phoneDisplay,
    phoneNormalized: customer.phoneNormalized,
    name: customer.name,
    active: customer.active,
    pointBalance: customer.loyaltyAccount?.pointBalance ?? 0,
    spendRemainder:
      customer.loyaltyAccount?.spendRemainder.toFixed(2) ?? "0.00",
  };
}

export async function lookupCustomerForPosAction(phone: string) {
  const user = await requireCurrentUser();
  assertRole(user.role, [Role.OWNER_ADMIN, Role.CASHIER_STORE]);

  try {
    const customer = await findCustomerByPhone(phone);

    if (!customer || !customer.active) {
      return {
        ok: false as const,
        code: "CUSTOMER_NOT_FOUND",
      };
    }

    return {
      ok: true as const,
      customer: customerPayload(customer),
    };
  } catch (error) {
    return {
      ok: false as const,
      code: operationError(error),
    };
  }
}

export async function createCustomerForPosAction(input: {
  phone: string;
  name: string;
}) {
  const user = await requireCurrentUser();

  try {
    const customer = await createCustomer(user, {
      phone: input.phone,
      name: input.name,
      notes: "",
    });

    return {
      ok: true as const,
      customer: customerPayload(customer),
    };
  } catch (error) {
    if (
      error instanceof BusinessError &&
      error.code === "CUSTOMER_EXISTS"
    ) {
      try {
        const existing = await findCustomerByPhone(input.phone);

        if (existing?.active) {
          return {
            ok: true as const,
            customer: customerPayload(existing),
          };
        }
      } catch {
        // Fall through to the original customer error.
      }
    }

    return {
      ok: false as const,
      code: operationError(error),
    };
  }
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
      customerId: value(formData, "customerId") || null,
      items,
    });

    saleId = result.sale.id;
  } catch (error) {
    redirect(`/pos?error=${encodeURIComponent(operationError(error))}`);
  }

  revalidatePath("/pos");
  revalidatePath("/customers");
  revalidatePath("/inventory");
  revalidatePath("/inventory/movements");
  redirect(`/pos/${saleId}?success=finalized`);
}
