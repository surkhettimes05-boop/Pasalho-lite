import { randomUUID } from "node:crypto";
import { File } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  InventoryMovementType,
  Role,
} from "@/generated/prisma/client";
import { AuthorizationError } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import {
  commitBulkProductImport,
  previewBulkProductImport,
} from "@/modules/products/bulk-import.service";
import {
  MAX_BULK_PRODUCT_FILE_BYTES,
  MAX_BULK_PRODUCT_ROWS,
} from "@/modules/products/bulk-import.schemas";
import { createProduct } from "@/modules/products/product.service";
import { postPurchaseReceipt } from "@/modules/receiving/receipt.service";
import { createSupplier } from "@/modules/receiving/supplier.service";

const HEADER =
  "SKU,Barcode,Product Name,Category,Unit,Cost Price,Selling Price,MRP,Warehouse Minimum,Store Minimum,Active";
const suffix = randomUUID().slice(0, 8);

let owner: SessionUser;
let cashier: SessionUser;
let warehouse: SessionUser;
let activeLocations = 0;
let importedReceiptProductId = "";

function csvFile(lines: string[], name = "products.csv") {
  return new File([[HEADER, ...lines].join("\n")], name, {
    type: "text/csv",
  }) as unknown as globalThis.File;
}

beforeAll(async () => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: process.env.SEED_OWNER_EMAIL!.toLowerCase() },
  });
  owner = { id: user.id, name: user.name, email: user.email, role: user.role };
  cashier = { ...owner, role: Role.CASHIER_STORE };
  warehouse = { ...owner, role: Role.WAREHOUSE_STAFF };
  activeLocations = await prisma.location.count({ where: { active: true } });

  const staleXlsx = await prisma.product.findUnique({
    where: { sku: "BULK-XLSX-ONE" },
  });
  if (staleXlsx) {
    await prisma.stockBalance.deleteMany({ where: { productId: staleXlsx.id } });
    await prisma.product.delete({ where: { id: staleXlsx.id } });
  }
});

