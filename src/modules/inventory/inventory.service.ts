import {
  InventoryMovementType,
  Prisma,
  Role,
} from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth/session";
import { assertRole } from "@/lib/auth/authorization";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import {
  adjustmentInputSchema,
  type AdjustmentInput,
} from "@/modules/inventory/inventory.schemas";

export async function adjustInventory(
  actor: SessionUser,
  input: AdjustmentInput,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN]);
  const parsed = adjustmentInputSchema.parse(input);
  const quantity = new Prisma.Decimal(parsed.quantity);
  const delta = parsed.direction === "IN" ? quantity : quantity.negated();
  const movementType =
    parsed.direction === "IN"
      ? InventoryMovementType.ADJUSTMENT_IN
      : InventoryMovementType.ADJUSTMENT_OUT;

  return prisma.$transaction(
    async (tx) => {
      const existingMovement = await tx.inventoryMovement.findUnique({
        where: { idempotencyKey: parsed.idempotencyKey },
      });

      if (existingMovement) {
        const sameCommand =
          existingMovement.productId === parsed.productId &&
          existingMovement.locationId === parsed.locationId &&
          existingMovement.type === movementType &&
          existingMovement.quantityDelta.equals(delta) &&
          existingMovement.reason === parsed.reason;

        if (!sameCommand) {
          throw new BusinessError(
            "IDEMPOTENCY_CONFLICT",
            "That idempotency key was already used for a different adjustment.",
          );
        }

        return existingMovement;
      }

      const product = await tx.product.findUnique({
        where: { id: parsed.productId },
      });
      const location = await tx.location.findUnique({
        where: { id: parsed.locationId },
      });
      const balance = await tx.stockBalance.findUnique({
        where: {
          productId_locationId: {
            productId: parsed.productId,
            locationId: parsed.locationId,
          },
        },
      });

      if (!product) {
        throw new BusinessError("PRODUCT_NOT_FOUND", "Product not found.");
      }

      if (!location || !location.active) {
        throw new BusinessError("LOCATION_NOT_FOUND", "Active location not found.");
      }

      const currentOnHand = balance?.onHand ?? new Prisma.Decimal(0);
      const currentReserved = balance?.reserved ?? new Prisma.Decimal(0);
      const nextOnHand = currentOnHand.add(delta);

      if (nextOnHand.isNegative()) {
        throw new BusinessError(
          "INSUFFICIENT_STOCK",
          "Adjustment would make physical stock negative.",
        );
      }

      if (nextOnHand.lessThan(currentReserved)) {
        throw new BusinessError(
          "RESERVED_STOCK_CONFLICT",
          "Adjustment would reduce stock below the reserved quantity.",
        );
      }

      const referenceId = crypto.randomUUID();

      const movement = await tx.inventoryMovement.create({
        data: {
          productId: parsed.productId,
          locationId: parsed.locationId,
          type: movementType,
          quantityDelta: delta,
          referenceType: "STOCK_ADJUSTMENT",
          referenceId,
          idempotencyKey: parsed.idempotencyKey,
          reason: parsed.reason,
          actorUserId: actor.id,
        },
      });

      await tx.stockBalance.upsert({
        where: {
          productId_locationId: {
            productId: parsed.productId,
            locationId: parsed.locationId,
          },
        },
        create: {
          productId: parsed.productId,
          locationId: parsed.locationId,
          onHand: nextOnHand,
          reserved: currentReserved,
        },
        update: {
          onHand: nextOnHand,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: parsed.direction === "IN" ? "STOCK_ADJUSTMENT_IN" : "STOCK_ADJUSTMENT_OUT",
          entityType: "InventoryMovement",
          entityId: movement.id,
          beforeData: {
            onHand: currentOnHand.toString(),
            reserved: currentReserved.toString(),
          },
          afterData: {
            onHand: nextOnHand.toString(),
            reserved: currentReserved.toString(),
          },
          metadata: {
            productId: parsed.productId,
            locationId: parsed.locationId,
            reason: parsed.reason,
            referenceId,
          },
        },
      });

      return movement;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

export async function getInventoryRows({
  search = "",
  page = 1,
  pageSize = 40,
  locationTypes,
}: {
  search?: string;
  page?: number;
  pageSize?: number;
  locationTypes?: Array<"WAREHOUSE" | "STORE">;
} = {}) {
  const normalizedPage = Math.max(1, page);
  const normalizedPageSize = Math.min(Math.max(pageSize, 1), 100);
  const productWhere: Prisma.ProductWhereInput = search
    ? {
        OR: [
          { sku: { contains: search, mode: "insensitive" } },
          { name: { contains: search, mode: "insensitive" } },
          { barcode: { contains: search, mode: "insensitive" } },
        ],
      }
    : {};

  const locationWhere: Prisma.LocationWhereInput = {
    active: true,
    ...(locationTypes?.length
      ? {
          type: {
            in: locationTypes,
          },
        }
      : {}),
  };

  const [locations, totalProducts, products] = await Promise.all([
    prisma.location.findMany({
      where: locationWhere,
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    prisma.product.count({ where: productWhere }),
    prisma.product.findMany({
      where: productWhere,
      orderBy: [{ active: "desc" }, { name: "asc" }],
      skip: (normalizedPage - 1) * normalizedPageSize,
      take: normalizedPageSize,
      include: {
        stockBalances: {
          include: {
            location: true,
          },
        },
      },
    }),
  ]);

  const rows = products.flatMap((product) =>
    locations.map((location) => {
      const balance = product.stockBalances.find(
        (item) => item.locationId === location.id,
      );
      const onHand = balance?.onHand ?? new Prisma.Decimal(0);
      const reserved = balance?.reserved ?? new Prisma.Decimal(0);

      return {
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        active: product.active,
        locationId: location.id,
        locationCode: location.code,
        locationName: location.name,
        locationType: location.type,
        onHand,
        reserved,
        available: onHand.sub(reserved),
        minimumStock:
          location.type === "WAREHOUSE"
            ? product.warehouseMinStock
            : product.storeMinStock,
      };
    }),
  );

  return {
    rows,
    totalProducts,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    totalPages: Math.max(1, Math.ceil(totalProducts / normalizedPageSize)),
  };
}

export async function getMovementPage({
  search = "",
  page = 1,
  pageSize = 50,
  locationTypes,
}: {
  search?: string;
  page?: number;
  pageSize?: number;
  locationTypes?: Array<"WAREHOUSE" | "STORE">;
} = {}) {
  const normalizedPage = Math.max(1, page);
  const normalizedPageSize = Math.min(Math.max(pageSize, 1), 100);
  const where: Prisma.InventoryMovementWhereInput = {
    ...(search
      ? {
          product: {
            OR: [
              { sku: { contains: search, mode: "insensitive" } },
              { name: { contains: search, mode: "insensitive" } },
            ],
          },
        }
      : {}),
    ...(locationTypes?.length
      ? {
          location: {
            type: {
              in: locationTypes,
            },
          },
        }
      : {}),
  };

  const [movements, total] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where,
      skip: (normalizedPage - 1) * normalizedPageSize,
      take: normalizedPageSize,
      orderBy: { createdAt: "desc" },
      include: {
        product: {
          select: {
            sku: true,
            name: true,
          },
        },
        location: {
          select: {
            code: true,
            name: true,
            type: true,
          },
        },
        actor: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    }),
    prisma.inventoryMovement.count({ where }),
  ]);

  return {
    movements,
    total,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    totalPages: Math.max(1, Math.ceil(total / normalizedPageSize)),
  };
}

export async function getRecentMovements(limit = 100) {
  return prisma.inventoryMovement.findMany({
    take: Math.min(Math.max(limit, 1), 250),
    orderBy: { createdAt: "desc" },
    include: {
      product: {
        select: {
          sku: true,
          name: true,
        },
      },
      location: {
        select: {
          code: true,
          name: true,
          type: true,
        },
      },
      actor: {
        select: {
          name: true,
          email: true,
        },
      },
    },
  });
}

export async function reconcileInventoryBalance(
  productId: string,
  locationId: string,
) {
  const [balance, aggregate] = await Promise.all([
    prisma.stockBalance.findUnique({
      where: {
        productId_locationId: {
          productId,
          locationId,
        },
      },
    }),
    prisma.inventoryMovement.aggregate({
      where: {
        productId,
        locationId,
      },
      _sum: {
        quantityDelta: true,
      },
    }),
  ]);

  const projectedOnHand = balance?.onHand ?? new Prisma.Decimal(0);
  const ledgerOnHand =
    aggregate._sum.quantityDelta ?? new Prisma.Decimal(0);

  return {
    projectedOnHand,
    ledgerOnHand,
    matches: projectedOnHand.equals(ledgerOnHand),
  };
}


export async function recordPhysicalInventoryMovement(
  tx: Prisma.TransactionClient,
  input: {
    productId: string;
    locationId: string;
    type: InventoryMovementType;
    quantityDelta: Prisma.Decimal;
    referenceType: string;
    referenceId: string;
    idempotencyKey: string;
    reason?: string | null;
    actorUserId: string;
  },
) {
  if (input.quantityDelta.isZero()) {
    throw new BusinessError(
      "INVALID_INVENTORY_MOVEMENT",
      "Inventory movement quantity cannot be zero.",
    );
  }

  const balance = await tx.stockBalance.findUnique({
    where: {
      productId_locationId: {
        productId: input.productId,
        locationId: input.locationId,
      },
    },
  });

  const currentOnHand = balance?.onHand ?? new Prisma.Decimal(0);
  const currentReserved = balance?.reserved ?? new Prisma.Decimal(0);
  const nextOnHand = currentOnHand.add(input.quantityDelta);

  if (nextOnHand.isNegative()) {
    throw new BusinessError(
      "INSUFFICIENT_STOCK",
      "Inventory movement would make physical stock negative.",
    );
  }

  if (nextOnHand.lessThan(currentReserved)) {
    throw new BusinessError(
      "RESERVED_STOCK_CONFLICT",
      "Inventory movement would reduce stock below reserved quantity.",
    );
  }

  const movement = await tx.inventoryMovement.create({
    data: {
      productId: input.productId,
      locationId: input.locationId,
      type: input.type,
      quantityDelta: input.quantityDelta,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason ?? null,
      actorUserId: input.actorUserId,
    },
  });

  await tx.stockBalance.upsert({
    where: {
      productId_locationId: {
        productId: input.productId,
        locationId: input.locationId,
      },
    },
    create: {
      productId: input.productId,
      locationId: input.locationId,
      onHand: nextOnHand,
      reserved: currentReserved,
    },
    update: {
      onHand: nextOnHand,
    },
  });

  return {
    movement,
    before: {
      onHand: currentOnHand,
      reserved: currentReserved,
    },
    after: {
      onHand: nextOnHand,
      reserved: currentReserved,
    },
  };
}
