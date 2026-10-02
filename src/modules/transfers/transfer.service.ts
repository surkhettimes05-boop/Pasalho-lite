import {
  InventoryMovementType,
  LocationType,
  Prisma,
  Role,
  TransferStatus,
} from "@/generated/prisma/client";
import { assertRole } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import { recordPhysicalInventoryMovement } from "@/modules/inventory/inventory.service";
import {
  createTransferInputSchema,
  dispatchTransferInputSchema,
  receiveTransferInputSchema,
  type CreateTransferInput,
  type DispatchTransferInput,
  type ReceiveTransferInput,
} from "@/modules/transfers/transfer.schemas";

const transferInclude = {
  fromLocation: true,
  toLocation: true,
  createdBy: {
    select: {
      name: true,
      email: true,
    },
  },
  dispatchedBy: {
    select: {
      name: true,
      email: true,
    },
  },
  receivedBy: {
    select: {
      name: true,
      email: true,
    },
  },
  items: {
    include: {
      product: {
        select: {
          sku: true,
          barcode: true,
          name: true,
          unit: true,
          active: true,
        },
      },
    },
    orderBy: {
      product: {
        name: "asc",
      },
    },
  },
} satisfies Prisma.TransferInclude;

function buildTransferNumber(now: Date) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .replaceAll("-", "");

  return `TRF-${date}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

async function getV1Locations(tx: Prisma.TransactionClient) {
  const warehouse = await tx.location.findFirst({
    where: {
      code: "WAREHOUSE_MAIN",
      type: LocationType.WAREHOUSE,
      active: true,
    },
  });
  const store = await tx.location.findFirst({
    where: {
      code: "STORE_MAIN",
      type: LocationType.STORE,
      active: true,
    },
  });

  if (!warehouse) {
    throw new BusinessError(
      "WAREHOUSE_NOT_FOUND",
      "The V1 warehouse is not available.",
    );
  }

  if (!store) {
    throw new BusinessError(
      "STORE_NOT_FOUND",
      "The V1 store is not available.",
    );
  }

  return { warehouse, store };
}

function compareReceiveReplay(
  transfer: Prisma.TransferGetPayload<{ include: typeof transferInclude }>,
  input: ReceiveTransferInput,
) {
  if (transfer.items.length !== input.items.length) {
    return false;
  }

  const incoming = new Map(
    input.items.map((item) => [
      item.transferItemId,
      {
        quantity: new Prisma.Decimal(item.receivedQuantity).toString(),
        reason: item.discrepancyReason,
      },
    ]),
  );

  return transfer.items.every((item) => {
    const candidate = incoming.get(item.id);

    return (
      candidate &&
      item.receivedQuantity !== null &&
      item.receivedQuantity.toString() === candidate.quantity &&
      (item.discrepancyReason ?? null) === candidate.reason
    );
  });
}

export function transferItemInTransitQuantity(item: {
  dispatchedQuantity: Prisma.Decimal | null;
  receivedQuantity: Prisma.Decimal | null;
}, status: TransferStatus) {
  if (status !== TransferStatus.DISPATCHED) {
    return new Prisma.Decimal(0);
  }

  return item.dispatchedQuantity ?? new Prisma.Decimal(0);
}

export async function createTransfer(
  actor: SessionUser,
  input: CreateTransferInput,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.WAREHOUSE_STAFF]);
  const parsed = createTransferInputSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const { warehouse, store } = await getV1Locations(tx);
    const productIds = parsed.items.map((item) => item.productId);
    const activeProducts = await tx.product.findMany({
      where: {
        id: { in: productIds },
        active: true,
      },
      select: {
        id: true,
      },
    });

    if (activeProducts.length !== productIds.length) {
      throw new BusinessError(
        "PRODUCT_NOT_AVAILABLE",
        "Every transfer item must reference an active product.",
      );
    }

    const transfer = await tx.transfer.create({
      data: {
        transferNumber: buildTransferNumber(new Date()),
        fromLocationId: warehouse.id,
        toLocationId: store.id,
        status: TransferStatus.DRAFT,
        createdByUserId: actor.id,
        notes: parsed.notes,
        items: {
          create: parsed.items.map((item) => ({
            productId: item.productId,
            requestedQuantity: new Prisma.Decimal(item.requestedQuantity),
          })),
        },
      },
      include: transferInclude,
    });

    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: "TRANSFER_CREATED",
        entityType: "Transfer",
        entityId: transfer.id,
        afterData: {
          transferNumber: transfer.transferNumber,
          status: transfer.status,
          fromLocationId: warehouse.id,
          toLocationId: store.id,
          itemCount: transfer.items.length,
        },
      },
    });

    return transfer;
  });
}

export async function markTransferReady(
  actor: SessionUser,
  transferId: string,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.WAREHOUSE_STAFF]);

  return prisma.$transaction(async (tx) => {
    const transfer = await tx.transfer.findUnique({
      where: { id: transferId },
      include: transferInclude,
    });

    if (!transfer) {
      throw new BusinessError("TRANSFER_NOT_FOUND", "Transfer not found.");
    }

    if (transfer.status === TransferStatus.READY) {
      return transfer;
    }

    if (transfer.status !== TransferStatus.DRAFT) {
      throw new BusinessError(
        "INVALID_STATE_TRANSITION",
        "Only a draft transfer can be marked ready.",
      );
    }

    const activeProductCount = await tx.product.count({
      where: {
        id: { in: transfer.items.map((item) => item.productId) },
        active: true,
      },
    });

    if (activeProductCount !== transfer.items.length) {
      throw new BusinessError(
        "PRODUCT_NOT_AVAILABLE",
        "Every transfer item must still be active before the transfer is prepared.",
      );
    }

    const updated = await tx.transfer.update({
      where: { id: transferId },
      data: { status: TransferStatus.READY },
      include: transferInclude,
    });

    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: "TRANSFER_READY",
        entityType: "Transfer",
        entityId: transferId,
        beforeData: { status: transfer.status },
        afterData: { status: updated.status },
      },
    });

    return updated;
  });
}

export async function cancelTransfer(
  actor: SessionUser,
  transferId: string,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.WAREHOUSE_STAFF]);

  return prisma.$transaction(async (tx) => {
    const transfer = await tx.transfer.findUnique({
      where: { id: transferId },
      include: transferInclude,
    });

    if (!transfer) {
      throw new BusinessError("TRANSFER_NOT_FOUND", "Transfer not found.");
    }

    if (transfer.status === TransferStatus.CANCELLED) {
      return transfer;
    }

    if (
      transfer.status !== TransferStatus.DRAFT &&
      transfer.status !== TransferStatus.READY
    ) {
      throw new BusinessError(
        "INVALID_STATE_TRANSITION",
        "Only draft or ready transfers can be cancelled.",
      );
    }

    const updated = await tx.transfer.update({
      where: { id: transferId },
      data: { status: TransferStatus.CANCELLED },
      include: transferInclude,
    });

    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: "TRANSFER_CANCELLED",
        entityType: "Transfer",
        entityId: transferId,
        beforeData: { status: transfer.status },
        afterData: { status: updated.status },
      },
    });

    return updated;
  });
}

export async function dispatchTransfer(
  actor: SessionUser,
  transferId: string,
  input: DispatchTransferInput,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.WAREHOUSE_STAFF]);
  const parsed = dispatchTransferInputSchema.parse(input);

  return prisma.$transaction(
    async (tx) => {
      const keyOwner = await tx.transfer.findUnique({
        where: { dispatchIdempotencyKey: parsed.idempotencyKey },
        select: { id: true },
      });

      if (keyOwner && keyOwner.id !== transferId) {
        throw new BusinessError(
          "IDEMPOTENCY_CONFLICT",
          "That dispatch idempotency key belongs to another transfer.",
        );
      }

      const transfer = await tx.transfer.findUnique({
        where: { id: transferId },
        include: transferInclude,
      });

      if (!transfer) {
        throw new BusinessError("TRANSFER_NOT_FOUND", "Transfer not found.");
      }

      if (
        (transfer.status === TransferStatus.DISPATCHED ||
          transfer.status === TransferStatus.RECEIVED) &&
        transfer.dispatchIdempotencyKey === parsed.idempotencyKey
      ) {
        return transfer;
      }

      if (transfer.status !== TransferStatus.READY) {
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "Only a ready transfer can be dispatched.",
        );
      }

      if (transfer.dispatchIdempotencyKey) {
        throw new BusinessError(
          "IDEMPOTENCY_CONFLICT",
          "This transfer already has a different dispatch command.",
        );
      }

      for (const item of transfer.items) {
        const quantity = item.requestedQuantity;

        await recordPhysicalInventoryMovement(tx, {
          productId: item.productId,
          locationId: transfer.fromLocationId,
          type: InventoryMovementType.TRANSFER_OUT,
          quantityDelta: quantity.negated(),
          referenceType: "TRANSFER",
          referenceId: transfer.id,
          idempotencyKey: `transfer-dispatch:${parsed.idempotencyKey}:${item.id}`,
          reason: `Dispatch ${transfer.transferNumber}`,
          actorUserId: actor.id,
        });

        await tx.transferItem.update({
          where: { id: item.id },
          data: {
            dispatchedQuantity: quantity,
          },
        });
      }

      const now = new Date();
      const updated = await tx.transfer.update({
        where: { id: transferId },
        data: {
          status: TransferStatus.DISPATCHED,
          dispatchedAt: now,
          dispatchedByUserId: actor.id,
          dispatchIdempotencyKey: parsed.idempotencyKey,
        },
        include: transferInclude,
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: "TRANSFER_DISPATCHED",
          entityType: "Transfer",
          entityId: transfer.id,
          beforeData: { status: TransferStatus.READY },
          afterData: {
            status: updated.status,
            dispatchedAt: now.toISOString(),
            itemCount: updated.items.length,
          },
        },
      });

      return updated;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

export async function receiveTransfer(
  actor: SessionUser,
  transferId: string,
  input: ReceiveTransferInput,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const parsed = receiveTransferInputSchema.parse(input);

  return prisma.$transaction(
    async (tx) => {
      const keyOwner = await tx.transfer.findUnique({
        where: { receiveIdempotencyKey: parsed.idempotencyKey },
        select: { id: true },
      });

      if (keyOwner && keyOwner.id !== transferId) {
        throw new BusinessError(
          "IDEMPOTENCY_CONFLICT",
          "That receive idempotency key belongs to another transfer.",
        );
      }

      const transfer = await tx.transfer.findUnique({
        where: { id: transferId },
        include: transferInclude,
      });

      if (!transfer) {
        throw new BusinessError("TRANSFER_NOT_FOUND", "Transfer not found.");
      }

      if (
        transfer.status === TransferStatus.RECEIVED &&
        transfer.receiveIdempotencyKey === parsed.idempotencyKey
      ) {
        if (!compareReceiveReplay(transfer, parsed)) {
          throw new BusinessError(
            "IDEMPOTENCY_CONFLICT",
            "The replayed receive command differs from the completed receipt.",
          );
        }

        return transfer;
      }

      if (transfer.status !== TransferStatus.DISPATCHED) {
        throw new BusinessError(
          "INVALID_STATE_TRANSITION",
          "Only a dispatched transfer can be received.",
        );
      }

      if (transfer.receiveIdempotencyKey) {
        throw new BusinessError(
          "IDEMPOTENCY_CONFLICT",
          "This transfer already has a different receive command.",
        );
      }

      if (parsed.items.length !== transfer.items.length) {
        throw new BusinessError(
          "TRANSFER_ITEMS_MISMATCH",
          "Every dispatched transfer item must be counted at receipt.",
        );
      }

      const incomingById = new Map(
        parsed.items.map((item) => [item.transferItemId, item]),
      );

      for (const item of transfer.items) {
        const incoming = incomingById.get(item.id);

        if (!incoming || item.dispatchedQuantity === null) {
          throw new BusinessError(
            "TRANSFER_ITEMS_MISMATCH",
            "Every dispatched transfer item must be counted at receipt.",
          );
        }

        const received = new Prisma.Decimal(incoming.receivedQuantity);

        if (received.greaterThan(item.dispatchedQuantity)) {
          throw new BusinessError(
            "RECEIVED_EXCEEDS_DISPATCHED",
            "Received quantity cannot exceed dispatched quantity.",
          );
        }

        const differs = !received.equals(item.dispatchedQuantity);

        if (
          differs &&
          (!incoming.discrepancyReason ||
            incoming.discrepancyReason.trim().length < 3)
        ) {
          throw new BusinessError(
            "DISCREPANCY_REASON_REQUIRED",
            "A discrepancy reason is required when received quantity differs.",
          );
        }

        if (received.greaterThan(0)) {
          await recordPhysicalInventoryMovement(tx, {
            productId: item.productId,
            locationId: transfer.toLocationId,
            type: InventoryMovementType.TRANSFER_IN,
            quantityDelta: received,
            referenceType: "TRANSFER",
            referenceId: transfer.id,
            idempotencyKey: `transfer-receive:${parsed.idempotencyKey}:${item.id}`,
            reason: `Receive ${transfer.transferNumber}`,
            actorUserId: actor.id,
          });
        }

        await tx.transferItem.update({
          where: { id: item.id },
          data: {
            receivedQuantity: received,
            discrepancyReason: differs ? incoming.discrepancyReason : null,
          },
        });
      }

      const now = new Date();
      const updated = await tx.transfer.update({
        where: { id: transferId },
        data: {
          status: TransferStatus.RECEIVED,
          receivedAt: now,
          receivedByUserId: actor.id,
          receiveIdempotencyKey: parsed.idempotencyKey,
        },
        include: transferInclude,
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: "TRANSFER_RECEIVED",
          entityType: "Transfer",
          entityId: transfer.id,
          beforeData: { status: TransferStatus.DISPATCHED },
          afterData: {
            status: updated.status,
            receivedAt: now.toISOString(),
            discrepancyCount: updated.items.filter(
              (item) =>
                item.dispatchedQuantity !== null &&
                item.receivedQuantity !== null &&
                !item.dispatchedQuantity.equals(item.receivedQuantity),
            ).length,
          },
        },
      });

      return updated;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

export async function getTransferPage(page = 1, pageSize = 30) {
  const normalizedPage = Math.max(1, page);
  const normalizedPageSize = Math.min(Math.max(pageSize, 1), 100);

  const [transfers, total] = await Promise.all([
    prisma.transfer.findMany({
      orderBy: { createdAt: "desc" },
      skip: (normalizedPage - 1) * normalizedPageSize,
      take: normalizedPageSize,
      include: transferInclude,
    }),
    prisma.transfer.count(),
  ]);

  return {
    transfers,
    total,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    totalPages: Math.max(1, Math.ceil(total / normalizedPageSize)),
  };
}

export async function getTransferById(transferId: string) {
  return prisma.transfer.findUnique({
    where: { id: transferId },
    include: transferInclude,
  });
}
