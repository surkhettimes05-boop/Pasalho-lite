import {
  CustomerOrderStatus,
  InventoryMovementType,
  LoyaltySourceType,
  PaymentMethod,
  PaymentSourceType,
  PaymentStatus,
  Prisma,
  ReturnKind,
  ReturnSourceType,
  ReturnStatus,
  Role,
  SaleStatus,
} from "@/generated/prisma/client";
import { assertRole } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import { getNepalOperatingDateKey } from "@/lib/time";
import { recordSystemRefundCashMovement } from "@/modules/cash/cash.service";
import { recordPhysicalInventoryMovement } from "@/modules/inventory/inventory.service";
import { applyEligibleSpendReversal } from "@/modules/loyalty/loyalty.service";
import {
  processReturnInputSchema,
  type ProcessReturnInput,
} from "@/modules/returns/return.schemas";

const returnInclude = {
  items: {
    include: {
      product: {
        select: {
          sku: true,
          name: true,
          unit: true,
        },
      },
    },
    orderBy: {
      originalLineId: "asc",
    },
  },
  createdBy: {
    select: {
      name: true,
      email: true,
    },
  },
} satisfies Prisma.ReturnRecordInclude;

type SourceLine = {
  id: string;
  productId: string;
  skuSnapshot: string;
  productNameSnapshot: string;
  quantity: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
};

type LoadedSource =
  | {
      sourceType: typeof ReturnSourceType.SALE;
      id: string;
      reference: string;
      storeLocationId: string;
      customerId: string | null;
      total: Prisma.Decimal;
      discountTotal: Prisma.Decimal;
      status: SaleStatus;
      paymentStatus: PaymentStatus;
      lines: SourceLine[];
    }
  | {
      sourceType: typeof ReturnSourceType.CUSTOMER_ORDER;
      id: string;
      reference: string;
      storeLocationId: string;
      customerId: string;
      total: Prisma.Decimal;
      discountTotal: Prisma.Decimal;
      status: CustomerOrderStatus;
      paymentStatus: PaymentStatus;
      lines: SourceLine[];
    };

