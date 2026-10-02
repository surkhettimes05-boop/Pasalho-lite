import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  InventoryMovementType,
  PaymentMethod,
  PaymentSourceType,
  PaymentStatus,
  Role,
  SaleStatus,
} from "@/generated/prisma/client";
import { AuthorizationError } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import { reconcileInventoryBalance } from "@/modules/inventory/inventory.service";
import { finalizeSale } from "@/modules/pos/pos.service";
import { createProduct, updateProduct } from "@/modules/products/product.service";
import { postPurchaseReceipt } from "@/modules/receiving/receipt.service";
import { createSupplier } from "@/modules/receiving/supplier.service";
import {
  createTransfer,
  dispatchTransfer,
  markTransferReady,
  receiveTransfer,
} from "@/modules/transfers/transfer.service";

const suffix = randomUUID().slice(0, 8);
const primarySaleKey = `phase4-sale-${suffix}`;

let owner: SessionUser;
let cashier: SessionUser;
let warehouseActor: SessionUser;
let productId: string;
let storeId: string;
let primarySaleId: string;

beforeAll(async () => {
  const ownerRecord = await prisma.user.findUniqueOrThrow({
    where: { email: process.env.SEED_OWNER_EMAIL!.toLowerCase() },
  });

  owner = {
    id: ownerRecord.id,
    name: ownerRecord.name,
    email: ownerRecord.email,
    role: ownerRecord.role,
  };

  cashier = {
    ...owner,
    role: Role.CASHIER_STORE,
  };

  warehouseActor = {
    ...owner,
    role: Role.WAREHOUSE_STAFF,
  };

  const store = await prisma.location.findUniqueOrThrow({
    where: { code: "STORE_MAIN" },
  });
  storeId = store.id;

  const product = await createProduct(owner, {
    sku: `PHASE4-${suffix}`,
    barcode: `64${suffix.replace(/\D/g, "").padEnd(10, "4").slice(0, 10)}`,
    name: "Phase 4 POS Product",
    category: "Test",
    unit: "pcs",
    costPrice: "70.00",
    sellingPrice: "100.00",
    mrp: "110.00",
    warehouseMinStock: "0",
    storeMinStock: "0",
    active: true,
  });
  productId = product.id;

  const supplier = await createSupplier(owner, {
    name: `Phase 4 Supplier ${suffix}`,
    phone: "",
    notes: "POS integration setup",
  });

  await postPurchaseReceipt(warehouseActor, {
    supplierId: supplier.id,
    supplierReference: `PHASE4-OPENING-${suffix}`,
    notes: "Opening POS test stock",
    idempotencyKey: `phase4-opening-receipt-${suffix}`,
    items: [
      {
        productId,
        quantity: "20",
        unitCost: "70.00",
      },
    ],
  });

  const transfer = await createTransfer(warehouseActor, {
    notes: "Move POS test stock to store",
    items: [
      {
        productId,
        requestedQuantity: "20",
      },
    ],
  });

  await markTransferReady(warehouseActor, transfer.id);
  const dispatched = await dispatchTransfer(warehouseActor, transfer.id, {
    idempotencyKey: `phase4-transfer-dispatch-${suffix}`,
  });

  await receiveTransfer(cashier, transfer.id, {
    idempotencyKey: `phase4-transfer-receive-${suffix}`,
    items: [
      {
        transferItemId: dispatched.items[0].id,
        receivedQuantity: "20",
        discrepancyReason: "",
      },
    ],
  });
});

async function storeBalance() {
  return prisma.stockBalance.findUniqueOrThrow({
    where: {
      productId_locationId: {
        productId,
        locationId: storeId,
      },
    },
  });
}

