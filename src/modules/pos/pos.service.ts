import {
  InventoryMovementType,
  LocationType,
  LoyaltySourceType,
  PaymentMethod,
  PaymentSourceType,
  PaymentStatus,
  Prisma,
  Role,
  SaleStatus,
} from "@/generated/prisma/client";
import { assertRole } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import { recordPhysicalInventoryMovement } from "@/modules/inventory/inventory.service";
import { applyEligibleSpend } from "@/modules/loyalty/loyalty.service";
import {
  finalizeSaleInputSchema,
  type FinalizeSaleInput,
} from "@/modules/pos/pos.schemas";

const saleInclude = {
  storeLocation: true,
  customer: {
    include: {
      loyaltyAccount: true,
    },
  },
  finalizedBy: {
    select: {
      name: true,
      email: true,
    },
  },
  items: {
    orderBy: {
      productNameSnapshot: "asc",
    },
  },
} satisfies Prisma.SaleInclude;

function buildReceiptNumber(now: Date) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .replaceAll("-", "");

  return `POS-${date}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function normalizedCommandItems(
  items: Array<{ productId: string; quantity: Prisma.Decimal | string }>,
) {
  return items
    .map((item) => ({
      productId: item.productId,
      quantity:
        item.quantity instanceof Prisma.Decimal
          ? item.quantity.toString()
          : new Prisma.Decimal(item.quantity).toString(),
    }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
}

async function getExistingSale(idempotencyKey: string) {
  const sale = await prisma.sale.findUnique({
    where: { idempotencyKey },
    include: saleInclude,
  });

  if (!sale) {
    return null;
  }

  const [payment, loyaltyTransaction] = await Promise.all([
    prisma.payment.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: PaymentSourceType.SALE,
          sourceId: sale.id,
        },
      },
    }),
    sale.customerId
      ? prisma.loyaltyTransaction.findUnique({
          where: {
            idempotencyKey: `loyalty-sale:${sale.id}`,
          },
        })
      : Promise.resolve(null),
  ]);

  return { sale, payment, loyaltyTransaction };
}

function sameFinalizeCommand(
  existing: NonNullable<Awaited<ReturnType<typeof getExistingSale>>>,
  parsed: FinalizeSaleInput,
) {
  if (
    existing.payment?.method !== parsed.paymentMethod ||
    existing.sale.customerId !== (parsed.customerId ?? null)
  ) {
    return false;
  }

  return (
    JSON.stringify(
      normalizedCommandItems(
        existing.sale.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
      ),
    ) === JSON.stringify(normalizedCommandItems(parsed.items))
  );
}

async function returnReplayOrConflict(parsed: FinalizeSaleInput) {
  const existing = await getExistingSale(parsed.idempotencyKey);

  if (!existing) {
    return null;
  }

  if (!sameFinalizeCommand(existing, parsed)) {
    throw new BusinessError(
      "IDEMPOTENCY_CONFLICT",
      "That POS idempotency key was already used for a different sale.",
    );
  }

  if (!existing.payment) {
    throw new BusinessError(
      "SALE_INTEGRITY_ERROR",
      "Existing finalized sale is missing its payment.",
    );
  }

  if (existing.sale.customerId && !existing.loyaltyTransaction) {
    throw new BusinessError(
      "SALE_INTEGRITY_ERROR",
      "Existing identified-customer sale is missing its loyalty transaction.",
    );
  }

  return {
    sale: existing.sale,
    payment: existing.payment,
    loyaltyTransaction: existing.loyaltyTransaction,
  };
}

async function finalizeSaleTransaction(
  actor: SessionUser,
  parsed: FinalizeSaleInput,
) {
  return prisma.$transaction(
    async (tx) => {
      const store = await tx.location.findFirst({
        where: {
          code: "STORE_MAIN",
          type: LocationType.STORE,
          active: true,
        },
      });

      if (!store) {
        throw new BusinessError(
          "STORE_NOT_FOUND",
          "The V1 store is not available.",
        );
      }

      if (parsed.customerId) {
        const customer = await tx.customer.findUnique({
          where: { id: parsed.customerId },
        });

        if (!customer || !customer.active) {
          throw new BusinessError(
            "CUSTOMER_NOT_AVAILABLE",
            "Selected customer is unavailable.",
          );
        }
      }

      const productIds = parsed.items.map((item) => item.productId);
      const products = await tx.product.findMany({
        where: {
          id: { in: productIds },
        },
        include: {
          stockBalances: {
            where: {
              locationId: store.id,
            },
            take: 1,
          },
        },
      });

      if (products.length !== productIds.length) {
        throw new BusinessError(
          "PRODUCT_NOT_AVAILABLE",
          "Every POS item must reference an existing product.",
        );
      }

      const productById = new Map(
        products.map((product) => [product.id, product]),
      );

      let subtotal = new Prisma.Decimal(0);
      const preparedItems: Array<{
        productId: string;
        skuSnapshot: string;
        productNameSnapshot: string;
        quantity: Prisma.Decimal;
        unitPrice: Prisma.Decimal;
        discountAmount: Prisma.Decimal;
        lineTotal: Prisma.Decimal;
        unitCostSnapshot: Prisma.Decimal;
      }> = [];

      for (const commandItem of parsed.items) {
        const product = productById.get(commandItem.productId);

        if (!product || !product.active) {
          throw new BusinessError(
            "PRODUCT_NOT_AVAILABLE",
            "Inactive products cannot be sold.",
          );
        }

        const quantity = new Prisma.Decimal(commandItem.quantity);
        const balance = product.stockBalances[0];
        const onHand = balance?.onHand ?? new Prisma.Decimal(0);
        const reserved = balance?.reserved ?? new Prisma.Decimal(0);
        const available = onHand.sub(reserved);

        if (available.lessThan(quantity)) {
          throw new BusinessError(
            "INSUFFICIENT_STOCK",
            `Insufficient store stock for ${product.sku}.`,
          );
        }

        const unitPrice = product.sellingPrice;
        const lineTotal = unitPrice.mul(quantity).toDecimalPlaces(2);

        subtotal = subtotal.add(lineTotal);
        preparedItems.push({
          productId: product.id,
          skuSnapshot: product.sku,
          productNameSnapshot: product.name,
          quantity,
          unitPrice,
          discountAmount: new Prisma.Decimal(0),
          lineTotal,
          unitCostSnapshot: product.costPrice,
        });
      }

      subtotal = subtotal.toDecimalPlaces(2);
      const discountTotal = new Prisma.Decimal(0);
      const total = subtotal.sub(discountTotal);
      const now = new Date();

      const sale = await tx.sale.create({
        data: {
          receiptNumber: buildReceiptNumber(now),
          storeLocationId: store.id,
          customerId: parsed.customerId ?? null,
          status: SaleStatus.FINALIZED,
          subtotal,
          discountTotal,
          total,
          paymentStatus: PaymentStatus.PAID,
          finalizedAt: now,
          finalizedByUserId: actor.id,
          idempotencyKey: parsed.idempotencyKey,
          items: {
            create: preparedItems,
          },
        },
        include: saleInclude,
      });

      const payment = await tx.payment.create({
        data: {
          sourceType: PaymentSourceType.SALE,
          sourceId: sale.id,
          method: parsed.paymentMethod,
          status: PaymentStatus.PAID,
          amount: total,
          collectedAt: now,
          refundedAmount: new Prisma.Decimal(0),
          idempotencyKey: `pos-payment:${parsed.idempotencyKey}`,
          recordedByUserId: actor.id,
        },
      });

      for (const item of preparedItems) {
        await recordPhysicalInventoryMovement(tx, {
          productId: item.productId,
          locationId: store.id,
          type: InventoryMovementType.POS_SALE,
          quantityDelta: item.quantity.negated(),
          referenceType: "SALE",
          referenceId: sale.id,
          idempotencyKey: `pos-sale:${parsed.idempotencyKey}:${item.productId}`,
          reason: `POS sale ${sale.receiptNumber}`,
          actorUserId: actor.id,
        });
      }

      const loyaltyTransaction = parsed.customerId
        ? await applyEligibleSpend(tx, {
            customerId: parsed.customerId,
            eligibleSpend: total,
            sourceType: LoyaltySourceType.SALE,
            sourceId: sale.id,
            idempotencyKey: `loyalty-sale:${sale.id}`,
            actorUserId: actor.id,
            reason: `Eligible POS spend ${sale.receiptNumber}`,
          })
        : null;

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: "POS_SALE_FINALIZED",
          entityType: "Sale",
          entityId: sale.id,
          afterData: {
            receiptNumber: sale.receiptNumber,
            status: sale.status,
            subtotal: sale.subtotal.toFixed(2),
            discountTotal: sale.discountTotal.toFixed(2),
            total: sale.total.toFixed(2),
            paymentStatus: sale.paymentStatus,
            paymentMethod: payment.method,
            itemCount: sale.items.length,
            customerId: sale.customerId,
            loyaltyPointsEarned: loyaltyTransaction?.pointsDelta ?? 0,
          },
        },
      });

      return { sale, payment, loyaltyTransaction };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

export async function finalizeSale(
  actor: SessionUser,
  input: FinalizeSaleInput,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const parsed = finalizeSaleInputSchema.parse(input);

  const replay = await returnReplayOrConflict(parsed);

  if (replay) {
    return replay;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await finalizeSaleTransaction(actor, parsed);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < 2
      ) {
        continue;
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const replayAfterConflict = await returnReplayOrConflict(parsed);

        if (replayAfterConflict) {
          return replayAfterConflict;
        }
      }

      throw error;
    }
  }

  throw new BusinessError(
    "POS_CONCURRENCY_RETRY_EXHAUSTED",
    "POS sale could not be finalized after concurrent updates.",
  );
}

export async function getPosCatalog() {
  const store = await prisma.location.findFirst({
    where: {
      code: "STORE_MAIN",
      type: LocationType.STORE,
      active: true,
    },
  });

  if (!store) {
    throw new BusinessError(
      "STORE_NOT_FOUND",
      "The V1 store is not available.",
    );
  }

  const products = await prisma.product.findMany({
    where: {
      active: true,
    },
    orderBy: {
      name: "asc",
    },
    include: {
      stockBalances: {
        where: {
          locationId: store.id,
        },
        take: 1,
      },
    },
  });

  return products.map((product) => {
    const balance = product.stockBalances[0];
    const onHand = balance?.onHand ?? new Prisma.Decimal(0);
    const reserved = balance?.reserved ?? new Prisma.Decimal(0);

    return {
      id: product.id,
      sku: product.sku,
      barcode: product.barcode,
      name: product.name,
      unit: product.unit,
      sellingPrice: product.sellingPrice.toFixed(2),
      available: onHand.sub(reserved).toString(),
    };
  });
}

export async function getSaleById(saleId: string) {
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: saleInclude,
  });

  if (!sale) {
    return null;
  }

  const [payment, loyaltyTransaction] = await Promise.all([
    prisma.payment.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: PaymentSourceType.SALE,
          sourceId: sale.id,
        },
      },
    }),
    sale.customerId
      ? prisma.loyaltyTransaction.findUnique({
          where: {
            idempotencyKey: `loyalty-sale:${sale.id}`,
          },
        })
      : Promise.resolve(null),
  ]);

  return { sale, payment, loyaltyTransaction };
}

export async function getSalePage(page = 1, pageSize = 30) {
  const normalizedPage = Math.max(1, page);
  const normalizedPageSize = Math.min(Math.max(pageSize, 1), 100);

  const [sales, total] = await Promise.all([
    prisma.sale.findMany({
      orderBy: { finalizedAt: "desc" },
      skip: (normalizedPage - 1) * normalizedPageSize,
      take: normalizedPageSize,
      include: saleInclude,
    }),
    prisma.sale.count(),
  ]);

  const saleIds = sales.map((sale) => sale.id);
  const payments = saleIds.length
    ? await prisma.payment.findMany({
        where: {
          sourceType: PaymentSourceType.SALE,
          sourceId: { in: saleIds },
        },
      })
    : [];

  const paymentBySaleId = new Map(
    payments.map((payment) => [payment.sourceId, payment]),
  );

  return {
    sales: sales.map((sale) => ({
      sale,
      payment: paymentBySaleId.get(sale.id) ?? null,
    })),
    total,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    totalPages: Math.max(1, Math.ceil(total / normalizedPageSize)),
  };
}

export { PaymentMethod };
