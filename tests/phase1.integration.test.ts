import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  InventoryMovementType,
  LocationType,
  Role,
} from "@/generated/prisma/client";
import { AuthorizationError } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import {
  adjustInventory,
  reconcileInventoryBalance,
} from "@/modules/inventory/inventory.service";
import { createProduct } from "@/modules/products/product.service";

const suffix = randomUUID().slice(0, 8);
const sku = `PHASE1-${suffix}`;
const barcode = `9900${suffix.replace(/\D/g, "").padEnd(8, "1").slice(0, 8)}`;

let owner: SessionUser;
let warehouseId: string;
let productId: string;

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

  const warehouse = await prisma.location.findFirstOrThrow({
    where: {
      code: "WAREHOUSE_MAIN",
      type: LocationType.WAREHOUSE,
      active: true,
    },
  });

  warehouseId = warehouse.id;

  const product = await createProduct(owner, {
    sku,
    barcode,
    name: "Phase 1 Test Product",
    category: "Test",
    unit: "pcs",
    costPrice: "100.00",
    sellingPrice: "120.00",
    mrp: "125.00",
    warehouseMinStock: "2",
    storeMinStock: "1",
    active: true,
  });

  productId = product.id;
});

describe("Phase 1 products and inventory ledger", () => {
  it("creates zero stock projections for both V1 locations", async () => {
    const balances = await prisma.stockBalance.findMany({
      where: { productId },
      include: { location: true },
    });

    expect(balances).toHaveLength(2);
    expect(
      balances.map((balance) => balance.location.type).sort(),
    ).toEqual([LocationType.STORE, LocationType.WAREHOUSE].sort());

    for (const balance of balances) {
      expect(balance.onHand.toString()).toBe("0");
      expect(balance.reserved.toString()).toBe("0");
    }
  });

  it("rejects a duplicate SKU", async () => {
    await expect(
      createProduct(owner, {
        sku,
        barcode: `${barcode}9`,
        name: "Duplicate SKU",
        category: "Test",
        unit: "pcs",
        costPrice: "1.00",
        sellingPrice: "2.00",
        mrp: "",
        warehouseMinStock: "0",
        storeMinStock: "0",
        active: true,
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "SKU_EXISTS",
    });
  });

  it("rejects a duplicate barcode", async () => {
    await expect(
      createProduct(owner, {
        sku: `${sku}-BARCODE`,
        barcode,
        name: "Duplicate Barcode",
        category: "Test",
        unit: "pcs",
        costPrice: "1.00",
        sellingPrice: "2.00",
        mrp: "",
        warehouseMinStock: "0",
        storeMinStock: "0",
        active: true,
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "BARCODE_EXISTS",
    });
  });

  it("rejects stock adjustment from a cashier role", async () => {
    const cashier: SessionUser = {
      ...owner,
      role: Role.CASHIER_STORE,
    };

    await expect(
      adjustInventory(cashier, {
        productId,
        locationId: warehouseId,
        direction: "IN",
        quantity: "5",
        reason: "Unauthorized test",
        idempotencyKey: `phase1-unauthorized-${suffix}`,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("creates one immutable movement and matching balance for adjustment in", async () => {
    const key = `phase1-in-${suffix}`;

    const movement = await adjustInventory(owner, {
      productId,
      locationId: warehouseId,
      direction: "IN",
      quantity: "5",
      reason: "Physical count correction",
      idempotencyKey: key,
    });

    expect(movement.type).toBe(InventoryMovementType.ADJUSTMENT_IN);
    expect(movement.quantityDelta.toString()).toBe("5");

    const balance = await prisma.stockBalance.findUniqueOrThrow({
      where: {
        productId_locationId: {
          productId,
          locationId: warehouseId,
        },
      },
    });

    expect(balance.onHand.toString()).toBe("5");

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "STOCK_ADJUSTMENT_IN",
        entityId: movement.id,
      },
    });

    expect(audit).not.toBeNull();

    const reconciliation = await reconcileInventoryBalance(
      productId,
      warehouseId,
    );

    expect(reconciliation.matches).toBe(true);
    expect(reconciliation.projectedOnHand.toString()).toBe("5");
    expect(reconciliation.ledgerOnHand.toString()).toBe("5");
  });

  it("is idempotent when the same adjustment command is replayed", async () => {
    const key = `phase1-replay-${suffix}`;

    const first = await adjustInventory(owner, {
      productId,
      locationId: warehouseId,
      direction: "IN",
      quantity: "2",
      reason: "Replay safety test",
      idempotencyKey: key,
    });

    const second = await adjustInventory(owner, {
      productId,
      locationId: warehouseId,
      direction: "IN",
      quantity: "2",
      reason: "Replay safety test",
      idempotencyKey: key,
    });

    expect(second.id).toBe(first.id);

    const movements = await prisma.inventoryMovement.count({
      where: { idempotencyKey: key },
    });

    expect(movements).toBe(1);

    const balance = await prisma.stockBalance.findUniqueOrThrow({
      where: {
        productId_locationId: {
          productId,
          locationId: warehouseId,
        },
      },
    });

    expect(balance.onHand.toString()).toBe("7");
  });

  it("rejects reuse of an idempotency key for a different command", async () => {
    const key = `phase1-conflict-${suffix}`;

    await adjustInventory(owner, {
      productId,
      locationId: warehouseId,
      direction: "IN",
      quantity: "1",
      reason: "Idempotency conflict baseline",
      idempotencyKey: key,
    });

    await expect(
      adjustInventory(owner, {
        productId,
        locationId: warehouseId,
        direction: "IN",
        quantity: "2",
        reason: "Different command",
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "IDEMPOTENCY_CONFLICT",
    });
  });

  it("rejects an adjustment that would create negative physical stock", async () => {
    await expect(
      adjustInventory(owner, {
        productId,
        locationId: warehouseId,
        direction: "OUT",
        quantity: "100",
        reason: "Negative stock protection test",
        idempotencyKey: `phase1-negative-${suffix}`,
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "INSUFFICIENT_STOCK",
    });

    const balance = await prisma.stockBalance.findUniqueOrThrow({
      where: {
        productId_locationId: {
          productId,
          locationId: warehouseId,
        },
      },
    });

    expect(balance.onHand.toString()).toBe("8");
  });

  it("keeps projection and ledger reconciled after adjustment out", async () => {
    await adjustInventory(owner, {
      productId,
      locationId: warehouseId,
      direction: "OUT",
      quantity: "2",
      reason: "Physical count correction",
      idempotencyKey: `phase1-out-${suffix}`,
    });

    const reconciliation = await reconcileInventoryBalance(
      productId,
      warehouseId,
    );

    expect(reconciliation.matches).toBe(true);
    expect(reconciliation.projectedOnHand.toString()).toBe("6");
    expect(reconciliation.ledgerOnHand.toString()).toBe("6");
  });

  it("enforces inventory movement immutability in PostgreSQL", async () => {
    const movement = await prisma.inventoryMovement.findFirstOrThrow({
      where: {
        productId,
        locationId: warehouseId,
      },
    });

    await expect(
      prisma.inventoryMovement.update({
        where: { id: movement.id },
        data: { reason: "This update must be rejected" },
      }),
    ).rejects.toThrow();
  });

  it("has no hidden StockBalance mutation path outside approved services", async () => {
    const srcRoot = path.join(process.cwd(), "src");
    const offenders: string[] = [];
    const allowed = new Set([
      path.join(srcRoot, "modules", "inventory", "inventory.service.ts"),
      path.join(srcRoot, "modules", "products", "product.service.ts"),
    ]);

    async function walk(directory: string): Promise<void> {
      const entries = await readdir(directory, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          if (entry.name === "generated") {
            continue;
          }

          await walk(fullPath);
          continue;
        }

        if (
          !entry.name.endsWith(".ts") &&
          !entry.name.endsWith(".tsx")
        ) {
          continue;
        }

        if (entry.name.includes(".test.")) {
          continue;
        }

        const source = await readFile(fullPath, "utf8");
        const mutatesStockBalance =
          /stockBalance\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(
            source,
          );

        if (mutatesStockBalance && !allowed.has(fullPath)) {
          offenders.push(path.relative(process.cwd(), fullPath));
        }
      }
    }

    await walk(srcRoot);

    expect(offenders).toEqual([]);
  });
});
