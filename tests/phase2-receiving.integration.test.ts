import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  InventoryMovementType,
  LocationType,
  PurchaseReceiptStatus,
  Role,
} from "@/generated/prisma/client";
import { AuthorizationError } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import { reconcileInventoryBalance } from "@/modules/inventory/inventory.service";
import { createProduct } from "@/modules/products/product.service";
import { postPurchaseReceipt } from "@/modules/receiving/receipt.service";
import { createSupplier } from "@/modules/receiving/supplier.service";

const suffix = randomUUID().slice(0, 8);
const idempotencyKey = `phase2-receipt-${suffix}`;

let owner: SessionUser;
let warehouseActor: SessionUser;
let productId: string;
let supplierId: string;
let warehouseId: string;
let storeId: string;
let postedReceiptId: string;

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

  warehouseActor = {
    ...owner,
    role: Role.WAREHOUSE_STAFF,
  };

  const warehouse = await prisma.location.findUniqueOrThrow({
    where: { code: "WAREHOUSE_MAIN" },
  });
  const store = await prisma.location.findUniqueOrThrow({
    where: { code: "STORE_MAIN" },
  });

  warehouseId = warehouse.id;
  storeId = store.id;

  const product = await createProduct(owner, {
    sku: `PHASE2-${suffix}`,
    barcode: `82${suffix.replace(/\D/g, "").padEnd(10, "7").slice(0, 10)}`,
    name: "Phase 2 Receiving Product",
    category: "Test",
    unit: "pcs",
    costPrice: "40.00",
    sellingPrice: "60.00",
    mrp: "65.00",
    warehouseMinStock: "5",
    storeMinStock: "2",
    active: true,
  });

  productId = product.id;

  const supplier = await createSupplier(owner, {
    name: `Phase 2 Supplier ${suffix}`,
    phone: "",
    notes: "Receiving integration test",
  });

  supplierId = supplier.id;
});

