import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CashMovementEffect,
  CashMovementType,
  PaymentMethod,
  ReturnSourceType,
  Role,
} from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { adjustInventory } from "@/modules/inventory/inventory.service";
import { finalizeSale } from "@/modules/pos/pos.service";
import { createProduct } from "@/modules/products/product.service";
import { processReturn } from "@/modules/returns/return.service";

const suffix = randomUUID().slice(0, 8);

let owner: SessionUser;
let cashier: SessionUser;
let productId: string;
let storeId: string;

beforeAll(async () => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: process.env.SEED_OWNER_EMAIL!.toLowerCase() },
  });

  owner = { id: user.id, name: user.name, email: user.email, role: user.role };
  cashier = { ...owner, role: Role.CASHIER_STORE };

  storeId = (
    await prisma.location.findUniqueOrThrow({ where: { code: "STORE_MAIN" } })
  ).id;

  productId = (
    await createProduct(owner, {
      sku: `P8REF-${suffix}`,
      barcode: `9988${suffix.replace(/\D/g, "").padEnd(6, "1").slice(0, 6)}`,
      name: "Phase 8 Refund Product",
      category: "Test",
      unit: "pcs",
      costPrice: "100.00",
      sellingPrice: "600.00",
      mrp: "650.00",
      warehouseMinStock: "0",
      storeMinStock: "0",
      active: true,
    })
  ).id;

  await adjustInventory(owner, {
    productId,
    locationId: storeId,
    direction: "IN",
    quantity: "5",
    reason: "Phase 8 refund test opening stock",
    idempotencyKey: `p8-refund-opening-${suffix}`,
  });
});

describe("Phase 8 refund cash integration", () => {
  it("posts exactly one REFUND_OUT for a cash refund and replay does not duplicate it", async () => {
    const sale = await finalizeSale(cashier, {
      idempotencyKey: `p8-refund-cash-sale-${suffix}`,
      paymentMethod: PaymentMethod.CASH,
      customerId: null,
      items: [{ productId, quantity: "1" }],
    });

    const key = `p8-refund-cash-return-${suffix}`;
    const result = await processReturn(cashier, {
      sourceType: ReturnSourceType.SALE,
      sourceId: sale.sale.id,
      reason: "Cash sale returned",
      idempotencyKey: key,
      items: [{
        originalLineId: sale.sale.items[0].id,
        quantity: "1",
        physicallyReturned: true,
        restockQuantity: "1",
      }],
    });

    const movement = await prisma.cashMovement.findFirstOrThrow({
      where: {
        referenceType: "RETURN",
        referenceId: result.id,
        type: CashMovementType.REFUND_OUT,
      },
    });

    expect(movement.effect).toBe(CashMovementEffect.OUT);
    expect(movement.amount.toFixed(2)).toBe("600.00");

    await processReturn(cashier, {
      sourceType: ReturnSourceType.SALE,
      sourceId: sale.sale.id,
      reason: "Cash sale returned",
      idempotencyKey: key,
      items: [{
        originalLineId: sale.sale.items[0].id,
        quantity: "1",
        physicallyReturned: true,
        restockQuantity: "1",
      }],
    });

    expect(
      await prisma.cashMovement.count({
        where: {
          referenceType: "RETURN",
          referenceId: result.id,
          type: CashMovementType.REFUND_OUT,
        },
      }),
    ).toBe(1);
  });

  it("does not post drawer cash movement for QR/non-cash refund", async () => {
    const sale = await finalizeSale(cashier, {
      idempotencyKey: `p8-refund-qr-sale-${suffix}`,
      paymentMethod: PaymentMethod.QR_NON_CASH,
      customerId: null,
      items: [{ productId, quantity: "1" }],
    });

    const result = await processReturn(cashier, {
      sourceType: ReturnSourceType.SALE,
      sourceId: sale.sale.id,
      reason: "QR sale returned",
      idempotencyKey: `p8-refund-qr-return-${suffix}`,
      items: [{
        originalLineId: sale.sale.items[0].id,
        quantity: "1",
        physicallyReturned: true,
        restockQuantity: "1",
      }],
    });

    expect(
      await prisma.cashMovement.count({
        where: {
          referenceType: "RETURN",
          referenceId: result.id,
        },
      }),
    ).toBe(0);
  });
});