function buildReturnNumber(now: Date) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .replaceAll("-", "");

  return `RET-${date}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function normalizedCommandItems(
  items: Array<{
    originalLineId: string;
    quantity: string | Prisma.Decimal;
    physicallyReturned: boolean;
    restockQuantity: string | Prisma.Decimal;
  }>,
) {
  return items
    .map((item) => ({
      originalLineId: item.originalLineId,
      quantity:
        item.quantity instanceof Prisma.Decimal
          ? item.quantity.toString()
          : new Prisma.Decimal(item.quantity).toString(),
      physicallyReturned: item.physicallyReturned,
      restockQuantity:
        item.restockQuantity instanceof Prisma.Decimal
          ? item.restockQuantity.toString()
          : new Prisma.Decimal(item.restockQuantity).toString(),
    }))
    .sort((a, b) => a.originalLineId.localeCompare(b.originalLineId));
}

async function loadSource(
  tx: Prisma.TransactionClient,
  sourceType: ReturnSourceType,
  sourceId: string,
): Promise<LoadedSource> {
  if (sourceType === ReturnSourceType.SALE) {
    const sale = await tx.sale.findUnique({
      where: { id: sourceId },
      include: { items: true },
    });

    if (!sale) {
      throw new BusinessError("RETURN_SOURCE_NOT_FOUND", "Original sale not found.");
    }

    return {
      sourceType,
      id: sale.id,
      reference: sale.receiptNumber,
      storeLocationId: sale.storeLocationId,
      customerId: sale.customerId,
      total: sale.total,
      discountTotal: sale.discountTotal,
      status: sale.status,
      paymentStatus: sale.paymentStatus,
      lines: sale.items,
    };
  }

  const order = await tx.customerOrder.findUnique({
    where: { id: sourceId },
    include: { items: true },
  });

  if (!order) {
    throw new BusinessError("RETURN_SOURCE_NOT_FOUND", "Original customer order not found.");
  }

  return {
    sourceType,
    id: order.id,
    reference: order.orderNumber,
    storeLocationId: order.storeLocationId,
    customerId: order.customerId,
    total: order.total,
    discountTotal: order.discountTotal,
    status: order.status,
    paymentStatus: order.paymentStatus,
    lines: order.items,
  };
}

function paymentSourceType(sourceType: ReturnSourceType) {
  return sourceType === ReturnSourceType.SALE
    ? PaymentSourceType.SALE
    : PaymentSourceType.CUSTOMER_ORDER;
}

function loyaltySourceType(sourceType: ReturnSourceType) {
  return sourceType === ReturnSourceType.SALE
    ? LoyaltySourceType.SALE
    : LoyaltySourceType.CUSTOMER_ORDER;
}

async function loadPayment(
  tx: Prisma.TransactionClient,
  sourceType: ReturnSourceType,
  sourceId: string,
) {
  const payment = await tx.payment.findUnique({
    where: {
      sourceType_sourceId: {
        sourceType: paymentSourceType(sourceType),
        sourceId,
      },
    },
  });

  if (!payment) {
    throw new BusinessError(
      "PAYMENT_INTEGRITY_ERROR",
      "Original transaction is missing its payment record.",
    );
  }

  return payment;
}

async function getPriorReturnFacts(
  tx: Prisma.TransactionClient,
  sourceType: ReturnSourceType,
  sourceId: string,
) {
  const priorItems = await tx.returnItem.findMany({
    where: {
      returnRecord: {
        sourceType,
        sourceId,
        status: ReturnStatus.COMPLETED,
      },
    },
    select: {
      originalLineId: true,
      quantity: true,
      refundAmount: true,
    },
  });

  const quantityByLine = new Map<string, Prisma.Decimal>();
  const refundByLine = new Map<string, Prisma.Decimal>();

  for (const item of priorItems) {
    quantityByLine.set(
      item.originalLineId,
      (quantityByLine.get(item.originalLineId) ?? new Prisma.Decimal(0)).add(
        item.quantity,
      ),
    );
    refundByLine.set(
      item.originalLineId,
      (refundByLine.get(item.originalLineId) ?? new Prisma.Decimal(0)).add(
        item.refundAmount,
      ),
    );
  }

  return { quantityByLine, refundByLine };
}

function assertAllocatedDiscounts(source: LoadedSource) {
  const lineDiscountTotal = source.lines.reduce(
    (sum, line) => sum.add(line.discountAmount),
    new Prisma.Decimal(0),
  );

  if (!lineDiscountTotal.equals(source.discountTotal)) {
    throw new BusinessError(
      "RETURN_PRICING_INTEGRITY_ERROR",
      "Original transaction discount is not allocated across item lines, so a safe item refund cannot be calculated.",
    );
  }
}

function calculateLineRefund(input: {
  line: SourceLine;
  priorReturnedQuantity: Prisma.Decimal;
  priorRefundAmount: Prisma.Decimal;
  returnQuantity: Prisma.Decimal;
}) {
  const netLineAmount = input.line.lineTotal.sub(input.line.discountAmount);
  const cumulativeReturned = input.priorReturnedQuantity.add(
    input.returnQuantity,
  );

  const targetCumulativeRefund = cumulativeReturned.equals(input.line.quantity)
    ? netLineAmount
    : netLineAmount
        .mul(cumulativeReturned)
        .div(input.line.quantity)
        .toDecimalPlaces(2);

  const refund = targetCumulativeRefund.sub(input.priorRefundAmount);

  if (refund.isNegative()) {
    throw new BusinessError(
      "RETURN_PRICING_INTEGRITY_ERROR",
      "Calculated refund would be negative.",
    );
  }

  return refund;
}

async function existingReturnForReplay(
  parsed: ProcessReturnInput,
) {
  const existing = await prisma.returnRecord.findUnique({
    where: { idempotencyKey: parsed.idempotencyKey },
    include: returnInclude,
  });

  if (!existing) return null;

  const same =
    existing.sourceType === parsed.sourceType &&
    existing.sourceId === parsed.sourceId &&
    existing.reason === parsed.reason &&
    JSON.stringify(
      normalizedCommandItems(
        existing.items.map((item) => ({
          originalLineId: item.originalLineId,
          quantity: item.quantity,
          physicallyReturned: item.physicallyReturned,
          restockQuantity: item.restockQuantity,
        })),
      ),
    ) === JSON.stringify(normalizedCommandItems(parsed.items));

  if (!same) {
    throw new BusinessError(
      "IDEMPOTENCY_CONFLICT",
      "That return idempotency key was already used differently.",
    );
  }

  return existing;
}

async function retrySerializable<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < 2
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new BusinessError(
    "RETURN_CONCURRENCY_RETRY_EXHAUSTED",
    "Return could not complete after concurrent updates.",
  );
}

export async function processReturn(
  actor: SessionUser,
  input: ProcessReturnInput,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const parsed = processReturnInputSchema.parse(input);

  const replay = await existingReturnForReplay(parsed);
  if (replay) return replay;

  try {
    return await retrySerializable(() =>
      prisma.$transaction(
        async (tx) => {
          const source = await loadSource(tx, parsed.sourceType, parsed.sourceId);
          const payment = await loadPayment(tx, parsed.sourceType, parsed.sourceId);
          const prior = await getPriorReturnFacts(
            tx,
            parsed.sourceType,
            parsed.sourceId,
          );

          const lineById = new Map(
            source.lines.map((line) => [line.id, line]),
          );

          const isRecovery =
            source.sourceType === ReturnSourceType.CUSTOMER_ORDER &&
            source.status === CustomerOrderStatus.DISPATCHED &&
            payment.status === PaymentStatus.PENDING;

          if (
            source.sourceType === ReturnSourceType.CUSTOMER_ORDER &&
            !isRecovery &&
            source.status !== CustomerOrderStatus.DELIVERED
          ) {
            throw new BusinessError(
              "INVALID_RETURN_SOURCE_STATE",
              "COD refunds require a DELIVERED order; DISPATCHED orders must use full recovery.",
            );
          }

          if (
            source.sourceType === ReturnSourceType.SALE &&
            source.status === SaleStatus.RETURNED
          ) {
            throw new BusinessError(
              "RETURN_QUANTITY_EXCEEDED",
              "This sale is already fully returned.",
            );
          }

          if (!isRecovery) {
            if (
              payment.status !== PaymentStatus.PAID &&
              payment.status !== PaymentStatus.PARTIALLY_REFUNDED
            ) {
              throw new BusinessError(
                "INVALID_PAYMENT_STATE",
                "Only collected payments can be refunded.",
              );
            }

            if (!payment.collectedAt) {
              throw new BusinessError(
                "PAYMENT_INTEGRITY_ERROR",
                "Collected payment is missing collection time.",
              );
            }

            assertAllocatedDiscounts(source);
          }

          if (
            actor.role !== Role.OWNER_ADMIN &&
            parsed.items.some((item) => !item.physicallyReturned)
          ) {
            throw new BusinessError(
              "UNUSUAL_REFUND_REQUIRES_ADMIN",
              "Cashier returns require the goods to be physically returned.",
            );
          }

          const preparedItems: Array<{
            productId: string;
            originalLineId: string;
            quantity: Prisma.Decimal;
            physicallyReturned: boolean;
            restockQuantity: Prisma.Decimal;
            refundAmount: Prisma.Decimal;
          }> = [];

          let refundTotal = new Prisma.Decimal(0);

          for (const commandItem of parsed.items) {
            const line = lineById.get(commandItem.originalLineId);

            if (!line) {
              throw new BusinessError(
                "RETURN_LINE_NOT_FOUND",
                "Return item does not belong to the original transaction.",
              );
            }

            const quantity = new Prisma.Decimal(commandItem.quantity);
            const restockQuantity = new Prisma.Decimal(
              commandItem.restockQuantity,
            );
            const priorQuantity =
              prior.quantityByLine.get(line.id) ?? new Prisma.Decimal(0);
            const remainingQuantity = line.quantity.sub(priorQuantity);

            if (remainingQuantity.lessThan(quantity)) {
              throw new BusinessError(
                "RETURN_QUANTITY_EXCEEDED",
                `Return quantity exceeds remaining quantity for ${line.skuSnapshot}.`,
              );
            }

            const priorRefund =
              prior.refundByLine.get(line.id) ?? new Prisma.Decimal(0);
            const refundAmount = isRecovery
              ? new Prisma.Decimal(0)
              : calculateLineRefund({
                  line,
                  priorReturnedQuantity: priorQuantity,
                  priorRefundAmount: priorRefund,
                  returnQuantity: quantity,
                });

            refundTotal = refundTotal.add(refundAmount);

            preparedItems.push({
              productId: line.productId,
              originalLineId: line.id,
              quantity,
              physicallyReturned: commandItem.physicallyReturned,
              restockQuantity,
              refundAmount,
            });
          }

          if (isRecovery) {
            if (
              parsed.items.some((item) => !item.physicallyReturned)
            ) {
              throw new BusinessError(
                "RECOVERY_REQUIRES_PHYSICAL_RETURN",
                "Failed-delivery recovery requires all goods to be physically returned.",
              );
            }

            for (const line of source.lines) {
              const priorQuantity =
                prior.quantityByLine.get(line.id) ?? new Prisma.Decimal(0);
              const remainingQuantity = line.quantity.sub(priorQuantity);
              const prepared = preparedItems.find(
                (item) => item.originalLineId === line.id,
              );

              if (
                !prepared ||
                !prepared.quantity.equals(remainingQuantity)
              ) {
                throw new BusinessError(
                  "PARTIAL_RECOVERY_NOT_SUPPORTED",
                  "V1 failed-delivery recovery must recover every remaining dispatched item.",
                );
              }
            }
          } else if (!refundTotal.greaterThan(0)) {
            throw new BusinessError(
              "INVALID_REFUND_AMOUNT",
              "Return must produce a positive refund amount.",
            );
          }

          const nextRefunded = payment.refundedAmount.add(refundTotal);

          if (nextRefunded.greaterThan(payment.amount)) {
            throw new BusinessError(
              "REFUND_AMOUNT_EXCEEDED",
              "Refund would exceed the amount originally collected.",
            );
          }

          const now = new Date();
          const kind = isRecovery ? ReturnKind.RECOVERY : ReturnKind.REFUND;
          const record = await tx.returnRecord.create({
            data: {
              returnNumber: buildReturnNumber(now),
              sourceType: parsed.sourceType,
              sourceId: parsed.sourceId,
              kind,
              status: ReturnStatus.COMPLETED,
              refundAmount: refundTotal,
              refundMethod: isRecovery ? null : payment.method,
              reason: parsed.reason,
              createdByUserId: actor.id,
              completedAt: now,
              idempotencyKey: parsed.idempotencyKey,
              items: {
                create: preparedItems,
              },
            },
            include: returnInclude,
          });

          for (const item of preparedItems) {
            if (!item.restockQuantity.greaterThan(0)) continue;

            await recordPhysicalInventoryMovement(tx, {
              productId: item.productId,
              locationId: source.storeLocationId,
              type: InventoryMovementType.RETURN_IN,
              quantityDelta: item.restockQuantity,
              referenceType: "RETURN",
              referenceId: record.id,
              idempotencyKey: `return-in:${record.id}:${item.originalLineId}`,
              reason: `Return ${record.returnNumber}: ${parsed.reason}`,
              actorUserId: actor.id,
            });
          }

          if (isRecovery) {
            await tx.customerOrder.update({
              where: { id: source.id },
              data: {
                status: CustomerOrderStatus.CANCELLED,
                cancelledAt: now,
              },
            });
          } else {
            const nextPaymentStatus = nextRefunded.equals(payment.amount)
              ? PaymentStatus.REFUNDED
              : PaymentStatus.PARTIALLY_REFUNDED;

            await tx.payment.update({
              where: { id: payment.id },
              data: {
                refundedAmount: nextRefunded,
                status: nextPaymentStatus,
              },
            });

            if (
              payment.method === PaymentMethod.CASH ||
              payment.method === PaymentMethod.COD
            ) {
              await recordSystemRefundCashMovement(tx, {
                storeLocationId: source.storeLocationId,
                operatingDateKey: getNepalOperatingDateKey(now),
                amount: refundTotal,
                reason: `Refund ${record.returnNumber} for ${source.reference}`,
                referenceId: record.id,
                idempotencyKey: `refund-out:${record.id}`,
                actorUserId: actor.id,
              });
            }

            if (source.sourceType === ReturnSourceType.SALE) {
              const allReturned = source.lines.every((line) => {
                const priorQuantity =
                  prior.quantityByLine.get(line.id) ?? new Prisma.Decimal(0);
                const currentQuantity =
                  preparedItems.find(
                    (item) => item.originalLineId === line.id,
                  )?.quantity ?? new Prisma.Decimal(0);

                return priorQuantity
                  .add(currentQuantity)
                  .equals(line.quantity);
              });

              await tx.sale.update({
                where: { id: source.id },
                data: {
                  status: allReturned
                    ? SaleStatus.RETURNED
                    : SaleStatus.PARTIALLY_RETURNED,
                  paymentStatus: nextPaymentStatus,
                },
              });
            } else {
              await tx.customerOrder.update({
                where: { id: source.id },
                data: {
                  paymentStatus: nextPaymentStatus,
                },
              });
            }

            if (source.customerId) {
              await applyEligibleSpendReversal(tx, {
                customerId: source.customerId,
                amount: refundTotal,
                sourceType: loyaltySourceType(parsed.sourceType),
                sourceId: source.id,
                idempotencyKey: `loyalty-return:${record.id}`,
                actorUserId: actor.id,
                reason: `Refund ${record.returnNumber} for ${source.reference}`,
              });
            }
          }

          await tx.auditLog.create({
            data: {
              actorUserId: actor.id,
              action: isRecovery
                ? "COD_ORDER_RECOVERED"
                : "RETURN_REFUND_COMPLETED",
              entityType: "Return",
              entityId: record.id,
              afterData: {
                returnNumber: record.returnNumber,
                sourceType: record.sourceType,
                sourceId: record.sourceId,
                kind: record.kind,
                refundAmount: record.refundAmount.toFixed(2),
                refundMethod: record.refundMethod,
                itemCount: record.items.length,
                restockQuantity: record.items
                  .reduce(
                    (sum, item) => sum.add(item.restockQuantity),
                    new Prisma.Decimal(0),
                  )
                  .toString(),
              },
              metadata: {
                sourceReference: source.reference,
                refundWithoutGoods:
                  parsed.items.some((item) => !item.physicallyReturned),
              },
            },
          });

          return record;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const replayAfterConflict = await existingReturnForReplay(parsed);
      if (replayAfterConflict) return replayAfterConflict;
    }
    throw error;
  }
}

export async function getReturnById(returnId: string) {
  return prisma.returnRecord.findUnique({
    where: { id: returnId },
    include: returnInclude,
  });
}

export async function getReturnPage(page = 1, pageSize = 30) {
  const normalizedPage = Math.max(1, page);
  const normalizedPageSize = Math.min(Math.max(pageSize, 1), 100);

  const [returns, total] = await Promise.all([
    prisma.returnRecord.findMany({
      orderBy: { completedAt: "desc" },
      skip: (normalizedPage - 1) * normalizedPageSize,
      take: normalizedPageSize,
      include: returnInclude,
    }),
    prisma.returnRecord.count(),
  ]);

  return {
    returns,
    total,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    totalPages: Math.max(1, Math.ceil(total / normalizedPageSize)),
  };
}

export async function searchReturnSources(query: string) {
  const q = query.trim();
  if (!q) return { sales: [], orders: [] };

  const [sales, orders] = await Promise.all([
    prisma.sale.findMany({
      where: {
        receiptNumber: { contains: q, mode: "insensitive" },
      },
      orderBy: { finalizedAt: "desc" },
      take: 20,
      include: {
        customer: true,
        items: true,
      },
    }),
    prisma.customerOrder.findMany({
      where: {
        OR: [
          { orderNumber: { contains: q, mode: "insensitive" } },
          { phoneSnapshot: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        customer: true,
        items: true,
      },
    }),
  ]);

  return { sales, orders };
}

export async function getReturnSourceDetails(
  sourceType: ReturnSourceType,
  sourceId: string,
) {
  return prisma.$transaction(async (tx) => {
    const source = await loadSource(tx, sourceType, sourceId);
    const payment = await loadPayment(tx, sourceType, sourceId);
    const prior = await getPriorReturnFacts(tx, sourceType, sourceId);

    return {
      source,
      payment,
      lines: source.lines.map((line) => ({
        ...line,
        alreadyReturned:
          prior.quantityByLine.get(line.id) ?? new Prisma.Decimal(0),
        alreadyRefunded:
          prior.refundByLine.get(line.id) ?? new Prisma.Decimal(0),
        remainingQuantity: line.quantity.sub(
          prior.quantityByLine.get(line.id) ?? new Prisma.Decimal(0),
        ),
      })),
    };
  });
}
