import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  InventoryMovementType,
  Role,
  TransferStatus,
} from "@/generated/prisma/client";
import { AuthorizationError } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import { reconcileInventoryBalance } from "@/modules/inventory/inventory.service";
import { createProduct } from "@/modules/products/product.service";
import { postPurchaseReceipt } from "@/modules/receiving/receipt.service";
import { createSupplier } from "@/modules/receiving/supplier.service";
import {
  cancelTransfer,
  createTransfer,
  dispatchTransfer,
  markTransferReady,
  receiveTransfer,
  transferItemInTransitQuantity,
} from "@/modules/transfers/transfer.service";

const suffix = randomUUID().slice(0, 8);

let owner: SessionUser;
let warehouseActor: SessionUser;
let cashier: SessionUser;
let productId: string;
let supplierId: string;
let warehouseId: string;
let storeId: string;
let primaryTransferId: string;
let primaryTransferItemId: string;

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

  cashier = {
    ...owner,
    role: Role.CASHIER_STORE,
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
    sku: `PHASE3-${suffix}`,
    barcode: `73${suffix.replace(/\D/g, "").padEnd(10, "3").slice(0, 10)}`,
    name: "Phase 3 Transfer Product",
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
    name: `Phase 3 Supplier ${suffix}`,
    phone: "",
    notes: "Transfer integration setup",
  });

  supplierId = supplier.id;

  await postPurchaseReceipt(warehouseActor, {
    supplierId,
    supplierReference: `PHASE3-OPENING-${suffix}`,
    notes: "Opening transfer test stock",
    idempotencyKey: `phase3-opening-${suffix}`,
    items: [
      {
        productId,
        quantity: "100",
        unitCost: "50.00",
      },
    ],
  });
});

async function balance(locationId: string) {
  return prisma.stockBalance.findUniqueOrThrow({
    where: {
      productId_locationId: {
        productId,
        locationId,
      },
    },
  });
}

