import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  InventoryMovementType,
  PaymentMethod,
  Role,
} from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { createCustomer } from "@/modules/customers/customer.service";
import { adjustInventory } from "@/modules/inventory/inventory.service";
import {
  confirmCustomerOrder,
  createCustomerOrder,
  dispatchCustomerOrder,
  packCustomerOrder,
} from "@/modules/orders/order.service";
import { finalizeSale } from "@/modules/pos/pos.service";
import { createProduct } from "@/modules/products/product.service";

const suffix = randomUUID().slice(0, 8);
const digits = suffix.replace(/\D/g, "").padEnd(8, "5").slice(0, 8);
let owner: SessionUser;
let cashier: SessionUser;
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
});

async function productWithOneUnit(label: string) {
  const product = await createProduct(owner, {
    sku: `P10-${label}-${suffix}`,
    barcode: `10${label === "POS" ? "1" : "2"}${digits}`,
    name: `Phase 10 ${label} concurrency product`,
    category: "Release Test",
    unit: "pcs",
    costPrice: "50.00",
    sellingPrice: "100.00",
    mrp: "110.00",
    warehouseMinStock: "0",
    storeMinStock: "0",
    active: true,
  });

  await adjustInventory(owner, {
    productId: product.id,
    locationId: storeId,
    direction: "IN",
    quantity: "1",
    reason: "Phase 10 concurrency fixture",
    idempotencyKey: `p10-${label}-stock-${suffix}`,
  });

  return product;
}

describe("Phase 10 inventory concurrency", () => {
  it("never sells the same last POS unit twice", async () => {
    const product = await productWithOneUnit("POS");

    const results = await Promise.allSettled([
      finalizeSale(cashier, {
        idempotencyKey: `p10-pos-a-${suffix}`,
        paymentMethod: PaymentMethod.CASH,
        items: [{ productId: product.id, quantity: "1" }],
      }),
      finalizeSale(cashier, {
        idempotencyKey: `p10-pos-b-${suffix}`,
        paymentMethod: PaymentMethod.CASH,
        items: [{ productId: product.id, quantity: "1" }],
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const balance = await prisma.stockBalance.findUniqueOrThrow({
      where: {
        productId_locationId: { productId: product.id, locationId: storeId },
      },
    });
    expect(balance.onHand.toString()).toBe("0");
    expect(balance.reserved.toString()).toBe("0");

    expect(
      await prisma.inventoryMovement.count({
        where: {
          productId: product.id,
          type: InventoryMovementType.POS_SALE,
        },
      }),
    ).toBe(1);
  });

  it("never reserves the same last COD unit twice and dispatches it once", async () => {
    const product = await productWithOneUnit("COD");
    const customer = await createCustomer(cashier, {
      phone: `93${digits}`,
      name: "Phase 10 Concurrency Customer",
      notes: "",
    });

    const [orderA, orderB] = await Promise.all([
      createCustomerOrder(cashier, {
        customerId: customer.id,
        addressText: "Concurrency A",
        deliveryCharge: "0",
        notes: "",
        idempotencyKey: `p10-cod-a-create-${suffix}`,
        items: [{ productId: product.id, quantity: "1" }],
      }),
      createCustomerOrder(cashier, {
        customerId: customer.id,
        addressText: "Concurrency B",
        deliveryCharge: "0",
        notes: "",
        idempotencyKey: `p10-cod-b-create-${suffix}`,
        items: [{ productId: product.id, quantity: "1" }],
      }),
    ]);

    const confirms = await Promise.allSettled([
      confirmCustomerOrder(cashier, orderA.id, {
        idempotencyKey: `p10-cod-a-confirm-${suffix}`,
      }),
      confirmCustomerOrder(cashier, orderB.id, {
        idempotencyKey: `p10-cod-b-confirm-${suffix}`,
      }),
    ]);

    const fulfilled = confirms.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof confirmCustomerOrder>>> =>
        result.status === "fulfilled",
    );
    expect(fulfilled).toHaveLength(1);

    const confirmedOrder = fulfilled[0].value;
    let balance = await prisma.stockBalance.findUniqueOrThrow({
      where: {
        productId_locationId: { productId: product.id, locationId: storeId },
      },
    });
    expect(balance.onHand.toString()).toBe("1");
    expect(balance.reserved.toString()).toBe("1");

    await packCustomerOrder(cashier, confirmedOrder.id, {
      idempotencyKey: `p10-cod-pack-${suffix}`,
    });

    const dispatches = await Promise.allSettled([
      dispatchCustomerOrder(cashier, confirmedOrder.id, {
        idempotencyKey: `p10-cod-dispatch-a-${suffix}`,
      }),
      dispatchCustomerOrder(cashier, confirmedOrder.id, {
        idempotencyKey: `p10-cod-dispatch-b-${suffix}`,
      }),
    ]);

    expect(dispatches.filter((result) => result.status === "fulfilled")).toHaveLength(1);

    balance = await prisma.stockBalance.findUniqueOrThrow({
      where: {
        productId_locationId: { productId: product.id, locationId: storeId },
      },
    });
    expect(balance.onHand.toString()).toBe("0");
    expect(balance.reserved.toString()).toBe("0");

    expect(
      await prisma.inventoryMovement.count({
        where: {
          productId: product.id,
          referenceType: "CUSTOMER_ORDER",
          referenceId: confirmedOrder.id,
          type: InventoryMovementType.COD_DISPATCH,
        },
      }),
    ).toBe(1);
  });
});
