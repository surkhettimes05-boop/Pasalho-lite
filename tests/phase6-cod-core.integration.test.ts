import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CustomerOrderStatus,
  InventoryMovementType,
  LoyaltySourceType,
  PaymentSourceType,
  PaymentStatus,
  ReservationStatus,
  Role,
} from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { createCustomer } from "@/modules/customers/customer.service";
import { reconcileInventoryBalance } from "@/modules/inventory/inventory.service";
import { reconcileLoyaltyAccount } from "@/modules/loyalty/loyalty.service";
import {
  confirmCustomerOrder,
  createCustomerOrder,
  deliverCustomerOrder,
  dispatchCustomerOrder,
  packCustomerOrder,
} from "@/modules/orders/order.service";
import { createProduct } from "@/modules/products/product.service";
import { postPurchaseReceipt } from "@/modules/receiving/receipt.service";
import { createSupplier } from "@/modules/receiving/supplier.service";
import {
  createTransfer,
  dispatchTransfer,
  markTransferReady,
  receiveTransfer,
} from "@/modules/transfers/transfer.service";

const suffix = randomUUID().slice(0, 8);
const digits = suffix.replace(/\D/g, "").padEnd(8, "6").slice(0, 8);

let owner: SessionUser;
let cashier: SessionUser;
let warehouse: SessionUser;
let productId: string;
let customerId: string;
let storeId: string;
let orderId: string;

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
      sku: `P6CORE-${suffix}`,
      barcode: `76${digits}`,
      name: "Phase 6 Core Product",
      category: "Test",
      unit: "pcs",
      costPrice: "150.00",
      sellingPrice: "250.00",
      mrp: "275.00",
      warehouseMinStock: "0",
      storeMinStock: "0",
      active: true,
    })
  ).id;

  customerId = (
    await createCustomer(cashier, {
      phone: `98${digits}`,
      name: "Phase 6 Core Customer",
      notes: "",
    })
  ).id;

  const supplier = await createSupplier(owner, {
    name: `Phase 6 Core Supplier ${suffix}`,
    phone: "",
    notes: "",
  });

  await postPurchaseReceipt(warehouse, {
    supplierId: supplier.id,
    supplierReference: `P6CORE-${suffix}`,
    notes: "",
    idempotencyKey: `p6-core-receipt-${suffix}`,
    items: [{ productId, quantity: "17", unitCost: "150.00" }],
  });

  const transfer = await createTransfer(warehouse, {
    notes: "",
    items: [{ productId, requestedQuantity: "17" }],
  });
  await markTransferReady(warehouse, transfer.id);
  const sent = await dispatchTransfer(warehouse, transfer.id, {
    idempotencyKey: `p6-core-transfer-out-${suffix}`,
  });
  await receiveTransfer(cashier, transfer.id, {
    idempotencyKey: `p6-core-transfer-in-${suffix}`,
    items: [{
      transferItemId: sent.items[0].id,
      receivedQuantity: "17",
      discrepancyReason: "",
    }],
  });
});

async function stock() {
  return prisma.stockBalance.findUniqueOrThrow({
    where: { productId_locationId: { productId, locationId: storeId } },
  });
}