describe("bulk SKU import", () => {
  it("imports a valid CSV atomically with zero balances and no inventory movement", async () => {
    const key = `bulk-csv-${suffix}`;
    const file = csvFile([
      `BULK-A-${suffix},880000000001,Active Product,Test,pcs,10,20,25,5,2,`,
      `BULK-B-${suffix},,No Barcode Product,Test,pcs,11,21,,5,2,true`,
      `BULK-C-${suffix},880000000003,Inactive Product,Test,pcs,12,22,25,5,2,false`,
    ]);

    const before = {
      products: await prisma.product.count(),
      balances: await prisma.stockBalance.count(),
      movements: await prisma.inventoryMovement.count(),
    };

    const preview = await previewBulkProductImport(owner, file);
    expect(preview.totalRows).toBe(3);
    expect(preview.validRows).toBe(3);
    expect(preview.invalidRows).toBe(0);

    const result = await commitBulkProductImport(owner, {
      file,
      idempotencyKey: key,
    });
    expect(result.createdCount).toBe(3);
    expect(result.replayed).toBe(false);

    const created = await prisma.product.findMany({
      where: { sku: { in: [`BULK-A-${suffix}`, `BULK-B-${suffix}`, `BULK-C-${suffix}`] } },
      orderBy: { sku: "asc" },
      include: { stockBalances: true },
    });
    expect(created).toHaveLength(3);
    expect(created[0].active).toBe(true);
    expect(created[1].barcode).toBeNull();
    expect(created[1].mrp).toBeNull();
    expect(created[2].active).toBe(false);

    for (const product of created) {
      expect(product.stockBalances).toHaveLength(activeLocations);
      expect(product.stockBalances.every((balance) => balance.onHand.isZero())).toBe(true);
      expect(product.stockBalances.every((balance) => balance.reserved.isZero())).toBe(true);
    }

    expect(await prisma.product.count()).toBe(before.products + 3);
    expect(await prisma.stockBalance.count()).toBe(
      before.balances + 3 * activeLocations,
    );
    expect(await prisma.inventoryMovement.count()).toBe(before.movements);

    const batch = await prisma.productImportBatch.findUniqueOrThrow({
      where: { idempotencyKey: key },
    });
    expect(batch.createdCount).toBe(3);

    expect(
      await prisma.auditLog.count({
        where: {
          action: "PRODUCT_CREATED",
          metadata: { path: ["importBatchId"], equals: batch.id },
        },
      }),
    ).toBe(3);
    expect(
      await prisma.auditLog.count({
        where: {
          action: "PRODUCT_BULK_IMPORT_COMPLETED",
          entityId: batch.id,
        },
      }),
    ).toBe(1);

    importedReceiptProductId = created[0].id;
  });

  it("replays a committed batch without duplicate products, balances, movements or batch audit", async () => {
    const key = `bulk-replay-${suffix}`;
    const file = csvFile([
      `BULK-R-${suffix},880000000011,Replay Product,Test,pcs,10,20,,0,0,true`,
    ]);

    const first = await commitBulkProductImport(owner, {
      file,
      idempotencyKey: key,
    });

    const afterFirst = {
      products: await prisma.product.count(),
      balances: await prisma.stockBalance.count(),
      movements: await prisma.inventoryMovement.count(),
      batchAudits: await prisma.auditLog.count({
        where: {
          action: "PRODUCT_BULK_IMPORT_COMPLETED",
          entityId: first.batchId,
        },
      }),
    };

    const second = await commitBulkProductImport(owner, {
      file,
      idempotencyKey: key,
    });

    expect(second.batchId).toBe(first.batchId);
    expect(second.replayed).toBe(true);
    expect(await prisma.product.count()).toBe(afterFirst.products);
    expect(await prisma.stockBalance.count()).toBe(afterFirst.balances);
    expect(await prisma.inventoryMovement.count()).toBe(afterFirst.movements);
    expect(
      await prisma.auditLog.count({
        where: {
          action: "PRODUCT_BULK_IMPORT_COMPLETED",
          entityId: first.batchId,
        },
      }),
    ).toBe(afterFirst.batchAudits);
  });

  it("rejects reusing an import key for a different file", async () => {
    const key = `bulk-conflict-${suffix}`;
    await commitBulkProductImport(owner, {
      file: csvFile([
        `BULK-K1-${suffix},880000000021,Key Product One,Test,pcs,10,20,,0,0,true`,
      ], "first.csv"),
      idempotencyKey: key,
    });

    await expect(
      commitBulkProductImport(owner, {
        file: csvFile([
          `BULK-K2-${suffix},880000000022,Key Product Two,Test,pcs,10,20,,0,0,true`,
        ], "second.csv"),
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "BULK_IMPORT_CONFLICT",
    });
  });

  it("denies Cashier and Warehouse Staff", async () => {
    const file = csvFile([
      `BULK-DENY-${suffix},880000000031,Denied Product,Test,pcs,10,20,,0,0,true`,
    ]);

    await expect(previewBulkProductImport(cashier, file)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(
      commitBulkProductImport(warehouse, {
        file,
        idempotencyKey: `bulk-deny-${suffix}`,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("marks duplicate SKU and barcode rows invalid and imports nothing", async () => {
    const file = csvFile([
      `BULK-DUP-${suffix},880000000041,Duplicate One,Test,pcs,10,20,,0,0,true`,
      `BULK-DUP-${suffix},880000000041,Duplicate Two,Test,pcs,10,20,,0,0,true`,
    ]);
    const before = await prisma.product.count();

    const preview = await previewBulkProductImport(owner, file);
    expect(preview.invalidRows).toBe(2);
    expect(preview.rows.every((row) => row.errors.some((error) => error.includes("Duplicate SKU")))).toBe(true);
    expect(preview.rows.every((row) => row.errors.some((error) => error.includes("Duplicate barcode")))).toBe(true);

    await expect(
      commitBulkProductImport(owner, {
        file,
        idempotencyKey: `bulk-dup-${suffix}`,
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({ code: "BULK_INVALID_ROW" });
    expect(await prisma.product.count()).toBe(before);
  });

  it("rejects existing database SKU/barcode before import", async () => {
    const existing = await createProduct(owner, {
      sku: `BULK-EXIST-${suffix}`,
      barcode: `8899${suffix}`,
      name: "Existing Bulk Guard",
      category: "Test",
      unit: "pcs",
      costPrice: "10.00",
      sellingPrice: "20.00",
      mrp: "",
      warehouseMinStock: "0",
      storeMinStock: "0",
      active: true,
    });

    const file = csvFile([
      `${existing.sku},${existing.barcode},Collision,Test,pcs,10,20,,0,0,true`,
    ]);
    const preview = await previewBulkProductImport(owner, file);
    expect(preview.invalidRows).toBe(1);
    expect(preview.rows[0].errors).toContain("SKU already exists in Pasalho.");
    expect(preview.rows[0].errors).toContain("Barcode already exists in Pasalho.");
  });

  it("rolls back the whole batch when one row is invalid", async () => {
    const goodSku = `BULK-ATOMIC-G-${suffix}`;
    const badSku = `BULK-ATOMIC-B-${suffix}`;
    const file = csvFile([
      `${goodSku},880000000051,Good Atomic Product,Test,pcs,10,20,,0,0,true`,
      `${badSku},880000000052,Bad Atomic Product,Test,pcs,not-money,20,,0,0,true`,
    ]);

    await expect(
      commitBulkProductImport(owner, {
        file,
        idempotencyKey: `bulk-atomic-${suffix}`,
      }),
    ).rejects.toMatchObject<Partial<BusinessError>>({ code: "BULK_INVALID_ROW" });

    expect(
      await prisma.product.count({
        where: { sku: { in: [goodSku, badSku] } },
      }),
    ).toBe(0);
  });

  it("rejects missing required columns, files over 10 MB, and more than 5,000 rows", async () => {
    const missingHeader = new File(
      ["SKU,Product Name\nONLY-SKU,Missing Columns"],
      "missing.csv",
      { type: "text/csv" },
    ) as unknown as globalThis.File;
    const preview = await previewBulkProductImport(owner, missingHeader);
    expect(preview.globalErrors.length).toBeGreaterThan(0);

    const tooLarge = new File(
      [new Uint8Array(MAX_BULK_PRODUCT_FILE_BYTES + 1)],
      "large.csv",
      { type: "text/csv" },
    ) as unknown as globalThis.File;
    await expect(previewBulkProductImport(owner, tooLarge)).rejects.toMatchObject<
      Partial<BusinessError>
    >({ code: "BULK_FILE_TOO_LARGE" });

    const manyRows = Array.from({ length: MAX_BULK_PRODUCT_ROWS + 1 }, (_, index) =>
      `BULK-LIMIT-${suffix}-${index},,Limit Product ${index},Test,pcs,1,2,,0,0,true`,
    );
    await expect(
      previewBulkProductImport(owner, csvFile(manyRows, "too-many.csv")),
    ).rejects.toMatchObject<Partial<BusinessError>>({
      code: "BULK_ROW_LIMIT_EXCEEDED",
    });
  });

  it("imports XLSX and preserves a leading-zero barcode stored as text", async () => {
    const fixture = await readFile(
      path.join(process.cwd(), "tests", "fixtures", "bulk-products.xlsx"),
    );
    const file = new File([fixture], "bulk-products.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }) as unknown as globalThis.File;

    const preview = await previewBulkProductImport(owner, file);
    expect(preview.validRows).toBe(1);
    expect(preview.rows[0].barcode).toBe("0890123456789");

    const result = await commitBulkProductImport(owner, {
      file,
      idempotencyKey: `bulk-xlsx-${suffix}`,
    });
    expect(result.createdCount).toBe(1);

    const product = await prisma.product.findUniqueOrThrow({
      where: { sku: "BULK-XLSX-ONE" },
      include: { stockBalances: true },
    });
    expect(product.barcode).toBe("0890123456789");
    expect(product.stockBalances).toHaveLength(activeLocations);
    expect(product.stockBalances.every((balance) => balance.onHand.isZero())).toBe(true);
  });

  it("allows imported products to gain stock only through a posted purchase receipt", async () => {
    expect(importedReceiptProductId).not.toBe("");
    const warehouseLocation = await prisma.location.findUniqueOrThrow({
      where: { code: "WAREHOUSE_MAIN" },
    });
    const before = await prisma.stockBalance.findUniqueOrThrow({
      where: {
        productId_locationId: {
          productId: importedReceiptProductId,
          locationId: warehouseLocation.id,
        },
      },
    });
    expect(before.onHand.isZero()).toBe(true);

    const supplier = await createSupplier(owner, {
      name: `Bulk Import Supplier ${suffix}`,
      phone: "",
      notes: "Bulk import receiving proof",
    });
    await postPurchaseReceipt(warehouse, {
      supplierId: supplier.id,
      supplierReference: `BULK-REC-${suffix}`,
      notes: "Receive imported SKU",
      idempotencyKey: `bulk-receipt-${suffix}`,
      items: [
        {
          productId: importedReceiptProductId,
          quantity: "100",
          unitCost: "10.00",
        },
      ],
    });

    const after = await prisma.stockBalance.findUniqueOrThrow({
      where: {
        productId_locationId: {
          productId: importedReceiptProductId,
          locationId: warehouseLocation.id,
        },
      },
    });
    expect(after.onHand.toString()).toBe("100");
    expect(
      await prisma.inventoryMovement.count({
        where: {
          productId: importedReceiptProductId,
          locationId: warehouseLocation.id,
          type: InventoryMovementType.PURCHASE_RECEIPT,
        },
      }),
    ).toBe(1);
  });
});
