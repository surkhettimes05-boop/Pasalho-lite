import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  InventoryMovementType,
  PaymentMethod,
  PaymentSourceType,
  Role,
} from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { quotePosPricing } from "@/modules/pricing/pricing.service";
import { finalizeSale, getPosCatalog } from "@/modules/pos/pos.service";
import { createProduct } from "@/modules/products/product.service";
import { postPurchaseReceipt } from "@/modules/receiving/receipt.service";
import { createSupplier } from "@/modules/receiving/supplier.service";
import {
  createTransfer,
  dispatchTransfer,
  markTransferReady,
  receiveTransfer,
} from "@/modules/transfers/transfer.service";

const suffix = randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
const barcode = `LITE${suffix}`;
const saleKey = `lite-local-pos-${suffix}`;
let owner: SessionUser;
let cashier: SessionUser;
let warehouse: SessionUser;
let productId: string;
let storeId: string;
let restoreFetch: (() => void) | undefined;

beforeAll(async () => {
  const seededOwner = await prisma.user.findUniqueOrThrow({
    where: { email: process.env.SEED_OWNER_EMAIL!.toLowerCase() },
  });
  owner = { ...seededOwner, role: Role.OWNER_ADMIN };
  cashier = { ...owner, role: Role.CASHIER_STORE };
  warehouse = { ...owner, role: Role.WAREHOUSE_STAFF };
  storeId = (await prisma.location.findUniqueOrThrow({ where: { code: "STORE_MAIN" } })).id;

  const product = await createProduct(owner, {
    sku: `LITE-P0-${suffix}`,
    barcode,
    name: "Local billing test rice 1 kg",
    category: "Test grocery",
    unit: "bag",
    costPrice: "100.00",
    sellingPrice: "150.00",
    mrp: "160.00",
    warehouseMinStock: "0",
    storeMinStock: "0",
    active: true,
  });
  productId = product.id;
  const supplier = await createSupplier(owner, {
    name: `Local POS test supplier ${suffix}`,
    phone: "",
    notes: "Isolated integration fixture",
  });
  const receipt = await postPurchaseReceipt(warehouse, {
    supplierId: supplier.id,
    supplierReference: `LITE-P0-REC-${suffix}`,
    notes: "Isolated billing fixture",
    idempotencyKey: `lite-p0-receipt-${suffix}`,
    items: [{ productId, quantity: "5", unitCost: "100.00" }],
  });
  const transfer = await createTransfer(warehouse, {
    notes: `Isolated billing fixture ${suffix}`,
    items: [{ productId, requestedQuantity: "5" }],
  });
  await markTransferReady(warehouse, transfer.id);
  const dispatched = await dispatchTransfer(warehouse, transfer.id, {
    idempotencyKey: `lite-p0-transfer-dispatch-${suffix}`,
  });
  await receiveTransfer(cashier, transfer.id, {
    idempotencyKey: `lite-p0-transfer-receive-${suffix}`,
    items: [{ transferItemId: dispatched.items[0].id, receivedQuantity: "5", discrepancyReason: "" }],
  });
  expect(receipt.items).toHaveLength(1);
});

afterAll(() => restoreFetch?.());

describe("Lite-owned ordinary POS billing", () => {
  it("scans a Lite barcode, quotes Lite selling price, and completes cash billing with Modern Trade unavailable", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("Modern Trade intentionally unavailable in this test");
    }));
    restoreFetch = () => {
      vi.stubGlobal("fetch", originalFetch);
      vi.unstubAllGlobals();
    };

    const catalog = await getPosCatalog();
    const scanned = catalog.find((item) => item.barcode === barcode);
    expect(scanned).toMatchObject({ id: productId, sku: `LITE-P0-${suffix}`, available: "5" });

    const quote = await quotePosPricing(cashier, {
      customerId: null,
      items: [{ productId, quantity: "1" }],
    });
    expect(quote).toMatchObject({
      channel: "POS",
      currency: "NPR",
      subtotal: "150.00",
      discountTotal: "0.00",
      finalTotal: "150.00",
    });
    expect(quote.items[0]).toMatchObject({
      sku: `LITE-P0-${suffix}`,
      regularUnitPrice: "150.00",
      appliedUnitPrice: "150.00",
      lineTotal: "150.00",
    });
    expect(quote.signedQuoteToken).toMatch(/^lite1\./);

    const result = await finalizeSale(cashier, {
      idempotencyKey: saleKey,
      paymentMethod: PaymentMethod.CASH,
      customerId: null,
      signedQuoteToken: quote.signedQuoteToken,
      items: [{ productId, quantity: "1" }],
    });

    expect(result.sale.receiptNumber).toMatch(/^POS-/);
    expect(result.sale.total.toFixed(2)).toBe("150.00");
    expect(result.sale.items[0].skuSnapshot).toBe(`LITE-P0-${suffix}`);
    expect(result.payment).toMatchObject({
      sourceType: PaymentSourceType.SALE,
      sourceId: result.sale.id,
      method: PaymentMethod.CASH,
      status: "PAID",
    });
    expect(result.payment.amount.toFixed(2)).toBe("150.00");

    const balance = await prisma.stockBalance.findUniqueOrThrow({
      where: { productId_locationId: { productId, locationId: storeId } },
    });
    expect(balance.onHand.toString()).toBe("4");
    expect(await prisma.inventoryMovement.count({
      where: {
        referenceType: "SALE",
        referenceId: result.sale.id,
        type: InventoryMovementType.POS_SALE,
      },
    })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { entityType: "Sale", entityId: result.sale.id, action: "POS_SALE_FINALIZED" },
    })).toBe(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();

    const replay = await finalizeSale(cashier, {
      idempotencyKey: saleKey,
      paymentMethod: PaymentMethod.CASH,
      customerId: null,
      signedQuoteToken: quote.signedQuoteToken,
      items: [{ productId, quantity: "1" }],
    });
    expect(replay.sale.id).toBe(result.sale.id);
    expect(await prisma.payment.count({ where: { sourceType: PaymentSourceType.SALE, sourceId: result.sale.id } })).toBe(1);
    expect((await prisma.stockBalance.findUniqueOrThrow({
      where: { productId_locationId: { productId, locationId: storeId } },
    })).onHand.toString()).toBe("4");
  });
});
