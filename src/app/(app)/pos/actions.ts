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
import {
  getPosMembershipSnapshot,
  quotePosPricing,
} from "@/modules/pricing/pricing.service";
import { isLoyaltyEarningEnabled } from "@/modules/loyalty/loyalty.service";

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
}, membership: Awaited<ReturnType<typeof getPosMembershipSnapshot>>) {
  const phoneDigits = customer.phoneNormalized.replace(/\D/g, "");
  return {
    id: customer.id,
    phoneMasked: `****${phoneDigits.slice(-4)}`,
    name: customer.name,
    active: customer.active,
    pointBalance: customer.loyaltyAccount?.pointBalance ?? 0,
    spendRemainder:
      customer.loyaltyAccount?.spendRemainder.toFixed(2) ?? "0.00",
    loyaltyStatus: isLoyaltyEarningEnabled()
      ? "active"
      : "historical-only",
    membershipNumber: membership.membershipNumber,
    membershipTier: membership.membershipTier,
    membershipStatus: membership.membershipStatus,
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

    const membership = await getPosMembershipSnapshot(user, customer.id);
    return {
      ok: true as const,
      customer: customerPayload(customer, membership),
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
    const membership = await getPosMembershipSnapshot(user, customer.id);

    return {
      ok: true as const,
      customer: customerPayload(customer, membership),
    };
  } catch (error) {
    if (
      error instanceof BusinessError &&
      error.code === "CUSTOMER_EXISTS"
    ) {
      try {
        const existing = await findCustomerByPhone(input.phone);

        if (existing?.active) {
          const membership = await getPosMembershipSnapshot(user, existing.id);
          return {
            ok: true as const,
            customer: customerPayload(existing, membership),
          };
        }
      } catch (existingError) {
        return {
          ok: false as const,
          code: operationError(existingError),
        };
      }
    }

    return {
      ok: false as const,
      code: operationError(error),
    };
  }
}

export async function quotePosPricingAction(input: {
  customerId: string | null;
  items: Array<{ productId: string; quantity: string }>;
}) {
  const user = await requireCurrentUser();

  try {
    const quote = await quotePosPricing(user, input);
    return { ok: true as const, quote };
  } catch (error) {
    return {
      ok: false as const,
      code: operationError(error),
    };
  }
}

export async function finalizeSaleAction(formData: FormData) {
  const user = await requireCurrentUser();
  if (
    [...formData.keys()].some((key) =>
      /price|discount|subtotal|total|membership|tier|promotion/i.test(key),
    )
  ) {
    redirect("/pos?error=INVALID_POS_INPUT");
  }
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
      signedQuoteToken: value(formData, "signedQuoteToken") || undefined,
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