describe("Phase 3 warehouse to store transfers", () => {
  it("rejects transfer creation from cashier role", async () => {
    await expect(
      createTransfer(cashier, {
        notes: "Unauthorized transfer",
        items: [
          {
            productId,
            requestedQuantity: "1",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("creates DRAFT then READY with no inventory effect", async () => {
    const transfer = await createTransfer(warehouseActor, {
      notes: "Primary Phase 3 transfer",
      items: [
        {
          productId,
          requestedQuantity: "20",
        },
      ],
    });

    primaryTransferId = transfer.id;
    primaryTransferItemId = transfer.items[0].id;

    expect(transfer.status).toBe(TransferStatus.DRAFT);
    expect((await balance(warehouseId)).onHand.toString()).toBe("100");
    expect((await balance(storeId)).onHand.toString()).toBe("0");

    const ready = await markTransferReady(
      warehouseActor,
      primaryTransferId,
    );

    expect(ready.status).toBe(TransferStatus.READY);
    expect((await balance(warehouseId)).onHand.toString()).toBe("100");
    expect((await balance(storeId)).onHand.toString()).toBe("0");

    const movementCount = await prisma.inventoryMovement.count({
      where: {
        referenceType: "TRANSFER",
        referenceId: primaryTransferId,
      },
    });

    expect(movementCount).toBe(0);
  });

  it("rejects dispatch from cashier role", async () => {
    await expect(
      dispatchTransfer(cashier, primaryTransferId, {
        idempotencyKey: `phase3-cashier-dispatch-${suffix}`,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("dispatches 20 exactly once: warehouse 80, store 0, in-transit 20", async () => {
    const key = `phase3-dispatch-${suffix}`;

    const dispatched = await dispatchTransfer(
      warehouseActor,
      primaryTransferId,
      {
        idempotencyKey: key,
      },
    );

    expect(dispatched.status).toBe(TransferStatus.DISPATCHED);
    expect(dispatched.items[0].dispatchedQuantity?.toString()).toBe("20");
    expect(dispatched.items[0].receivedQuantity).toBeNull();
    expect(
      transferItemInTransitQuantity(
        dispatched.items[0],
        dispatched.status,
      ).toString(),
    ).toBe("20");

    expect((await balance(warehouseId)).onHand.toString()).toBe("80");
    expect((await balance(storeId)).onHand.toString()).toBe("0");

    const movements = await prisma.inventoryMovement.findMany({
      where: {
        referenceType: "TRANSFER",
        referenceId: primaryTransferId,
        type: InventoryMovementType.TRANSFER_OUT,
      },
    });

    expect(movements).toHaveLength(1);
    expect(movements[0].locationId).toBe(warehouseId);
    expect(movements[0].quantityDelta.toString()).toBe("-20");

    const replay = await dispatchTransfer(
      warehouseActor,
      primaryTransferId,
      {
        idempotencyKey: key,
      },
    );

    expect(replay.id).toBe(primaryTransferId);
    expect((await balance(warehouseId)).onHand.toString()).toBe("80");

    const replayMovementCount = await prisma.inventoryMovement.count({
      where: {
        referenceType: "TRANSFER",
        referenceId: primaryTransferId,
        type: InventoryMovementType.TRANSFER_OUT,
      },
    });

    expect(replayMovementCount).toBe(1);
  });

  it("rejects store receipt from warehouse staff", async () => {
    await expect(
      receiveTransfer(warehouseActor, primaryTransferId, {
        idempotencyKey: `phase3-warehouse-receive-${suffix}`,
        items: [
          {
            transferItemId: primaryTransferItemId,
            receivedQuantity: "20",
            discrepancyReason: "",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("receives 20 exactly once: warehouse 80, store 20, in-transit 0", async () => {
    const key = `phase3-receive-${suffix}`;

    const received = await receiveTransfer(cashier, primaryTransferId, {
      idempotencyKey: key,
      items: [
        {
          transferItemId: primaryTransferItemId,
          receivedQuantity: "20",
          discrepancyReason: "",
        },
      ],
    });

    expect(received.status).toBe(TransferStatus.RECEIVED);
    expect(received.items[0].receivedQuantity?.toString()).toBe("20");
    expect(
      transferItemInTransitQuantity(
        received.items[0],
        received.status,
      ).toString(),
    ).toBe("0");

    expect((await balance(warehouseId)).onHand.toString()).toBe("80");
    expect((await balance(storeId)).onHand.toString()).toBe("20");

    const inMovements = await prisma.inventoryMovement.findMany({
      where: {
        referenceType: "TRANSFER",
        referenceId: primaryTransferId,
        type: InventoryMovementType.TRANSFER_IN,
      },
    });

    expect(inMovements).toHaveLength(1);
    expect(inMovements[0].locationId).toBe(storeId);
    expect(inMovements[0].quantityDelta.toString()).toBe("20");

    const warehouseReconciliation = await reconcileInventoryBalance(
      productId,
      warehouseId,
    );
    const storeReconciliation = await reconcileInventoryBalance(
      productId,
      storeId,
    );

    expect(warehouseReconciliation.matches).toBe(true);
    expect(warehouseReconciliation.projectedOnHand.toString()).toBe("80");
    expect(storeReconciliation.matches).toBe(true);
    expect(storeReconciliation.projectedOnHand.toString()).toBe("20");

    const replay = await receiveTransfer(cashier, primaryTransferId, {
      idempotencyKey: key,
      items: [
        {
          transferItemId: primaryTransferItemId,
          receivedQuantity: "20",
          discrepancyReason: "",
        },
      ],
    });

    expect(replay.id).toBe(primaryTransferId);
    expect((await balance(storeId)).onHand.toString()).toBe("20");

    const replayMovementCount = await prisma.inventoryMovement.count({
      where: {
        referenceType: "TRANSFER",
        referenceId: primaryTransferId,
        type: InventoryMovementType.TRANSFER_IN,
      },
    });

    expect(replayMovementCount).toBe(1);
  });

  it("rejects state skipping and cancellation after dispatch", async () => {
    const draft = await createTransfer(owner, {
      notes: "State transition test",
      items: [
        {
          productId,
          requestedQuantity: "2",
        },
      ],
    });

    await expect(
      dispatchTransfer(owner, draft.id, {
        idempotencyKey: `phase3-skip-${suffix}`,
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "INVALID_STATE_TRANSITION",
    });

    await markTransferReady(owner, draft.id);
    await dispatchTransfer(owner, draft.id, {
      idempotencyKey: `phase3-state-dispatch-${suffix}`,
    });

    await expect(cancelTransfer(owner, draft.id)).rejects.toMatchObject<
      Partial<BusinessError>
    >({
      code: "INVALID_STATE_TRANSITION",
    });
  });

  it("cancels a ready transfer without changing inventory", async () => {
    const beforeWarehouse = (await balance(warehouseId)).onHand.toString();
    const beforeStore = (await balance(storeId)).onHand.toString();

    const transfer = await createTransfer(warehouseActor, {
      notes: "Cancellation test",
      items: [
        {
          productId,
          requestedQuantity: "3",
        },
      ],
    });

    await markTransferReady(warehouseActor, transfer.id);
    const cancelled = await cancelTransfer(warehouseActor, transfer.id);

    expect(cancelled.status).toBe(TransferStatus.CANCELLED);
    expect((await balance(warehouseId)).onHand.toString()).toBe(
      beforeWarehouse,
    );
    expect((await balance(storeId)).onHand.toString()).toBe(beforeStore);

    const movementCount = await prisma.inventoryMovement.count({
      where: {
        referenceType: "TRANSFER",
        referenceId: transfer.id,
      },
    });

    expect(movementCount).toBe(0);
  });

  it("records a shortage explicitly and never creates stock above dispatch", async () => {
    const transfer = await createTransfer(owner, {
      notes: "Discrepancy test",
      items: [
        {
          productId,
          requestedQuantity: "5",
        },
      ],
    });

    await markTransferReady(owner, transfer.id);
    const dispatched = await dispatchTransfer(owner, transfer.id, {
      idempotencyKey: `phase3-discrepancy-dispatch-${suffix}`,
    });

    const itemId = dispatched.items[0].id;
    const storeBefore = (await balance(storeId)).onHand.toString();

    await expect(
      receiveTransfer(cashier, transfer.id, {
        idempotencyKey: `phase3-over-receive-${suffix}`,
        items: [
          {
            transferItemId: itemId,
            receivedQuantity: "6",
            discrepancyReason: "Unexpected extra unit",
          },
        ],
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "RECEIVED_EXCEEDS_DISPATCHED",
    });

    expect((await balance(storeId)).onHand.toString()).toBe(storeBefore);

    await expect(
      receiveTransfer(cashier, transfer.id, {
        idempotencyKey: `phase3-no-reason-${suffix}`,
        items: [
          {
            transferItemId: itemId,
            receivedQuantity: "4",
            discrepancyReason: "",
          },
        ],
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "DISCREPANCY_REASON_REQUIRED",
    });

    expect((await balance(storeId)).onHand.toString()).toBe(storeBefore);

    const received = await receiveTransfer(cashier, transfer.id, {
      idempotencyKey: `phase3-short-receive-${suffix}`,
      items: [
        {
          transferItemId: itemId,
          receivedQuantity: "4",
          discrepancyReason: "One unit missing from shipment",
        },
      ],
    });

    expect(received.status).toBe(TransferStatus.RECEIVED);
    expect(received.items[0].dispatchedQuantity?.toString()).toBe("5");
    expect(received.items[0].receivedQuantity?.toString()).toBe("4");
    expect(received.items[0].discrepancyReason).toBe(
      "One unit missing from shipment",
    );
    expect(
      transferItemInTransitQuantity(
        received.items[0],
        received.status,
      ).toString(),
    ).toBe("0");

    const storeAfter = await balance(storeId);
    expect(storeAfter.onHand.sub(storeBefore).toString()).toBe("4");

    const transferInCount = await prisma.inventoryMovement.count({
      where: {
        referenceType: "TRANSFER",
        referenceId: transfer.id,
        type: InventoryMovementType.TRANSFER_IN,
      },
    });

    expect(transferInCount).toBe(1);
  });
});
