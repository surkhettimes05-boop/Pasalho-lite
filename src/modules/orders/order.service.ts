import {
  CustomerOrderStatus,
  InventoryMovementType,
  LocationType,
  LoyaltySourceType,
  PaymentMethod,
  PaymentSourceType,
  PaymentStatus,
  Prisma,
  ReservationSourceType,
  ReservationStatus,
  Role,
} from "@/generated/prisma/client";
import { assertRole } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import { recordPhysicalInventoryMovement } from "@/modules/inventory/inventory.service";
import { applyEligibleSpend } from "@/modules/loyalty/loyalty.service";
import {
  createCustomerOrderInputSchema,
  orderCommandSchema,
  type CreateCustomerOrderInput,
  type OrderCommandInput,
} from "@/modules/orders/order.schemas";

const orderInclude = {
  customer: {
    include: {
      loyaltyAccount: true,
    },
  },
  storeLocation: true,
  createdBy: {
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
  reservations: {
    orderBy: {
      createdAt: "asc",
    },
  },
} satisfies Prisma.CustomerOrderInclude;

function buildOrderNumber(now: Date) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .replaceAll("-", "");

  return `COD-${date}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function commandItems(
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

async function paymentForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  return tx.payment.findUnique({
    where: {
      sourceType_sourceId: {
        sourceType: PaymentSourceType.CUSTOMER_ORDER,
        sourceId: orderId,
      },
    },
  });
}

function eligibleOrderSpend(order: {
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
}) {
  return order.subtotal.sub(order.discountTotal).toDecimalPlaces(2);
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
    "ORDER_CONCURRENCY_RETRY_EXHAUSTED",
    "Order operation could not complete after concurrent updates.",
  );
}

export async function createCustomerOrder(
  actor: SessionUser,
  input: CreateCustomerOrderInput,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const parsed = createCustomerOrderInputSchema.parse(input);

  const existing = await prisma.customerOrder.findUnique({
    where: { createIdempotencyKey: parsed.idempotencyKey },
    include: orderInclude,
  });

  if (existing) {
    const same =
      existing.customerId === parsed.customerId &&
      existing.addressText === parsed.addressText &&
      existing.deliveryCharge.equals(parsed.deliveryCharge) &&
      JSON.stringify(commandItems(existing.items)) ===
        JSON.stringify(commandItems(parsed.items));

    if (!same) {
      throw new BusinessError(
        "IDEMPOTENCY_CONFLICT",
        "That order idempotency key was already used differently.",
      );
    }

    return existing;
  }

  return retrySerializable(() =>
    prisma.$transaction(
      async (tx) => {
        const [store, customer] = await Promise.all([
          tx.location.findFirst({
            where: {
              code: "STORE_MAIN",
              type: LocationType.STORE,
              active: true,
            },
          }),
          tx.customer.findUnique({
            where: { id: parsed.customerId },
          }),
        ]);

        if (!store) {
          throw new BusinessError(
            "STORE_NOT_FOUND",
            "The V1 store is not available.",
          );
        }

        if (!customer || !customer.active) {
          throw new BusinessError(
            "CUSTOMER_NOT_AVAILABLE",
            "Selected customer is unavailable.",
          );
        }

        const productIds = parsed.items.map((item) => item.productId);
        const products = await tx.product.findMany({
          where: {
            id: { in: productIds },
          },
        });

        if (products.length !== productIds.length) {
          throw new BusinessError(
            "PRODUCT_NOT_AVAILABLE",
            "Every order item must reference an existing product.",
          );
        }

        const productById = new Map(
          products.map((product) => [product.id, product]),
        );

        let subtotal = new Prisma.Decimal(0);
        const prepared = parsed.items.map((item) => {
          const product = productById.get(item.productId);

          if (!product || !product.active) {
            throw new BusinessError(
              "PRODUCT_NOT_AVAILABLE",
              "Inactive products cannot be ordered.",
            );
          }

          const quantity = new Prisma.Decimal(item.quantity);
          const unitPrice = product.sellingPrice;
          const lineTotal = unitPrice.mul(quantity).toDecimalPlaces(2);
          subtotal = subtotal.add(lineTotal);

          return {
            productId: product.id,
            skuSnapshot: product.sku,
            productNameSnapshot: product.name,
            quantity,
            unitPrice,
            discountAmount: new Prisma.Decimal(0),
            lineTotal,
          };
        });

        subtotal = subtotal.toDecimalPlaces(2);
        const discountTotal = new Prisma.Decimal(0);
        const deliveryCharge = new Prisma.Decimal(parsed.deliveryCharge);
        const total = subtotal.sub(discountTotal).add(deliveryCharge);

        const order = await tx.customerOrder.create({
          data: {
            orderNumber: buildOrderNumber(new Date()),
            customerId: customer.id,
            storeLocationId: store.id,
            status: CustomerOrderStatus.NEW,
            phoneSnapshot: customer.phoneDisplay,
            addressText: parsed.addressText,
            subtotal,
            discountTotal,
            deliveryCharge,
            total,
            paymentMethod: PaymentMethod.COD,
            paymentStatus: PaymentStatus.PENDING,
            notes: parsed.notes,
            createdByUserId: actor.id,
            createIdempotencyKey: parsed.idempotencyKey,
            items: {
              create: prepared,
            },
          },
          include: orderInclude,
        });

        await tx.payment.create({
          data: {
            sourceType: PaymentSourceType.CUSTOMER_ORDER,
            sourceId: order.id,
            method: PaymentMethod.COD,
            status: PaymentStatus.PENDING,
            amount: total,
            collectedAt: null,
            refundedAmount: new Prisma.Decimal(0),
            idempotencyKey: `cod-payment:${order.id}`,
            recordedByUserId: actor.id,
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: "COD_ORDER_CREATED",
            entityType: "CustomerOrder",
            entityId: order.id,
            afterData: {
              orderNumber: order.orderNumber,
              status: order.status,
              customerId: order.customerId,
              total: order.total.toFixed(2),
              paymentStatus: order.paymentStatus,
              itemCount: order.items.length,
            },
          },
        });

        return order;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function confirmCustomerOrder(
  actor: SessionUser,
  orderId: string,
  input: OrderCommandInput,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const parsed = orderCommandSchema.parse(input);

  return retrySerializable(() =>
    prisma.$transaction(
      async (tx) => {
        const order = await tx.customerOrder.findUnique({
          where: { id: orderId },
          include: orderInclude,
        });

        if (!order) {
          throw new BusinessError("ORDER_NOT_FOUND", "Order not found.");
        }

        if (
          order.confirmIdempotencyKey === parsed.idempotencyKey &&
          order.status !== CustomerOrderStatus.NEW
        ) {
          return order;
        }

        if (order.status !== CustomerOrderStatus.NEW) {
          throw new BusinessError(
            "INVALID_STATE_TRANSITION",
            "Only a NEW order can be confirmed.",
          );
        }

        if (order.confirmIdempotencyKey) {
          throw new BusinessError(
            "IDEMPOTENCY_CONFLICT",
            "This order already has a different confirmation command.",
          );
        }

        for (const item of order.items) {
          const balance = await tx.stockBalance.findUnique({
            where: {
              productId_locationId: {
                productId: item.productId,
                locationId: order.storeLocationId,
              },
            },
          });

          const onHand = balance?.onHand ?? new Prisma.Decimal(0);
          const reserved = balance?.reserved ?? new Prisma.Decimal(0);
          const available = onHand.sub(reserved);

          if (available.lessThan(item.quantity)) {
            throw new BusinessError(
              "INSUFFICIENT_STOCK",
              `Insufficient store stock for ${item.skuSnapshot}.`,
            );
          }

          await tx.inventoryReservation.create({
            data: {
              productId: item.productId,
              locationId: order.storeLocationId,
              sourceType: ReservationSourceType.CUSTOMER_ORDER,
              sourceId: order.id,
              quantity: item.quantity,
              status: ReservationStatus.ACTIVE,
              idempotencyKey: `cod-confirm:${parsed.idempotencyKey}:${item.productId}`,
            },
          });

          await tx.stockBalance.upsert({
            where: {
              productId_locationId: {
                productId: item.productId,
                locationId: order.storeLocationId,
              },
            },
            create: {
              productId: item.productId,
              locationId: order.storeLocationId,
              onHand,
              reserved: item.quantity,
            },
            update: {
              reserved: reserved.add(item.quantity),
            },
          });
        }

        const now = new Date();
        const updated = await tx.customerOrder.update({
          where: { id: order.id },
          data: {
            status: CustomerOrderStatus.CONFIRMED,
            confirmedAt: now,
            confirmIdempotencyKey: parsed.idempotencyKey,
          },
          include: orderInclude,
        });

        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: "COD_ORDER_CONFIRMED",
            entityType: "CustomerOrder",
            entityId: order.id,
            beforeData: { status: order.status },
            afterData: {
              status: updated.status,
              confirmedAt: now.toISOString(),
            },
          },
        });

        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function packCustomerOrder(
  actor: SessionUser,
  orderId: string,
  input: OrderCommandInput,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const parsed = orderCommandSchema.parse(input);

  return retrySerializable(() =>
    prisma.$transaction(
      async (tx) => {
        const order = await tx.customerOrder.findUnique({
          where: { id: orderId },
          include: orderInclude,
        });

        if (!order) {
          throw new BusinessError("ORDER_NOT_FOUND", "Order not found.");
        }

        if (
          order.packIdempotencyKey === parsed.idempotencyKey &&
          (order.status === CustomerOrderStatus.PACKED ||
            order.status === CustomerOrderStatus.DISPATCHED ||
            order.status === CustomerOrderStatus.DELIVERED)
        ) {
          return order;
        }

        if (order.status !== CustomerOrderStatus.CONFIRMED) {
          throw new BusinessError(
            "INVALID_STATE_TRANSITION",
            "Only a CONFIRMED order can be packed.",
          );
        }

        const activeReservations = order.reservations.filter(
          (reservation) => reservation.status === ReservationStatus.ACTIVE,
        );

        if (activeReservations.length !== order.items.length) {
          throw new BusinessError(
            "RESERVATION_INTEGRITY_ERROR",
            "Confirmed order does not have the expected active reservations.",
          );
        }

        const now = new Date();
        const updated = await tx.customerOrder.update({
          where: { id: order.id },
          data: {
            status: CustomerOrderStatus.PACKED,
            packedAt: now,
            packIdempotencyKey: parsed.idempotencyKey,
          },
          include: orderInclude,
        });

        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: "COD_ORDER_PACKED",
            entityType: "CustomerOrder",
            entityId: order.id,
            beforeData: { status: order.status },
            afterData: { status: updated.status, packedAt: now.toISOString() },
          },
        });

        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function dispatchCustomerOrder(
  actor: SessionUser,
  orderId: string,
  input: OrderCommandInput,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const parsed = orderCommandSchema.parse(input);

  return retrySerializable(() =>
    prisma.$transaction(
      async (tx) => {
        const order = await tx.customerOrder.findUnique({
          where: { id: orderId },
          include: orderInclude,
        });

        if (!order) {
          throw new BusinessError("ORDER_NOT_FOUND", "Order not found.");
        }

        if (
          order.dispatchIdempotencyKey === parsed.idempotencyKey &&
          (order.status === CustomerOrderStatus.DISPATCHED ||
            order.status === CustomerOrderStatus.DELIVERED)
        ) {
          return order;
        }

        if (order.status !== CustomerOrderStatus.PACKED) {
          throw new BusinessError(
            "INVALID_STATE_TRANSITION",
            "Only a PACKED order can be dispatched.",
          );
        }

        const reservationByProduct = new Map(
          order.reservations.map((reservation) => [
            reservation.productId,
            reservation,
          ]),
        );

        const now = new Date();

        for (const item of order.items) {
          const reservation = reservationByProduct.get(item.productId);

          if (
            !reservation ||
            reservation.status !== ReservationStatus.ACTIVE ||
            !reservation.quantity.equals(item.quantity)
          ) {
            throw new BusinessError(
              "RESERVATION_INTEGRITY_ERROR",
              "Order reservation is missing or invalid.",
            );
          }

          const balance = await tx.stockBalance.findUnique({
            where: {
              productId_locationId: {
                productId: item.productId,
                locationId: order.storeLocationId,
              },
            },
          });

          if (!balance || balance.reserved.lessThan(item.quantity)) {
            throw new BusinessError(
              "RESERVATION_INTEGRITY_ERROR",
              "Store reserved balance is lower than this order reservation.",
            );
          }

          await tx.stockBalance.update({
            where: {
              productId_locationId: {
                productId: item.productId,
                locationId: order.storeLocationId,
              },
            },
            data: {
              reserved: balance.reserved.sub(item.quantity),
            },
          });

          await recordPhysicalInventoryMovement(tx, {
            productId: item.productId,
            locationId: order.storeLocationId,
            type: InventoryMovementType.COD_DISPATCH,
            quantityDelta: item.quantity.negated(),
            referenceType: "CUSTOMER_ORDER",
            referenceId: order.id,
            idempotencyKey: `cod-dispatch:${parsed.idempotencyKey}:${item.productId}`,
            reason: `COD dispatch ${order.orderNumber}`,
            actorUserId: actor.id,
          });

          await tx.inventoryReservation.update({
            where: { id: reservation.id },
            data: {
              status: ReservationStatus.CONSUMED,
              consumedAt: now,
            },
          });
        }

        const updated = await tx.customerOrder.update({
          where: { id: order.id },
          data: {
            status: CustomerOrderStatus.DISPATCHED,
            dispatchedAt: now,
            dispatchIdempotencyKey: parsed.idempotencyKey,
          },
          include: orderInclude,
        });

        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: "COD_ORDER_DISPATCHED",
            entityType: "CustomerOrder",
            entityId: order.id,
            beforeData: { status: order.status },
            afterData: {
              status: updated.status,
              dispatchedAt: now.toISOString(),
            },
          },
        });

        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function deliverCustomerOrder(
  actor: SessionUser,
  orderId: string,
  input: OrderCommandInput,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const parsed = orderCommandSchema.parse(input);

  return retrySerializable(() =>
    prisma.$transaction(
      async (tx) => {
        const order = await tx.customerOrder.findUnique({
          where: { id: orderId },
          include: orderInclude,
        });

        if (!order) {
          throw new BusinessError("ORDER_NOT_FOUND", "Order not found.");
        }

        if (
          order.deliverIdempotencyKey === parsed.idempotencyKey &&
          order.status === CustomerOrderStatus.DELIVERED
        ) {
          return order;
        }

        if (order.status !== CustomerOrderStatus.DISPATCHED) {
          throw new BusinessError(
            "INVALID_STATE_TRANSITION",
            "Only a DISPATCHED order can be delivered.",
          );
        }

        const payment = await paymentForOrder(tx, order.id);

        if (!payment) {
          throw new BusinessError(
            "PAYMENT_INTEGRITY_ERROR",
            "COD order is missing its payment record.",
          );
        }

        if (
          payment.method !== PaymentMethod.COD ||
          payment.status !== PaymentStatus.PENDING ||
          payment.collectedAt !== null
        ) {
          throw new BusinessError(
            "PAYMENT_INTEGRITY_ERROR",
            "COD payment is not in the expected pending state.",
          );
        }

        const now = new Date();

        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.PAID,
            collectedAt: now,
          },
        });

        const eligibleSpend = eligibleOrderSpend(order);
        const loyaltyTransaction = eligibleSpend.greaterThan(0)
          ? await applyEligibleSpend(tx, {
              customerId: order.customerId,
              eligibleSpend,
              sourceType: LoyaltySourceType.CUSTOMER_ORDER,
              sourceId: order.id,
              idempotencyKey: `loyalty-order:${order.id}`,
              actorUserId: actor.id,
              reason: `Delivered COD order ${order.orderNumber}`,
            })
          : null;

        const updated = await tx.customerOrder.update({
          where: { id: order.id },
          data: {
            status: CustomerOrderStatus.DELIVERED,
            paymentStatus: PaymentStatus.PAID,
            deliveredAt: now,
            deliverIdempotencyKey: parsed.idempotencyKey,
          },
          include: orderInclude,
        });

        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: "COD_ORDER_DELIVERED",
            entityType: "CustomerOrder",
            entityId: order.id,
            beforeData: {
              status: order.status,
              paymentStatus: order.paymentStatus,
            },
            afterData: {
              status: updated.status,
              paymentStatus: updated.paymentStatus,
              deliveredAt: now.toISOString(),
              loyaltyPointsEarned: loyaltyTransaction?.pointsDelta ?? 0,
            },
          },
        });

        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function cancelCustomerOrder(
  actor: SessionUser,
  orderId: string,
  input: OrderCommandInput,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const parsed = orderCommandSchema.parse(input);

  return retrySerializable(() =>
    prisma.$transaction(
      async (tx) => {
        const order = await tx.customerOrder.findUnique({
          where: { id: orderId },
          include: orderInclude,
        });

        if (!order) {
          throw new BusinessError("ORDER_NOT_FOUND", "Order not found.");
        }

        if (
          order.cancelIdempotencyKey === parsed.idempotencyKey &&
          order.status === CustomerOrderStatus.CANCELLED
        ) {
          return order;
        }

        if (
          !(
            order.status === CustomerOrderStatus.NEW ||
            order.status === CustomerOrderStatus.CONFIRMED ||
            order.status === CustomerOrderStatus.PACKED
          )
        ) {
          throw new BusinessError(
            "INVALID_STATE_TRANSITION",
            "Only NEW, CONFIRMED, or PACKED orders can be cancelled.",
          );
        }

        const now = new Date();

        for (const reservation of order.reservations) {
          if (reservation.status !== ReservationStatus.ACTIVE) {
            continue;
          }

          const balance = await tx.stockBalance.findUniqueOrThrow({
            where: {
              productId_locationId: {
                productId: reservation.productId,
                locationId: reservation.locationId,
              },
            },
          });

          if (balance.reserved.lessThan(reservation.quantity)) {
            throw new BusinessError(
              "RESERVATION_INTEGRITY_ERROR",
              "Reserved balance is lower than the active order reservation.",
            );
          }

          await tx.stockBalance.update({
            where: {
              productId_locationId: {
                productId: reservation.productId,
                locationId: reservation.locationId,
              },
            },
            data: {
              reserved: balance.reserved.sub(reservation.quantity),
            },
          });

          await tx.inventoryReservation.update({
            where: { id: reservation.id },
            data: {
              status: ReservationStatus.RELEASED,
              releasedAt: now,
            },
          });
        }

        const updated = await tx.customerOrder.update({
          where: { id: order.id },
          data: {
            status: CustomerOrderStatus.CANCELLED,
            cancelledAt: now,
            cancelIdempotencyKey: parsed.idempotencyKey,
          },
          include: orderInclude,
        });

        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: "COD_ORDER_CANCELLED",
            entityType: "CustomerOrder",
            entityId: order.id,
            beforeData: { status: order.status },
            afterData: {
              status: updated.status,
              cancelledAt: now.toISOString(),
            },
          },
        });

        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function getCustomerOrderById(orderId: string) {
  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    include: orderInclude,
  });

  if (!order) {
    return null;
  }

  const [payment, loyaltyTransaction] = await Promise.all([
    prisma.payment.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: PaymentSourceType.CUSTOMER_ORDER,
          sourceId: order.id,
        },
      },
    }),
    prisma.loyaltyTransaction.findUnique({
      where: {
        idempotencyKey: `loyalty-order:${order.id}`,
      },
    }),
  ]);

  return { order, payment, loyaltyTransaction };
}

export async function getCustomerOrderPage(page = 1, pageSize = 30) {
  const normalizedPage = Math.max(1, page);
  const normalizedPageSize = Math.min(Math.max(pageSize, 1), 100);

  const [orders, total] = await Promise.all([
    prisma.customerOrder.findMany({
      orderBy: { createdAt: "desc" },
      skip: (normalizedPage - 1) * normalizedPageSize,
      take: normalizedPageSize,
      include: orderInclude,
    }),
    prisma.customerOrder.count(),
  ]);

  return {
    orders,
    total,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    totalPages: Math.max(1, Math.ceil(total / normalizedPageSize)),
  };
}

export async function getOrderCatalog() {
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
    where: { active: true },
    orderBy: { name: "asc" },
    include: {
      stockBalances: {
        where: { locationId: store.id },
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
