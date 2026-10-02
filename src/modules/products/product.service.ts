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
    return await prisma.product.create({ data });
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
          beforeData: {
            sku: existing.sku,
            barcode: existing.barcode,
            name: existing.name,
            category: existing.category,
            unit: existing.unit,
            costPrice: existing.costPrice.toString(),
            sellingPrice: existing.sellingPrice.toString(),
            mrp: existing.mrp?.toString() ?? null,
            warehouseMinStock: existing.warehouseMinStock.toString(),
            storeMinStock: existing.storeMinStock.toString(),
            active: existing.active,
          },
          afterData: {
            sku: updated.sku,
            barcode: updated.barcode,
            name: updated.name,
            category: updated.category,
            unit: updated.unit,
            costPrice: updated.costPrice.toString(),
            sellingPrice: updated.sellingPrice.toString(),
            mrp: updated.mrp?.toString() ?? null,
            warehouseMinStock: updated.warehouseMinStock.toString(),
            storeMinStock: updated.storeMinStock.toString(),
            active: updated.active,
          },
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