describe("Phase 6 COD core lifecycle", () => {
  it("NEW creates pending payment with no reservation or stock movement", async () => {
    const order = await createCustomerOrder(cashier, {
      customerId,
      addressText: "Birendranagar Test Address",
      deliveryCharge: "50",
      notes: "WhatsApp order",
      idempotencyKey: `p6-core-create-${suffix}`,
      items: [{ productId, quantity: "2" }],
    });
    orderId = order.id;

    expect(order.status).toBe(CustomerOrderStatus.NEW);
    expect(order.subtotal.toFixed(2)).toBe("500.00");
    expect(order.deliveryCharge.toFixed(2)).toBe("50.00");
    expect(order.total.toFixed(2)).toBe("550.00");
    expect(order.reservations).toHaveLength(0);

    const balance = await stock();
    expect(balance.onHand.toString()).toBe("17");
    expect(balance.reserved.toString()).toBe("0");

    const payment = await prisma.payment.findUniqueOrThrow({
      where: {
        sourceType_sourceId: {
          sourceType: PaymentSourceType.CUSTOMER_ORDER,
          sourceId: order.id,
        },
      },
    });
    expect(payment.status).toBe(PaymentStatus.PENDING);
    expect(payment.amount.toFixed(2)).toBe("550.00");
    expect(payment.collectedAt).toBeNull();
  });

  it("CONFIRMED reserves 2 without physical deduction", async () => {
    const order = await confirmCustomerOrder(cashier, orderId, {
      idempotencyKey: `p6-core-confirm-${suffix}`,
    });

    expect(order.status).toBe(CustomerOrderStatus.CONFIRMED);
    expect(order.reservations[0].status).toBe(ReservationStatus.ACTIVE);

    const balance = await stock();
    expect(balance.onHand.toString()).toBe("17");
    expect(balance.reserved.toString()).toBe("2");
    expect(balance.onHand.sub(balance.reserved).toString()).toBe("15");

    expect(await prisma.inventoryMovement.count({
      where: { referenceType: "CUSTOMER_ORDER", referenceId: orderId },
    })).toBe(0);
  });

  it("PACKED changes neither reservation nor physical stock", async () => {
    const order = await packCustomerOrder(cashier, orderId, {
      idempotencyKey: `p6-core-pack-${suffix}`,
    });
    expect(order.status).toBe(CustomerOrderStatus.PACKED);
    expect(order.reservations[0].status).toBe(ReservationStatus.ACTIVE);

    const balance = await stock();
    expect(balance.onHand.toString()).toBe("17");
    expect(balance.reserved.toString()).toBe("2");
  });

  it("DISPATCHED consumes reservation and deducts once", async () => {
    const key = `p6-core-dispatch-${suffix}`;
    const order = await dispatchCustomerOrder(cashier, orderId, {
      idempotencyKey: key,
    });

    expect(order.status).toBe(CustomerOrderStatus.DISPATCHED);
    expect(order.reservations[0].status).toBe(ReservationStatus.CONSUMED);

    let balance = await stock();
    expect(balance.onHand.toString()).toBe("15");
    expect(balance.reserved.toString()).toBe("0");

    expect(await prisma.inventoryMovement.count({
      where: {
        referenceType: "CUSTOMER_ORDER",
        referenceId: orderId,
        type: InventoryMovementType.COD_DISPATCH,
      },
    })).toBe(1);

    await dispatchCustomerOrder(cashier, orderId, { idempotencyKey: key });
    balance = await stock();
    expect(balance.onHand.toString()).toBe("15");

    const reconciliation = await reconcileInventoryBalance(productId, storeId);
    expect(reconciliation.matches).toBe(true);
  });

  it("DELIVERED collects COD and loyalty once without another stock deduction", async () => {
    const key = `p6-core-deliver-${suffix}`;
    const movementsBefore = await prisma.inventoryMovement.count({
      where: { referenceType: "CUSTOMER_ORDER", referenceId: orderId },
    });

    const order = await deliverCustomerOrder(cashier, orderId, {
      idempotencyKey: key,
    });
    expect(order.status).toBe(CustomerOrderStatus.DELIVERED);
    expect(order.paymentStatus).toBe(PaymentStatus.PAID);

    const payment = await prisma.payment.findUniqueOrThrow({
      where: {
        sourceType_sourceId: {
          sourceType: PaymentSourceType.CUSTOMER_ORDER,
          sourceId: orderId,
        },
      },
    });
    expect(payment.status).toBe(PaymentStatus.PAID);
    expect(payment.collectedAt).not.toBeNull();

    const loyalty = await prisma.loyaltyTransaction.findUniqueOrThrow({
      where: { idempotencyKey: `loyalty-order:${orderId}` },
    });
    expect(loyalty.sourceType).toBe(LoyaltySourceType.CUSTOMER_ORDER);
    expect(loyalty.eligibleSpendDelta.toFixed(2)).toBe("500.00");
    expect(loyalty.pointsDelta).toBe(1);

    expect((await stock()).onHand.toString()).toBe("15");
    expect(await prisma.inventoryMovement.count({
      where: { referenceType: "CUSTOMER_ORDER", referenceId: orderId },
    })).toBe(movementsBefore);

    await deliverCustomerOrder(cashier, orderId, { idempotencyKey: key });
    expect(await prisma.loyaltyTransaction.count({
      where: { sourceType: LoyaltySourceType.CUSTOMER_ORDER, sourceId: orderId },
    })).toBe(1);

    const loyaltyReconciliation = await reconcileLoyaltyAccount(customerId);
    expect(loyaltyReconciliation.matches).toBe(true);
  });
});
