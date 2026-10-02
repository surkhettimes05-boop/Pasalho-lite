import {
  InventoryMovementType,
  LocationType,
  Prisma,
  PurchaseReceiptStatus,
  Role,
} from "@/generated/prisma/client";
import { assertRole } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import { recordPhysicalInventoryMovement } from "@/modules/inventory/inventory.service";
import {
  postReceiptInputSchema,
  type PostReceiptInput,
} from "@/modules/receiving/receipt.schemas";

function toComparableItems(
  items: Array<{
    productId: string;
    quantity: Prisma.Decimal | string;
    unitCost: Prisma.Decimal | string;
  }>,
) {
  return items
    .map((item) => ({
      productId: item.productId,
      quantity:
        item.quantity instanceof Prisma.Decimal
          ? item.quantity.toString()
          : new Prisma.Decimal(item.quantity).toString(),
      unitCost:
        item.unitCost instanceof Prisma.Decimal
          ? item.unitCost.toFixed(2)
          : new Prisma.Decimal(item.unitCost).toFixed(2),
    }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
}

function sameReceiptCommand(
  existing: {
    supplierId: string | null;
    supplierReference: string | null;
    notes: string | null;
    items: Array<{
      productId: string;
      quantity: Prisma.Decimal;
      unitCost: Prisma.Decimal;
    }>;
  },
  parsed: PostReceiptInput,
) {
  if (
    existing.supplierId !== parsed.supplierId ||
    existing.supplierReference !== parsed.supplierReference ||
    existing.notes !== parsed.notes
  ) {
    return false;
  }

  return (
    JSON.stringify(toComparableItems(existing.items)) ===
    JSON.stringify(toComparableItems(parsed.items))
  );
}

function buildReceiptNumber(now: Date) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .replaceAll("-", "");

  return `RCV-${date}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

async function findExistingReceipt(idempotencyKey: string) {
  return prisma.purchaseReceipt.findUnique({
    where: { idempotencyKey },
    include: {
      items: true,
    },
  });
}

export async function postPurchaseReceipt(
  actor: SessionUser,
  input: PostReceiptInput,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.WAREHOUSE_STAFF]);
  const parsed = postReceiptInputSchema.parse(input);

  const existing = await findExistingReceipt(parsed.idempotencyKey);

  if (existing) {
    if (!sameReceiptCommand(existing, parsed)) {
      throw new BusinessError(
        "IDEMPOTENCY_CONFLICT",
        "That idempotency key was already used for a different receipt.",
      );
    }

    return existing;
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        const supplier = await tx.supplier.findUnique({
          where: { id: parsed.supplierId },
        });

        if (!supplier || !supplier.active) {
          throw new BusinessError(
            "SUPPLIER_NOT_FOUND",
            "Active supplier not found.",
          );
        }

        const warehouse = await tx.location.findFirst({
          where: {
            code: "WAREHOUSE_MAIN",
            type: LocationType.WAREHOUSE,
            active: true,
          },
        });

        if (!warehouse) {
          throw new BusinessError(
            "WAREHOUSE_NOT_FOUND",
            "The V1 warehouse is not available.",
          );
        }

        const productIds = parsed.items.map((item) => item.productId);
        const products = await tx.product.findMany({
          where: {
            id: { in: productIds },
            active: true,
          },
          select: {
            id: true,
          },
        });

        if (products.length !== productIds.length) {
          throw new BusinessError(
            "PRODUCT_NOT_AVAILABLE",
            "Every receipt item must reference an active product.",
          );
        }

        const now = new Date();
        const receipt = await tx.purchaseReceipt.create({
          data: {
            receiptNumber: buildReceiptNumber(now),
            supplierId: parsed.supplierId,
            supplierReference: parsed.supplierReference,
            status: PurchaseReceiptStatus.POSTED,
            receivedAt: now,
            postedAt: now,
            postedByUserId: actor.id,
            notes: parsed.notes,
            idempotencyKey: parsed.idempotencyKey,
          },
        });

        for (const item of parsed.items) {
          const quantity = new Prisma.Decimal(item.quantity);
          const unitCost = new Prisma.Decimal(item.unitCost);
          const lineTotal = quantity.mul(unitCost).toDecimalPlaces(2);

          await tx.purchaseReceiptItem.create({
            data: {
              purchaseReceiptId: receipt.id,
              productId: item.productId,
              quantity,
              unitCost,
              lineTotal,
            },
          });

          await recordPhysicalInventoryMovement(tx, {
            productId: item.productId,
            locationId: warehouse.id,
            type: InventoryMovementType.PURCHASE_RECEIPT,
            quantityDelta: quantity,
            referenceType: "PURCHASE_RECEIPT",
            referenceId: receipt.id,
            idempotencyKey: `${parsed.idempotencyKey}:${item.productId}`,
            reason: `Receipt ${receipt.receiptNumber}`,
            actorUserId: actor.id,
          });
        }

        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: "PURCHASE_RECEIPT_POSTED",
            entityType: "PurchaseReceipt",
            entityId: receipt.id,
            afterData: {
              receiptNumber: receipt.receiptNumber,
              supplierId: receipt.supplierId,
              supplierReference: receipt.supplierReference,
              status: receipt.status,
              receivedAt: receipt.receivedAt.toISOString(),
              itemCount: parsed.items.length,
            },
            metadata: {
              warehouseId: warehouse.id,
              warehouseCode: warehouse.code,
            },
          },
        });

        return tx.purchaseReceipt.findUniqueOrThrow({
          where: { id: receipt.id },
          include: {
            items: true,
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const replay = await findExistingReceipt(parsed.idempotencyKey);

      if (replay) {
        if (!sameReceiptCommand(replay, parsed)) {
          throw new BusinessError(
            "IDEMPOTENCY_CONFLICT",
            "That idempotency key was already used for a different receipt.",
          );
        }

        return replay;
      }
    }

    throw error;
  }
}

export async function getReceiptPage(page = 1, pageSize = 30) {
  const normalizedPage = Math.max(1, page);
  const normalizedPageSize = Math.min(Math.max(pageSize, 1), 100);

  const [receipts, total] = await Promise.all([
    prisma.purchaseReceipt.findMany({
      orderBy: { receivedAt: "desc" },
      skip: (normalizedPage - 1) * normalizedPageSize,
      take: normalizedPageSize,
      include: {
        supplier: {
          select: {
            name: true,
          },
        },
        postedBy: {
          select: {
            name: true,
          },
        },
        items: {
          select: {
            lineTotal: true,
          },
        },
      },
    }),
    prisma.purchaseReceipt.count(),
  ]);

  return {
    receipts,
    total,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    totalPages: Math.max(1, Math.ceil(total / normalizedPageSize)),
  };
}
