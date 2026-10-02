"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { Role } from "@/generated/prisma/client";
import { assertRole } from "@/lib/auth/authorization";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { BusinessError } from "@/lib/business-error";
import {
  createCustomer,
  findCustomerByPhone,
} from "@/modules/customers/customer.service";
import {
  cancelCustomerOrder,
  confirmCustomerOrder,
  createCustomerOrder,
  deliverCustomerOrder,
  dispatchCustomerOrder,
  packCustomerOrder,
} from "@/modules/orders/order.service";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "");
}

function operationError(error: unknown) {
  if (error instanceof BusinessError) return error.code;
  if (error instanceof ZodError) return "INVALID_ORDER_INPUT";
  return "ORDER_OPERATION_FAILED";
}

function redirectError(orderId: string | null, error: unknown): never {
  const code = encodeURIComponent(operationError(error));
  redirect(orderId ? `/orders/${orderId}?error=${code}` : `/orders?error=${code}`);
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

export async function lookupCustomerForOrderAction(phone: string) {
  const user = await requireCurrentUser();
  assertRole(user.role, [Role.OWNER_ADMIN, Role.CASHIER_STORE]);

  try {
    const customer = await findCustomerByPhone(phone);
    if (!customer || !customer.active) {
      return { ok: false as const, code: "CUSTOMER_NOT_FOUND" };
    }
    return { ok: true as const, customer: customerPayload(customer) };
  } catch (error) {
    return { ok: false as const, code: operationError(error) };
  }
}

export async function createCustomerForOrderAction(input: {
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
    return { ok: true as const, customer: customerPayload(customer) };
  } catch (error) {
    if (error instanceof BusinessError && error.code === "CUSTOMER_EXISTS") {
      const existing = await findCustomerByPhone(input.phone).catch(() => null);
      if (existing?.active) {
        return { ok: true as const, customer: customerPayload(existing) };
      }
    }
    return { ok: false as const, code: operationError(error) };
  }
}

export async function createCustomerOrderAction(formData: FormData) {
  const user = await requireCurrentUser();
  const lineCount = Number(value(formData, "lineCount"));

  if (!Number.isInteger(lineCount) || lineCount < 1 || lineCount > 100) {
    redirect("/orders?error=INVALID_ORDER_INPUT");
  }

  const items = Array.from({ length: lineCount }, (_, index) => ({
    productId: value(formData, `productId_${index}`),
    quantity: value(formData, `quantity_${index}`),
  }));

  let orderId: string;

  try {
    const order = await createCustomerOrder(user, {
      customerId: value(formData, "customerId"),
      addressText: value(formData, "addressText"),
      deliveryCharge: value(formData, "deliveryCharge") || "0",
      notes: value(formData, "notes"),
      idempotencyKey: value(formData, "idempotencyKey"),
      items,
    });
    orderId = order.id;
  } catch (error) {
    redirectError(null, error);
  }

  revalidatePath("/orders");
  redirect(`/orders/${orderId}?success=created`);
}

async function runCommand(
  formData: FormData,
  command: (
    user: Awaited<ReturnType<typeof requireCurrentUser>>,
    orderId: string,
    input: { idempotencyKey: string },
  ) => Promise<unknown>,
  success: string,
) {
  const user = await requireCurrentUser();
  const orderId = value(formData, "orderId");

  try {
    await command(user, orderId, {
      idempotencyKey: value(formData, "idempotencyKey"),
    });
  } catch (error) {
    redirectError(orderId, error);
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/inventory");
  revalidatePath("/inventory/movements");
  revalidatePath("/customers");
  redirect(`/orders/${orderId}?success=${success}`);
}

export async function confirmCustomerOrderAction(formData: FormData) {
  return runCommand(formData, confirmCustomerOrder, "confirmed");
}

export async function packCustomerOrderAction(formData: FormData) {
  return runCommand(formData, packCustomerOrder, "packed");
}

export async function dispatchCustomerOrderAction(formData: FormData) {
  return runCommand(formData, dispatchCustomerOrder, "dispatched");
}

export async function deliverCustomerOrderAction(formData: FormData) {
  return runCommand(formData, deliverCustomerOrder, "delivered");
}

export async function cancelCustomerOrderAction(formData: FormData) {
  return runCommand(formData, cancelCustomerOrder, "cancelled");
}
