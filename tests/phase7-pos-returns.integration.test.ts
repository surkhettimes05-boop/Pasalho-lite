import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  PaymentMethod,
  PaymentSourceType,
  PaymentStatus,
  ReturnKind,
  ReturnSourceType,
  Role,
  SaleStatus,
} from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import { createCustomer } from "@/modules/customers/customer.service";
import {
  adjustInventory,
  reconcileInventoryBalance,
} from "@/modules/inventory/inventory.service";
import { reconcileLoyaltyAccount } from "@/modules/loyalty/loyalty.service";
import { finalizeSale } from "@/modules/pos/pos.service";
import { createProduct } from "@/modules/products/product.service";
import { processReturn } from "@/modules/returns/return.service";

const suffix = randomUUID().slice(0, 8);
const digits = suffix.replace(/\D/g, "").padEnd(8, "7").slice(0, 8);

let owner: SessionUser;
let cashier: SessionUser;
let productId: string;
let customerId: string;
let storeId: string;
let saleId: string;
let saleLineId: string;
let firstReturnId: string;

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
      sku: `P7POS-${suffix}`,
      barcode: `87${digits}`,
      name: "Phase 7 POS Return Product",
      category: "Test",
      unit: "pcs",
      costPrice: "300.00",
      sellingPrice: "600.00",
      mrp: "650.00",
      warehouseMinStock: "0",
      storeMinStock: "0",
      active: true,
    })
  ).id;

  customerId = (
    await createCustomer(cashier, {
      phone: `98${digits}`,
      name: "Phase 7 POS Customer",
      notes: "",
    })
  ).id;

  await adjustInventory(owner, {
    productId,
    locationId: storeId,
    direction: "IN",
    quantity: "10",
    reason: "Phase 7 POS test opening stock",
    idempotencyKey: `p7-pos-opening-${suffix}`,
  });

  const sale = await finalizeSale(cashier, {
    idempotencyKey: `p7-pos-sale-${suffix}`,
    paymentMethod: PaymentMethod.CASH,
    customerId,
    items: [{ productId, quantity: "2" }],
  });

  saleId = sale.sale.id;
  saleLineId = sale.sale.items[0].id;
});

async function stock() {
  return prisma.stockBalance.findUniqueOrThrow({
    where: {
      productId_locationId: {
        productId,
        locationId: storeId,
      },
    },
  });
}

async function payment() {
  return prisma.payment.findUniqueOrThrow({
    where: {
      sourceType_sourceId: {
        sourceType: PaymentSourceType.SALE,
        sourceId: saleId,
      },
    },
  });
}

