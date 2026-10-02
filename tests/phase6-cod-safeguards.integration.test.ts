import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { CustomerOrderStatus, PaymentSourceType, ReservationStatus, Role } from "@/generated/prisma/client";
import { AuthorizationError } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import { createCustomer } from "@/modules/customers/customer.service";
import {
  cancelCustomerOrder,
  confirmCustomerOrder,
  createCustomerOrder,
  dispatchCustomerOrder,
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
const digits = suffix.replace(/\D/g, "").padEnd(8, "8").slice(0, 8);

let owner: SessionUser;
let cashier: SessionUser;
let warehouse: SessionUser;
let productId: string;
let customerId: string;
let storeId: string;

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
      sku: `P6EDGE-${suffix}`,
      barcode: `86${digits}`,
      name: "Phase 6 Edge Product",
      category: "Test",
      unit: "pcs",
      costPrice: "40.00",
      sellingPrice: "100.00",
      mrp: "110.00",
      warehouseMinStock: "0",
      storeMinStock: "0",
      active: true,
    })
  ).id;

  customerId = (
    await createCustomer(cashier, {
      phone: `97${digits}`,
      name: "Phase 6 Edge Customer",
      notes: "",
    })
  ).id;

  const supplier = await createSupplier(owner, {
    name: `Phase 6 Edge Supplier ${suffix}`,
    phone: "",
    notes: "",
  });

  await postPurchaseReceipt(warehouse, {
    supplierId: supplier.id,
    supplierReference: `P6EDGE-${suffix}`,
    notes: "",
    idempotencyKey: `p6-edge-receipt-${suffix}`,
    items: [{ productId, quantity: "10", unitCost: "40.00" }],
  });

  const transfer = await createTransfer(warehouse, {
    notes: "",
    items: [{ productId, requestedQuantity: "10" }],
  });
  await markTransferReady(warehouse, transfer.id);
  const sent = await dispatchTransfer(warehouse, transfer.id, {
    idempotencyKey: `p6-edge-out-${suffix}`,
  });
  await receiveTransfer(cashier, transfer.id, {
    idempotencyKey: `p6-edge-in-${suffix}`,
    items: [{
      transferItemId: sent.items[0].id,
      receivedQuantity: "10",
      discrepancyReason: "",
    }],
  });
});

async function stock() {
  return prisma.stockBalance.findUniqueOrThrow({
    where: { productId_locationId: { productId, locationId: storeId } },
  });
}

describe("Phase 6 COD safeguards", () => {
  it("denies warehouse staff order creation", async () => {
    await expect(
      createCustomerOrder(warehouse, {
        customerId,
        addressText: "Denied Address",
        deliveryCharge: "0",
        notes: "",
        idempotencyKey: `p6-edge-denied-${suffix}`,
        items: [{ productId, quantity: "1" }],
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("replays creation without duplicate order or payment", async () => {
    const key = `p6-edge-create-replay-${suffix}`;
    const input = {
      customerId,
      addressText: "Replay Address",
      deliveryCharge: "25",
      notes: "Replay",
      idempotencyKey: key,
      items: [{ productId, quantity: "1" }],
    };

    const first = await createCustomerOrder(cashier, input);
    const second = await createCustomerOrder(cashier, input);

    expect(second.id).toBe(first.id);
    expect(await prisma.customerOrder.count({
      where: { createIdempotencyKey: key },
    })).toBe(1);
    expect(await prisma.payment.count({
      where: {
        sourceType: PaymentSourceType.CUSTOMER_ORDER,
        sourceId: first.id,
      },
    })).toBe(1);
  });

  it("rejects state skipping from NEW directly to dispatch", async () => {
    const order = await createCustomerOrder(cashier, {
      customerId,
      addressText: "Skip Address",
      deliveryCharge: "0",
      notes: "",
      idempotencyKey: `p6-edge-skip-create-${suffix}`,
      items: [{ productId, quantity: "1" }],
    });

    await expect(
      dispatchCustomerOrder(cashier, order.id, {
        idempotencyKey: `p6-edge-skip-dispatch-${suffix}`,
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "INVALID_STATE_TRANSITION",
    });
  });

  it("cancels CONFIRMED by releasing reservation without physical movement", async () => {
    const order = await createCustomerOrder(cashier, {
      customerId,
      addressText: "Cancel Address",
      deliveryCharge: "0",
      notes: "",
      idempotencyKey: `p6-edge-cancel-create-${suffix}`,
      items: [{ productId, quantity: "2" }],
    });
    await confirmCustomerOrder(cashier, order.id, {
      idempotencyKey: `p6-edge-cancel-confirm-${suffix}`,
    });

    let balance = await stock();
    const beforeOnHand = balance.onHand.toString();
    expect(balance.reserved.toString()).toBe("2");

    const cancelled = await cancelCustomerOrder(cashier, order.id, {
      idempotencyKey: `p6-edge-cancel-${suffix}`,
    });

    expect(cancelled.status).toBe(CustomerOrderStatus.CANCELLED);
    expect(cancelled.reservations[0].status).toBe(ReservationStatus.RELEASED);

    balance = await stock();
    expect(balance.onHand.toString()).toBe(beforeOnHand);
    expect(balance.reserved.toString()).toBe("0");
    expect(await prisma.inventoryMovement.count({
      where: { referenceType: "CUSTOMER_ORDER", referenceId: order.id },
    })).toBe(0);
  });

  it("rejects silent cancellation after dispatch", async () => {
    const order = await createCustomerOrder(owner, {
      customerId,
      addressText: "Dispatch Address",
      deliveryCharge: "0",
      notes: "",
      idempotencyKey: `p6-edge-dispatched-create-${suffix}`,
      items: [{ productId, quantity: "1" }],
    });
    await confirmCustomerOrder(owner, order.id, {
      idempotencyKey: `p6-edge-dispatched-confirm-${suffix}`,
    });

    const { packCustomerOrder } = await import("@/modules/orders/order.service");
    await packCustomerOrder(owner, order.id, {
      idempotencyKey: `p6-edge-dispatched-pack-${suffix}`,
    });
    await dispatchCustomerOrder(owner, order.id, {
      idempotencyKey: `p6-edge-dispatched-send-${suffix}`,
    });

    await expect(
      cancelCustomerOrder(owner, order.id, {
        idempotencyKey: `p6-edge-dispatched-cancel-${suffix}`,
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "INVALID_STATE_TRANSITION",
    });
  });

  it("keeps order line snapshots immutable in PostgreSQL", async () => {
    const order = await createCustomerOrder(cashier, {
      customerId,
      addressText: "Immutable Address",
      deliveryCharge: "0",
      notes: "",
      idempotencyKey: `p6-edge-immutable-${suffix}`,
      items: [{ productId, quantity: "1" }],
    });

    const item = await prisma.customerOrderItem.findFirstOrThrow({
      where: { customerOrderId: order.id },
    });

    await expect(
      prisma.customerOrderItem.update({
        where: { id: item.id },
        data: { unitPrice: "1.00" },
      }),
    ).rejects.toThrow();
  });
});
