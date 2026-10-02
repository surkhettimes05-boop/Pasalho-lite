import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CustomerOrderStatus,
  LoyaltySourceType,
  PaymentSourceType,
  PaymentStatus,
  ReturnKind,
  ReturnSourceType,
  Role,
} from "@/generated/prisma/client";
import { AuthorizationError } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import { createCustomer } from "@/modules/customers/customer.service";
import { adjustInventory } from "@/modules/inventory/inventory.service";
import {
  confirmCustomerOrder,
  createCustomerOrder,
  deliverCustomerOrder,
  dispatchCustomerOrder,
  packCustomerOrder,
} from "@/modules/orders/order.service";
import { createProduct } from "@/modules/products/product.service";
import { processReturn } from "@/modules/returns/return.service";

const suffix = randomUUID().slice(0, 8);
const digits = suffix.replace(/\D/g, "").padEnd(8, "9").slice(0, 8);

let owner: SessionUser;
let cashier: SessionUser;
let warehouse: SessionUser;
let productId: string;
let customerId: string;
let storeId: string;
let deliveredOrderId: string;
let deliveredLineId: string;

beforeAll(async () => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: process.env.SEED_OWNER_EMAIL!.toLowerCase() },
  });

  owner = { id: user.id, name: user.name, email: user.email, role: user.role };
  cashier = { ...owner, role: Role.CASHIER_STORE };
  warehouse = { ...owner, role: Role.WAREHOUSE_STAFF };

  storeId = (
    await prisma.location.findUniqueOrThrow({ where: { code: "STORE_MAIN" } })
  ).id;

  productId = (
    await createProduct(owner, {
      sku: `P7COD-${suffix}`,
      barcode: `97${digits}`,
      name: "Phase 7 COD Return Product",
      category: "Test",
      unit: "pcs",
      costPrice: "120.00",
      sellingPrice: "250.00",
      mrp: "275.00",
      warehouseMinStock: "0",
      storeMinStock: "0",
      active: true,
    })
  ).id;

  customerId = (
    await createCustomer(cashier, {
      phone: `96${digits}`,
      name: "Phase 7 COD Customer",
      notes: "",
    })
  ).id;

  await adjustInventory(owner, {
    productId,
    locationId: storeId,
    direction: "IN",
    quantity: "12",
    reason: "Phase 7 COD test opening stock",
    idempotencyKey: `p7-cod-opening-${suffix}`,
  });

  const order = await createCustomerOrder(cashier, {
    customerId,
    addressText: "Birendranagar COD Return Test",
    deliveryCharge: "50",
    notes: "",
    idempotencyKey: `p7-cod-delivered-create-${suffix}`,
    items: [{ productId, quantity: "2" }],
  });

  deliveredOrderId = order.id;
  deliveredLineId = order.items[0].id;

  await confirmCustomerOrder(cashier, order.id, {
    idempotencyKey: `p7-cod-delivered-confirm-${suffix}`,
  });
  await packCustomerOrder(cashier, order.id, {
    idempotencyKey: `p7-cod-delivered-pack-${suffix}`,
  });
  await dispatchCustomerOrder(cashier, order.id, {
    idempotencyKey: `p7-cod-delivered-dispatch-${suffix}`,
  });
  await deliverCustomerOrder(cashier, order.id, {
    idempotencyKey: `p7-cod-delivered-deliver-${suffix}`,
  });
});

async function stockOnHand() {
  return (
    await prisma.stockBalance.findUniqueOrThrow({
      where: {
        productId_locationId: {
          productId,
          locationId: storeId,
        },
      },
    })
  ).onHand;
}