describe("Phase 7 POS returns and refunds", () => {
  it("starts from finalized sale with stock 8 and loyalty 2 points / Rs 200 remainder", async () => {
    const balance = await stock();
    expect(balance.onHand.toString()).toBe("8");

    const loyalty = await prisma.loyaltyAccount.findUniqueOrThrow({
      where: { customerId },
    });
    expect(loyalty.pointBalance).toBe(2);
    expect(loyalty.spendRemainder.toFixed(2)).toBe("200.00");
  });

  it("returns one unit atomically: restock +1, refund Rs 600, loyalty reverses correctly", async () => {
    const result = await processReturn(cashier, {
      sourceType: ReturnSourceType.SALE,
      sourceId: saleId,
      reason: "Customer returned one sealed unit",
      idempotencyKey: `p7-pos-return-one-${suffix}`,
      items: [
        {
          originalLineId: saleLineId,
          quantity: "1",
          physicallyReturned: true,
          restockQuantity: "1",
        },
      ],
    });

    firstReturnId = result.id;

    expect(result.kind).toBe(ReturnKind.REFUND);
    expect(result.refundAmount.toFixed(2)).toBe("600.00");
    expect(result.items[0].refundAmount.toFixed(2)).toBe("600.00");
    expect(result.items[0].restockQuantity.toString()).toBe("1");

    expect((await stock()).onHand.toString()).toBe("9");

    const paid = await payment();
    expect(paid.refundedAmount.toFixed(2)).toBe("600.00");
    expect(paid.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);

    const sale = await prisma.sale.findUniqueOrThrow({
      where: { id: saleId },
    });
    expect(sale.status).toBe(SaleStatus.PARTIALLY_RETURNED);
    expect(sale.paymentStatus).toBe(PaymentStatus.PARTIALLY_REFUNDED);

    const loyalty = await prisma.loyaltyAccount.findUniqueOrThrow({
      where: { customerId },
    });
    expect(loyalty.pointBalance).toBe(1);
    expect(loyalty.spendRemainder.toFixed(2)).toBe("100.00");

    const reconciliation = await reconcileInventoryBalance(productId, storeId);
    expect(reconciliation.matches).toBe(true);

    const loyaltyReconciliation = await reconcileLoyaltyAccount(customerId);
    expect(loyaltyReconciliation.matches).toBe(true);
    expect(loyaltyReconciliation.ledgerEligibleSpend.toFixed(2)).toBe("600.00");
  });

  it("replays the same return with zero duplicate effects", async () => {
    const replay = await processReturn(cashier, {
      sourceType: ReturnSourceType.SALE,
      sourceId: saleId,
      reason: "Customer returned one sealed unit",
      idempotencyKey: `p7-pos-return-one-${suffix}`,
      items: [
        {
          originalLineId: saleLineId,
          quantity: "1",
          physicallyReturned: true,
          restockQuantity: "1",
        },
      ],
    });

    expect(replay.id).toBe(firstReturnId);
    expect((await stock()).onHand.toString()).toBe("9");
    expect((await payment()).refundedAmount.toFixed(2)).toBe("600.00");

    expect(
      await prisma.returnRecord.count({
        where: { idempotencyKey: `p7-pos-return-one-${suffix}` },
      }),
    ).toBe(1);

    expect(
      await prisma.inventoryMovement.count({
        where: {
          referenceType: "RETURN",
          referenceId: firstReturnId,
        },
      }),
    ).toBe(1);

    expect(
      await prisma.loyaltyTransaction.count({
        where: { idempotencyKey: `loyalty-return:${firstReturnId}` },
      }),
    ).toBe(1);
  });

  it("rejects over-return with no stock, payment, or loyalty mutation", async () => {
    const beforeStock = await stock();
    const beforePayment = await payment();
    const beforeLoyalty = await prisma.loyaltyAccount.findUniqueOrThrow({
      where: { customerId },
    });

    await expect(
      processReturn(cashier, {
        sourceType: ReturnSourceType.SALE,
        sourceId: saleId,
        reason: "Invalid excess return",
        idempotencyKey: `p7-pos-excess-${suffix}`,
        items: [
          {
            originalLineId: saleLineId,
            quantity: "2",
            physicallyReturned: true,
            restockQuantity: "2",
          },
        ],
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "RETURN_QUANTITY_EXCEEDED",
    });

    expect((await stock()).onHand.toString()).toBe(beforeStock.onHand.toString());
    expect((await payment()).refundedAmount.toFixed(2)).toBe(
      beforePayment.refundedAmount.toFixed(2),
    );

    const afterLoyalty = await prisma.loyaltyAccount.findUniqueOrThrow({
      where: { customerId },
    });
    expect(afterLoyalty.pointBalance).toBe(beforeLoyalty.pointBalance);
    expect(afterLoyalty.spendRemainder.toFixed(2)).toBe(
      beforeLoyalty.spendRemainder.toFixed(2),
    );
  });

  it("allows returned-but-damaged item with refund and zero restock", async () => {
    const result = await processReturn(cashier, {
      sourceType: ReturnSourceType.SALE,
      sourceId: saleId,
      reason: "Returned item damaged and cannot be resold",
      idempotencyKey: `p7-pos-return-damaged-${suffix}`,
      items: [
        {
          originalLineId: saleLineId,
          quantity: "1",
          physicallyReturned: true,
          restockQuantity: "0",
        },
      ],
    });

    expect(result.refundAmount.toFixed(2)).toBe("600.00");
    expect(result.items[0].physicallyReturned).toBe(true);
    expect(result.items[0].restockQuantity.toString()).toBe("0");

    expect((await stock()).onHand.toString()).toBe("9");

    const paid = await payment();
    expect(paid.refundedAmount.toFixed(2)).toBe("1200.00");
    expect(paid.status).toBe(PaymentStatus.REFUNDED);

    const sale = await prisma.sale.findUniqueOrThrow({
      where: { id: saleId },
    });
    expect(sale.status).toBe(SaleStatus.RETURNED);
    expect(sale.paymentStatus).toBe(PaymentStatus.REFUNDED);

    const loyalty = await prisma.loyaltyAccount.findUniqueOrThrow({
      where: { customerId },
    });
    expect(loyalty.pointBalance).toBe(0);
    expect(loyalty.spendRemainder.toFixed(2)).toBe("0.00");
  });

  it("protects completed return evidence from mutation", async () => {
    const record = await prisma.returnRecord.findUniqueOrThrow({
      where: { id: firstReturnId },
      include: { items: true },
    });

    await expect(
      prisma.returnRecord.update({
        where: { id: record.id },
        data: { reason: "Rewrite history" },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.returnItem.update({
        where: { id: record.items[0].id },
        data: { refundAmount: "1.00" },
      }),
    ).rejects.toThrow();
  });
});