describe("Phase 2 warehouse receiving", () => {
  it("rejects receipt posting from a cashier role", async () => {
    const cashier: SessionUser = {
      ...owner,
      role: Role.CASHIER_STORE,
    };

    await expect(
      postPurchaseReceipt(cashier, {
        supplierId,
        supplierReference: "DENIED",
        notes: "",
        idempotencyKey: `phase2-denied-${suffix}`,
        items: [
          {
            productId,
            quantity: "1",
            unitCost: "50.00",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("posts 100 units into warehouse exactly once", async () => {
    const receipt = await postPurchaseReceipt(warehouseActor, {
      supplierId,
      supplierReference: `INV-${suffix}`,
      notes: "Initial Phase 2 receipt",
      idempotencyKey,
      items: [
        {
          productId,
          quantity: "100",
          unitCost: "50.00",
        },
      ],
    });

    postedReceiptId = receipt.id;

    expect(receipt.status).toBe(PurchaseReceiptStatus.POSTED);
    expect(receipt.items).toHaveLength(1);
    expect(receipt.items[0].quantity.toString()).toBe("100");
    expect(receipt.items[0].unitCost.toFixed(2)).toBe("50.00");
    expect(receipt.items[0].lineTotal.toFixed(2)).toBe("5000.00");

    const warehouseBalance = await prisma.stockBalance.findUniqueOrThrow({
      where: {
        productId_locationId: {
          productId,
          locationId: warehouseId,
        },
      },
    });
    const storeBalance = await prisma.stockBalance.findUniqueOrThrow({
      where: {
        productId_locationId: {
          productId,
          locationId: storeId,
        },
      },
    });

    expect(warehouseBalance.onHand.toString()).toBe("100");
    expect(warehouseBalance.reserved.toString()).toBe("0");
    expect(storeBalance.onHand.toString()).toBe("0");
    expect(storeBalance.reserved.toString()).toBe("0");

    const movements = await prisma.inventoryMovement.findMany({
      where: {
        referenceType: "PURCHASE_RECEIPT",
        referenceId: receipt.id,
        productId,
      },
    });

    expect(movements).toHaveLength(1);
    expect(movements[0].type).toBe(
      InventoryMovementType.PURCHASE_RECEIPT,
    );
    expect(movements[0].quantityDelta.toString()).toBe("100");

    const reconciliation = await reconcileInventoryBalance(
      productId,
      warehouseId,
    );

    expect(reconciliation.matches).toBe(true);
    expect(reconciliation.projectedOnHand.toString()).toBe("100");
    expect(reconciliation.ledgerOnHand.toString()).toBe("100");

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
    });

    expect(product.costPrice.toFixed(2)).toBe("40.00");

    const audit = await prisma.auditLog.findFirst({
      where: {
        entityType: "PurchaseReceipt",
        entityId: receipt.id,
        action: "PURCHASE_RECEIPT_POSTED",
      },
    });

    expect(audit).not.toBeNull();
  });

  it("replays the same receipt without duplicating receipt, movement, or stock", async () => {
    const replay = await postPurchaseReceipt(warehouseActor, {
      supplierId,
      supplierReference: `INV-${suffix}`,
      notes: "Initial Phase 2 receipt",
      idempotencyKey,
      items: [
        {
          productId,
          quantity: "100",
          unitCost: "50.00",
        },
      ],
    });

    expect(replay.id).toBe(postedReceiptId);

    const receiptCount = await prisma.purchaseReceipt.count({
      where: { idempotencyKey },
    });
    const movementCount = await prisma.inventoryMovement.count({
      where: {
        referenceType: "PURCHASE_RECEIPT",
        referenceId: postedReceiptId,
        productId,
      },
    });
    const warehouseBalance = await prisma.stockBalance.findUniqueOrThrow({
      where: {
        productId_locationId: {
          productId,
          locationId: warehouseId,
        },
      },
    });

    expect(receiptCount).toBe(1);
    expect(movementCount).toBe(1);
    expect(warehouseBalance.onHand.toString()).toBe("100");
  });

  it("rejects reuse of the receipt idempotency key for different contents", async () => {
    await expect(
      postPurchaseReceipt(warehouseActor, {
        supplierId,
        supplierReference: `INV-${suffix}`,
        notes: "Initial Phase 2 receipt",
        idempotencyKey,
        items: [
          {
            productId,
            quantity: "101",
            unitCost: "50.00",
          },
        ],
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "IDEMPOTENCY_CONFLICT",
    });

    const warehouseBalance = await prisma.stockBalance.findUniqueOrThrow({
      where: {
        productId_locationId: {
          productId,
          locationId: warehouseId,
        },
      },
    });

    expect(warehouseBalance.onHand.toString()).toBe("100");
  });

  it("rejects duplicate product lines within one receipt", async () => {
    await expect(
      postPurchaseReceipt(owner, {
        supplierId,
        supplierReference: "DUPLICATE-LINE",
        notes: "",
        idempotencyKey: `phase2-duplicate-line-${suffix}`,
        items: [
          {
            productId,
            quantity: "1",
            unitCost: "50.00",
          },
          {
            productId,
            quantity: "2",
            unitCost: "50.00",
          },
        ],
      }),
    ).rejects.toThrow();

    const receipt = await prisma.purchaseReceipt.findUnique({
      where: {
        idempotencyKey: `phase2-duplicate-line-${suffix}`,
      },
    });

    expect(receipt).toBeNull();
  });

  it("keeps posted receipt facts immutable in PostgreSQL", async () => {
    await expect(
      prisma.purchaseReceipt.update({
        where: { id: postedReceiptId },
        data: {
          supplierReference: "MUTATED",
        },
      }),
    ).rejects.toThrow();

    const receipt = await prisma.purchaseReceipt.findUniqueOrThrow({
      where: { id: postedReceiptId },
    });

    expect(receipt.supplierReference).toBe(`INV-${suffix}`);
  });

  it("keeps posted receipt items append-only in PostgreSQL", async () => {
    const item = await prisma.purchaseReceiptItem.findFirstOrThrow({
      where: { purchaseReceiptId: postedReceiptId },
    });

    await expect(
      prisma.purchaseReceiptItem.update({
        where: { id: item.id },
        data: {
          quantity: "200",
        },
      }),
    ).rejects.toThrow();

    const persisted = await prisma.purchaseReceiptItem.findUniqueOrThrow({
      where: { id: item.id },
    });

    expect(persisted.quantity.toString()).toBe("100");
  });

  it("records receiving only against the central warehouse", async () => {
    const movements = await prisma.inventoryMovement.findMany({
      where: {
        referenceType: "PURCHASE_RECEIPT",
        referenceId: postedReceiptId,
      },
      include: {
        location: true,
      },
    });

    expect(movements).toHaveLength(1);
    expect(movements[0].location.id).toBe(warehouseId);
    expect(movements[0].location.type).toBe(LocationType.WAREHOUSE);
    expect(movements[0].location.code).toBe("WAREHOUSE_MAIN");
  });
});