describe("Phase 7 COD returns and failed-delivery recovery", () => {
  it("refunds delivered merchandise but preserves delivery charge and restores accepted stock", async () => {
    expect((await stockOnHand()).toString()).toBe("10");

    const result = await processReturn(cashier, {
      sourceType: ReturnSourceType.CUSTOMER_ORDER,
      sourceId: deliveredOrderId,
      reason: "Customer returned one delivered unit",
      idempotencyKey: `p7-cod-delivered-return-${suffix}`,
      items: [{
        originalLineId: deliveredLineId,
        quantity: "1",
        physicallyReturned: true,
        restockQuantity: "1",
      }],
    });

    expect(result.kind).toBe(ReturnKind.REFUND);
    expect(result.refundAmount.toFixed(2)).toBe("250.00");
    expect((await stockOnHand()).toString()).toBe("11");

    const payment = await prisma.payment.findUniqueOrThrow({
      where: {
        sourceType_sourceId: {
          sourceType: PaymentSourceType.CUSTOMER_ORDER,
          sourceId: deliveredOrderId,
        },
      },
    });
    expect(payment.amount.toFixed(2)).toBe("550.00");
    expect(payment.refundedAmount.toFixed(2)).toBe("250.00");
    expect(payment.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);

    const order = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: deliveredOrderId },
    });
    expect(order.status).toBe(CustomerOrderStatus.DELIVERED);
    expect(order.paymentStatus).toBe(PaymentStatus.PARTIALLY_REFUNDED);

    const loyalty = await prisma.loyaltyAccount.findUniqueOrThrow({
      where: { customerId },
    });
    expect(loyalty.pointBalance).toBe(0);
    expect(loyalty.spendRemainder.toFixed(2)).toBe("250.00");

    const returnLoyalty = await prisma.loyaltyTransaction.findUniqueOrThrow({
      where: { idempotencyKey: `loyalty-return:${result.id}` },
    });
    expect(returnLoyalty.sourceType).toBe(LoyaltySourceType.CUSTOMER_ORDER);
    expect(returnLoyalty.eligibleSpendDelta.toFixed(2)).toBe("-250.00");
  });

  it("rejects Cashier refund without physical goods", async () => {
    await expect(
      processReturn(cashier, {
        sourceType: ReturnSourceType.CUSTOMER_ORDER,
        sourceId: deliveredOrderId,
        reason: "Customer asks remote refund",
        idempotencyKey: `p7-cod-no-goods-${suffix}`,
        items: [{
          originalLineId: deliveredLineId,
          quantity: "1",
          physicallyReturned: false,
          restockQuantity: "0",
        }],
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "UNUSUAL_REFUND_REQUIRES_ADMIN",
    });

    expect((await stockOnHand()).toString()).toBe("11");
  });

  it("blocks Warehouse Staff from processing returns", async () => {
    await expect(
      processReturn(warehouse, {
        sourceType: ReturnSourceType.CUSTOMER_ORDER,
        sourceId: deliveredOrderId,
        reason: "Unauthorized return",
        idempotencyKey: `p7-cod-warehouse-${suffix}`,
        items: [{
          originalLineId: deliveredLineId,
          quantity: "1",
          physicallyReturned: true,
          restockQuantity: "1",
        }],
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects partial failed-delivery recovery, then accepts full physical recovery with no refund", async () => {
    const order = await createCustomerOrder(cashier, {
      customerId,
      addressText: "Failed Delivery Recovery Test",
      deliveryCharge: "40",
      notes: "",
      idempotencyKey: `p7-recovery-create-${suffix}`,
      items: [{ productId, quantity: "2" }],
    });
    const lineId = order.items[0].id;

    await confirmCustomerOrder(cashier, order.id, {
      idempotencyKey: `p7-recovery-confirm-${suffix}`,
    });
    await packCustomerOrder(cashier, order.id, {
      idempotencyKey: `p7-recovery-pack-${suffix}`,
    });
    await dispatchCustomerOrder(cashier, order.id, {
      idempotencyKey: `p7-recovery-dispatch-${suffix}`,
    });

    const afterDispatch = await stockOnHand();

    await expect(
      processReturn(cashier, {
        sourceType: ReturnSourceType.CUSTOMER_ORDER,
        sourceId: order.id,
        reason: "Only one unit returned from failed delivery",
        idempotencyKey: `p7-recovery-partial-${suffix}`,
        items: [{
          originalLineId: lineId,
          quantity: "1",
          physicallyReturned: true,
          restockQuantity: "1",
        }],
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "PARTIAL_RECOVERY_NOT_SUPPORTED",
    });

    expect((await stockOnHand()).toString()).toBe(afterDispatch.toString());

    const recovery = await processReturn(cashier, {
      sourceType: ReturnSourceType.CUSTOMER_ORDER,
      sourceId: order.id,
      reason: "Failed delivery returned fully to store",
      idempotencyKey: `p7-recovery-full-${suffix}`,
      items: [{
        originalLineId: lineId,
        quantity: "2",
        physicallyReturned: true,
        restockQuantity: "2",
      }],
    });

    expect(recovery.kind).toBe(ReturnKind.RECOVERY);
    expect(recovery.refundAmount.toFixed(2)).toBe("0.00");
    expect(recovery.refundMethod).toBeNull();
    expect((await stockOnHand()).toString()).toBe(
      afterDispatch.add(2).toString(),
    );

    const persistedOrder = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(persistedOrder.status).toBe(CustomerOrderStatus.CANCELLED);
    expect(persistedOrder.cancelledAt).not.toBeNull();

    const payment = await prisma.payment.findUniqueOrThrow({
      where: {
        sourceType_sourceId: {
          sourceType: PaymentSourceType.CUSTOMER_ORDER,
          sourceId: order.id,
        },
      },
    });
    expect(payment.status).toBe(PaymentStatus.PENDING);
    expect(payment.refundedAmount.toFixed(2)).toBe("0.00");
    expect(payment.collectedAt).toBeNull();

    expect(
      await prisma.loyaltyTransaction.count({
        where: {
          sourceType: LoyaltySourceType.CUSTOMER_ORDER,
          sourceId: order.id,
        },
      }),
    ).toBe(0);
  });

  it("allows Owner/Admin audited refund without goods but never restocks it", async () => {
    const beforeStock = await stockOnHand();

    const result = await processReturn(owner, {
      sourceType: ReturnSourceType.CUSTOMER_ORDER,
      sourceId: deliveredOrderId,
      reason: "Owner approved exceptional remote refund",
      idempotencyKey: `p7-cod-owner-override-${suffix}`,
      items: [{
        originalLineId: deliveredLineId,
        quantity: "1",
        physicallyReturned: false,
        restockQuantity: "0",
      }],
    });

    expect(result.refundAmount.toFixed(2)).toBe("250.00");
    expect(result.items[0].physicallyReturned).toBe(false);
    expect((await stockOnHand()).toString()).toBe(beforeStock.toString());

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        entityType: "Return",
        entityId: result.id,
      },
    });
    expect(audit.metadata).toMatchObject({ refundWithoutGoods: true });
  });
});
