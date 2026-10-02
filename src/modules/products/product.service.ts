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
    const target = Array.isArray(error.meta?.target)
      ? error.meta.target.join(",")
      : String(error.meta?.target ?? "");

    if (target.includes("sku")) {
      throw new BusinessError("SKU_EXISTS", "That SKU already exists.");
    }

    if (target.includes("barcode")) {
      throw new BusinessError("BARCODE_EXISTS", "That barcode already exists.");
    }
  }

  throw error;
}

export async function createProduct(actor: SessionUser, input: ProductInput) {
  assertRole(actor.role, [Role.OWNER_ADMIN]);
  const data = normalizeProductInput(input);

  try {
    return await prisma.$transaction(async (tx) => {
      const locations = await tx.location.findMany({
        where: { active: true },
        select: { id: true },
      });

      const created = await tx.product.create({ data });

      if (locations.length > 0) {
        await tx.stockBalance.createMany({
          data: locations.map((location) => ({
            productId: created.id,
            locationId: location.id,
            onHand: new Prisma.Decimal(0),
            reserved: new Prisma.Decimal(0),
          })),
        });
      }

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
