import { Prisma, Role } from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth/session";
import { assertRole } from "@/lib/auth/authorization";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import {
  productInputSchema,
  type ProductInput,
} from "@/modules/products/product.schemas";

function normalizeProductInput(input: ProductInput) {
  const parsed = productInputSchema.parse(input);

  return {
    sku: parsed.sku,
    barcode: parsed.barcode,
    name: parsed.name,
    category: parsed.category,
    unit: parsed.unit,
    costPrice: new Prisma.Decimal(parsed.costPrice),
    sellingPrice: new Prisma.Decimal(parsed.sellingPrice),
    mrp: parsed.mrp === null ? null : new Prisma.Decimal(parsed.mrp),
    warehouseMinStock: new Prisma.Decimal(parsed.warehouseMinStock),
    storeMinStock: new Prisma.Decimal(parsed.storeMinStock),
    active: parsed.active,
  };
}

function productAuditSnapshot(product: {
  sku: string;
  barcode: string | null;
  name: string;
  category: string;
  unit: string;
  costPrice: Prisma.Decimal;
  sellingPrice: Prisma.Decimal;
  mrp: Prisma.Decimal | null;
  warehouseMinStock: Prisma.Decimal;
  storeMinStock: Prisma.Decimal;
  active: boolean;
}) {
  return {
    sku: product.sku,
    barcode: product.barcode,
    name: product.name,
    category: product.category,
    unit: product.unit,
    costPrice: product.costPrice.toString(),
    sellingPrice: product.sellingPrice.toString(),
    mrp: product.mrp?.toString() ?? null,
    warehouseMinStock: product.warehouseMinStock.toString(),
    storeMinStock: product.storeMinStock.toString(),
    active: product.active,
  };
}

function mapUniqueConstraint(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    const target = (
      Array.isArray(error.meta?.target)
        ? error.meta.target.join(",")
        : String(error.meta?.target ?? "")
    ).toLowerCase();

    const message = error.message.toLowerCase();

    if (target.includes("sku") || message.includes("product_sku_key")) {
      throw new BusinessError("SKU_EXISTS", "That SKU already exists.");
    }

    if (
      target.includes("barcode") ||
      message.includes("product_barcode_key")
    ) {
      throw new BusinessError(
        "BARCODE_EXISTS",
        "That barcode already exists.",
      );
    }
  }

  throw error;
}

export async function initializeProductZeroBalances(
  tx: Prisma.TransactionClient,
  productIds: readonly string[],
  locationIds?: readonly string[],
) {
  if (productIds.length === 0) return;

  const resolvedLocationIds =
    locationIds ??
    (
      await tx.location.findMany({
        where: { active: true },
        select: { id: true },
      })
    ).map((location) => location.id);

  if (resolvedLocationIds.length === 0) return;

  await tx.stockBalance.createMany({
    data: productIds.flatMap((productId) =>
      resolvedLocationIds.map((locationId) => ({
        productId,
        locationId,
        onHand: new Prisma.Decimal(0),
        reserved: new Prisma.Decimal(0),
      })),
    ),
    skipDuplicates: true,
  });
}

export async function createProduct(actor: SessionUser, input: ProductInput) {
  assertRole(actor.role, [Role.OWNER_ADMIN]);
  const data = normalizeProductInput(input);

  try {
    return await prisma.$transaction(async (tx) => {
      const existingSku = await tx.product.findUnique({
        where: { sku: data.sku },
        select: { id: true },
      });

      if (existingSku) {
        throw new BusinessError("SKU_EXISTS", "That SKU already exists.");
      }

      if (data.barcode) {
        const existingBarcode = await tx.product.findUnique({
          where: { barcode: data.barcode },
          select: { id: true },
        });

        if (existingBarcode) {
          throw new BusinessError(
            "BARCODE_EXISTS",
            "That barcode already exists.",
          );
        }
      }

      const created = await tx.product.create({ data });

      await initializeProductZeroBalances(tx, [created.id]);

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: "PRODUCT_CREATED",
          entityType: "Product",
          entityId: created.id,
          afterData: productAuditSnapshot(created),
        },
      });

      return created;
    });
  } catch (error) {
    return mapUniqueConstraint(error);
  }
}

export async function updateProduct(
  actor: SessionUser,
  productId: string,
  input: ProductInput,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN]);
  const data = normalizeProductInput(input);

  const existing = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!existing) {
    throw new BusinessError("PRODUCT_NOT_FOUND", "Product not found.");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const duplicateSku = await tx.product.findFirst({
        where: {
          sku: data.sku,
          id: { not: productId },
        },
        select: { id: true },
      });

      if (duplicateSku) {
        throw new BusinessError("SKU_EXISTS", "That SKU already exists.");
      }

      if (data.barcode) {
        const duplicateBarcode = await tx.product.findFirst({
          where: {
            barcode: data.barcode,
            id: { not: productId },
          },
          select: { id: true },
        });

        if (duplicateBarcode) {
          throw new BusinessError(
            "BARCODE_EXISTS",
            "That barcode already exists.",
          );
        }
      }

      const updated = await tx.product.update({
        where: { id: productId },
        data,
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: "PRODUCT_UPDATED",
          entityType: "Product",
          entityId: productId,
          beforeData: productAuditSnapshot(existing),
          afterData: productAuditSnapshot(updated),
        },
      });

      return updated;
    });
  } catch (error) {
    return mapUniqueConstraint(error);
  }
}

export async function setProductActive(
  actor: SessionUser,
  productId: string,
  active: boolean,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN]);

  const existing = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!existing) {
    throw new BusinessError("PRODUCT_NOT_FOUND", "Product not found.");
  }

  if (existing.active === active) {
    return existing;
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id: productId },
      data: { active },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: active ? "PRODUCT_ACTIVATED" : "PRODUCT_DEACTIVATED",
        entityType: "Product",
        entityId: productId,
        beforeData: { active: existing.active },
        afterData: { active },
      },
    });

    return updated;
  });
}
