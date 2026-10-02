import { Prisma, Role } from "@/generated/prisma/client";
import { assertRole } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import {
  customerInputSchema,
  type CustomerInput,
} from "@/modules/customers/customer.schemas";

export function normalizeCustomerPhone(rawPhone: string) {
  const trimmed = rawPhone.trim();

  if (!trimmed) {
    throw new BusinessError(
      "INVALID_CUSTOMER_PHONE",
      "Customer phone is required.",
    );
  }

  let digits = trimmed.replace(/\D/g, "");

  if (digits.startsWith("00977")) {
    digits = digits.slice(2);
  }

  if (digits.startsWith("977")) {
    const local = digits.slice(3);

    if (local.length < 7 || local.length > 10) {
      throw new BusinessError(
        "INVALID_CUSTOMER_PHONE",
        "Enter a valid Nepal phone number.",
      );
    }

    return `+977${local}`;
  }

  if (digits.length >= 7 && digits.length <= 10) {
    return `+977${digits}`;
  }

  throw new BusinessError(
    "INVALID_CUSTOMER_PHONE",
    "Enter a valid Nepal phone number.",
  );
}

export async function findCustomerByPhone(rawPhone: string) {
  const phoneNormalized = normalizeCustomerPhone(rawPhone);

  return prisma.customer.findUnique({
    where: { phoneNormalized },
    include: {
      loyaltyAccount: true,
    },
  });
}

export async function createCustomer(
  actor: SessionUser,
  input: CustomerInput,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const parsed = customerInputSchema.parse(input);
  const phoneNormalized = normalizeCustomerPhone(parsed.phone);

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.customer.findUnique({
        where: { phoneNormalized },
        include: { loyaltyAccount: true },
      });

      if (existing) {
        throw new BusinessError(
          "CUSTOMER_EXISTS",
          "A customer with that phone already exists.",
        );
      }

      const customer = await tx.customer.create({
        data: {
          phoneNormalized,
          phoneDisplay: parsed.phone,
          name: parsed.name,
          notes: parsed.notes,
          loyaltyAccount: {
            create: {
              pointBalance: 0,
              spendRemainder: new Prisma.Decimal(0),
            },
          },
        },
        include: {
          loyaltyAccount: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: "CUSTOMER_CREATED",
          entityType: "Customer",
          entityId: customer.id,
          afterData: {
            phoneNormalized: customer.phoneNormalized,
            name: customer.name,
            active: customer.active,
          },
        },
      });

      return customer;
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new BusinessError(
        "CUSTOMER_EXISTS",
        "A customer with that phone already exists.",
      );
    }

    throw error;
  }
}

export async function getCustomerPage({
  search = "",
  page = 1,
  pageSize = 40,
}: {
  search?: string;
  page?: number;
  pageSize?: number;
} = {}) {
  const normalizedPage = Math.max(1, page);
  const normalizedPageSize = Math.min(Math.max(pageSize, 1), 100);
  const query = search.trim();
  let normalizedPhone: string | null = null;

  if (query) {
    try {
      normalizedPhone = normalizeCustomerPhone(query);
    } catch {
      normalizedPhone = null;
    }
  }

  const where: Prisma.CustomerWhereInput = query
    ? {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { phoneDisplay: { contains: query, mode: "insensitive" } },
          ...(normalizedPhone
            ? [{ phoneNormalized: normalizedPhone }]
            : []),
        ],
      }
    : {};

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (normalizedPage - 1) * normalizedPageSize,
      take: normalizedPageSize,
      include: {
        loyaltyAccount: true,
        _count: {
          select: {
            sales: true,
          },
        },
      },
    }),
    prisma.customer.count({ where }),
  ]);

  return {
    customers,
    total,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    totalPages: Math.max(1, Math.ceil(total / normalizedPageSize)),
  };
}

export async function getCustomerById(customerId: string) {
  return prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      loyaltyAccount: true,
      loyaltyTransactions: {
        orderBy: { createdAt: "desc" },
        take: 100,
      },
      sales: {
        orderBy: { finalizedAt: "desc" },
        take: 50,
        include: {
          items: true,
        },
      },
    },
  });
}