describe("Phase 4 POS", () => {
  it("rejects POS finalization from warehouse staff", async () => {
    await expect(
      finalizeSale(warehouseActor, {
        idempotencyKey: `phase4-unauthorized-${suffix}`,
        paymentMethod: PaymentMethod.CASH,
        items: [
          {
            productId,
            quantity: "1",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("finalizes cash sale: store 20 -> sell 3 -> store 17", async () => {
    expect((await storeBalance()).onHand.toString()).toBe("20");

    const result = await finalizeSale(cashier, {
      idempotencyKey: primarySaleKey,
      paymentMethod: PaymentMethod.CASH,
      items: [
        {
          productId,
          quantity: "3",
        },
      ],
    });

    primarySaleId = result.sale.id;

    expect(result.sale.status).toBe(SaleStatus.FINALIZED);
    expect(result.sale.customerId).toBeNull();
    expect(result.sale.subtotal.toFixed(2)).toBe("300.00");
    expect(result.sale.discountTotal.toFixed(2)).toBe("0.00");
    expect(result.sale.total.toFixed(2)).toBe("300.00");
    expect(result.sale.paymentStatus).toBe(PaymentStatus.PAID);
    expect(result.sale.items).toHaveLength(1);
    expect(result.sale.items[0].quantity.toString()).toBe("3");
    expect(result.sale.items[0].unitPrice.toFixed(2)).toBe("100.00");
    expect(result.sale.items[0].lineTotal.toFixed(2)).toBe("300.00");
    expect(result.sale.items[0].unitCostSnapshot?.toFixed(2)).toBe("70.00");

    expect(result.payment.sourceType).toBe(PaymentSourceType.SALE);
    expect(result.payment.sourceId).toBe(result.sale.id);
    expect(result.payment.method).toBe(PaymentMethod.CASH);
    expect(result.payment.status).toBe(PaymentStatus.PAID);
    expect(result.payment.amount.toFixed(2)).toBe("300.00");
    expect(result.payment.collectedAt).not.toBeNull();

    expect((await storeBalance()).onHand.toString()).toBe("17");

    const paymentCount = await prisma.payment.count({
      where: {
        sourceType: PaymentSourceType.SALE,
        sourceId: result.sale.id,
      },
    });
    const movementCount = await prisma.inventoryMovement.count({
      where: {
        referenceType: "SALE",
        referenceId: result.sale.id,
        type: InventoryMovementType.POS_SALE,
      },
    });

    expect(paymentCount).toBe(1);
    expect(movementCount).toBe(1);

    const movement = await prisma.inventoryMovement.findFirstOrThrow({
      where: {
        referenceType: "SALE",
        referenceId: result.sale.id,
        type: InventoryMovementType.POS_SALE,
      },
    });

    expect(movement.locationId).toBe(storeId);
    expect(movement.quantityDelta.toString()).toBe("-3");

    const reconciliation = await reconcileInventoryBalance(
      productId,
      storeId,
    );

    expect(reconciliation.matches).toBe(true);
    expect(reconciliation.projectedOnHand.toString()).toBe("17");
  });

  it("replays finalization without duplicate sale, payment, stock deduction, or audit", async () => {
    const replay = await finalizeSale(cashier, {
      idempotencyKey: primarySaleKey,
      paymentMethod: PaymentMethod.CASH,
      items: [
        {
          productId,
          quantity: "3",
        },
      ],
    });

    expect(replay.sale.id).toBe(primarySaleId);
    expect((await storeBalance()).onHand.toString()).toBe("17");

    expect(
      await prisma.sale.count({
        where: { idempotencyKey: primarySaleKey },
      }),
    ).toBe(1);

    expect(
      await prisma.payment.count({
        where: {
          sourceType: PaymentSourceType.SALE,
          sourceId: primarySaleId,
        },
      }),
    ).toBe(1);

    expect(
      await prisma.inventoryMovement.count({
        where: {
          referenceType: "SALE",
          referenceId: primarySaleId,
          type: InventoryMovementType.POS_SALE,
        },
      }),
    ).toBe(1);

    expect(
      await prisma.auditLog.count({
        where: {
          entityType: "Sale",
          entityId: primarySaleId,
          action: "POS_SALE_FINALIZED",
        },
      }),
    ).toBe(1);
  });

  it("rejects reuse of POS idempotency key for a different command", async () => {
    await expect(
      finalizeSale(cashier, {
        idempotencyKey: primarySaleKey,
        paymentMethod: PaymentMethod.QR_NON_CASH,
        items: [
          {
            productId,
            quantity: "3",
          },
        ],
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "IDEMPOTENCY_CONFLICT",
    });

    expect((await storeBalance()).onHand.toString()).toBe("17");
  });

  it("preserves historical sale price after product price changes", async () => {
    await updateProduct(owner, productId, {
      sku: `PHASE4-${suffix}`,
      barcode: `64${suffix.replace(/\D/g, "").padEnd(10, "4").slice(0, 10)}`,
      name: "Phase 4 POS Product",
      category: "Test",
      unit: "pcs",
      costPrice: "70.00",
      sellingPrice: "120.00",
      mrp: "130.00",
      warehouseMinStock: "0",
      storeMinStock: "0",
      active: true,
    });

    const historicalItem = await prisma.saleItem.findFirstOrThrow({
      where: {
        saleId: primarySaleId,
        productId,
      },
    });

    expect(historicalItem.unitPrice.toFixed(2)).toBe("100.00");
    expect(historicalItem.lineTotal.toFixed(2)).toBe("300.00");
  });

  it("ignores manipulated client price/total fields and uses current server price", async () => {
    const manipulated = {
      idempotencyKey: `phase4-manipulated-${suffix}`,
      paymentMethod: PaymentMethod.QR_NON_CASH,
      clientTotal: "1.00",
      clientUnitPrice: "1.00",
      discountTotal: "9999.00",
      items: [
        {
          productId,
          quantity: "1",
          unitPrice: "1.00",
        },
      ],
    } as unknown as Parameters<typeof finalizeSale>[1];

    const result = await finalizeSale(cashier, manipulated);

    expect(result.sale.subtotal.toFixed(2)).toBe("120.00");
    expect(result.sale.discountTotal.toFixed(2)).toBe("0.00");
    expect(result.sale.total.toFixed(2)).toBe("120.00");
    expect(result.sale.items[0].unitPrice.toFixed(2)).toBe("120.00");
    expect(result.payment.amount.toFixed(2)).toBe("120.00");
    expect(result.payment.method).toBe(PaymentMethod.QR_NON_CASH);
    expect((await storeBalance()).onHand.toString()).toBe("16");
  });

  it("rejects insufficient available stock with zero partial records", async () => {
    const key = `phase4-insufficient-${suffix}`;
    const before = await storeBalance();

    await expect(
      finalizeSale(cashier, {
        idempotencyKey: key,
        paymentMethod: PaymentMethod.CASH,
        items: [
          {
            productId,
            quantity: "17",
          },
        ],
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "INSUFFICIENT_STOCK",
    });

    expect((await storeBalance()).onHand.toString()).toBe(
      before.onHand.toString(),
    );
    expect(
      await prisma.sale.count({
        where: { idempotencyKey: key },
      }),
    ).toBe(0);
    expect(
      await prisma.payment.count({
        where: { idempotencyKey: `pos-payment:${key}` },
      }),
    ).toBe(0);
    expect(
      await prisma.inventoryMovement.count({
        where: {
          idempotencyKey: {
            startsWith: `pos-sale:${key}:`,
          },
        },
      }),
    ).toBe(0);
  });

  it("rejects inactive product sale with no inventory mutation", async () => {
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
    });

    await updateProduct(owner, productId, {
      sku: product.sku,
      barcode: product.barcode ?? "",
      name: product.name,
      category: product.category,
      unit: product.unit,
      costPrice: product.costPrice.toFixed(2),
      sellingPrice: product.sellingPrice.toFixed(2),
      mrp: product.mrp?.toFixed(2) ?? "",
      warehouseMinStock: product.warehouseMinStock.toString(),
      storeMinStock: product.storeMinStock.toString(),
      active: false,
    });

    const before = await storeBalance();
    const key = `phase4-inactive-${suffix}`;

    await expect(
      finalizeSale(owner, {
        idempotencyKey: key,
        paymentMethod: PaymentMethod.CASH,
        items: [
          {
            productId,
            quantity: "1",
          },
        ],
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "PRODUCT_NOT_AVAILABLE",
    });

    expect((await storeBalance()).onHand.toString()).toBe(
      before.onHand.toString(),
    );
    expect(await prisma.sale.count({ where: { idempotencyKey: key } })).toBe(
      0,
    );
  });

  it("keeps finalized sale lines and payment amount immutable in PostgreSQL", async () => {
    const item = await prisma.saleItem.findFirstOrThrow({
      where: { saleId: primarySaleId },
    });
    const payment = await prisma.payment.findUniqueOrThrow({
      where: {
        sourceType_sourceId: {
          sourceType: PaymentSourceType.SALE,
          sourceId: primarySaleId,
        },
      },
    });

    await expect(
      prisma.saleItem.update({
        where: { id: item.id },
        data: { unitPrice: "1.00" },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.payment.update({
        where: { id: payment.id },
        data: { amount: "1.00" },
      }),
    ).rejects.toThrow();

    const persistedItem = await prisma.saleItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    const persistedPayment = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });

    expect(persistedItem.unitPrice.toFixed(2)).toBe("100.00");
    expect(persistedPayment.amount.toFixed(2)).toBe("300.00");
  });
});
