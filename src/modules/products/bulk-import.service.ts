import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { Prisma, Role } from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth/session";
import { assertRole } from "@/lib/auth/authorization";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import { productInputSchema } from "./product.schemas";
import { BULK_HEADERS, HEADER_ALIASES, normalizeHeader, parseBoolean, type BulkPreviewRow, type BulkRow } from "./bulk-import.schemas";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 5000;

function text(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export async function parseProductFile(fileName: string, bytes: Uint8Array): Promise<BulkRow[]> {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new BusinessError("BULK_FILE_TOO_LARGE", "The file must be 10 MB or smaller.");
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension !== "csv" && extension !== "xlsx") throw new BusinessError("BULK_FILE_UNSUPPORTED", "Upload a CSV or XLSX file.");
  const workbook = new ExcelJS.Workbook();
  if (extension === "xlsx") {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new BusinessError("BULK_FILE_UNSUPPORTED", "Invalid XLSX file.");
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } else {
    await workbook.csv.read(Readable.from([Buffer.from(bytes)]));
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new BusinessError("BULK_FILE_INVALID", "The workbook has no worksheet.");
  const matrix: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      const value = cell.value;
      if (typeof value === "number") {
        if (!Number.isSafeInteger(value) && column === 2) throw new BusinessError("BULK_INVALID_ROW", "A numeric barcode exceeds safe precision. Format barcode cells as text.");
        cells[column - 1] = String(value);
      } else if (value && typeof value === "object") {
        cells[column - 1] = "text" in value ? value.text : "result" in value ? value.result : "";
      } else cells[column - 1] = value ?? "";
    });
    matrix.push(cells);
  });
  const headerRow = matrix.find((row) => row.some((cell) => text(cell)));
  if (!headerRow) throw new BusinessError("BULK_FILE_INVALID", "The file is empty.");
  const mapped = headerRow.map((cell) => HEADER_ALIASES[normalizeHeader(text(cell))]);
  if (new Set(mapped.filter(Boolean)).size !== mapped.filter(Boolean).length) throw new BusinessError("BULK_REQUIRED_COLUMN_MISSING", "The file contains ambiguous duplicate headers.");
  const missing = BULK_HEADERS.filter((header) => !["Barcode", "MRP", "Active"].includes(header) && !mapped.includes(header));
  if (missing.length) throw new BusinessError("BULK_REQUIRED_COLUMN_MISSING", `Missing required columns: ${missing.join(", ")}.`);
  const rows = matrix.slice(matrix.indexOf(headerRow) + 1).filter((row) => row.some((cell) => text(cell)));
  if (rows.length > MAX_ROWS) throw new BusinessError("BULK_ROW_LIMIT_EXCEEDED", `A maximum of ${MAX_ROWS} products may be imported.`);
  return rows.map((row) => {
    const values = Object.fromEntries(mapped.map((header, index) => [header, text(row[index])]));
    return { sku: values["SKU"] ?? "", barcode: values["Barcode"] ?? "", name: values["Product Name"] ?? "", category: values["Category"] ?? "", unit: values["Unit"] ?? "", costPrice: values["Cost Price"] ?? "", sellingPrice: values["Selling Price"] ?? "", mrp: values["MRP"] ?? "", warehouseMinStock: values["Warehouse Minimum"] ?? "", storeMinStock: values["Store Minimum"] ?? "", active: values["Active"] ?? "" };
  });
}

export async function previewBulkProducts(actor: SessionUser, rows: BulkRow[]) {
  assertRole(actor.role, [Role.OWNER_ADMIN]);
  const skus = rows.map((row) => row.sku.trim().toUpperCase());
  const barcodes = rows.map((row) => row.barcode.trim()).filter(Boolean);
  const [existingSkus, existingBarcodes] = await Promise.all([
    prisma.product.findMany({ where: { sku: { in: skus } }, select: { sku: true } }),
    prisma.product.findMany({ where: { barcode: { in: barcodes } }, select: { barcode: true } }),
  ]);
  const skuSet = new Set(existingSkus.map((row) => row.sku));
  const barcodeSet = new Set(existingBarcodes.flatMap((row) => row.barcode ? [row.barcode] : []));
  const seenSku = new Set<string>(); const seenBarcode = new Set<string>();
  return rows.map((row, index): BulkPreviewRow => {
    const normalized = { ...row, sku: row.sku.trim().toUpperCase(), barcode: row.barcode.trim(), active: row.active.trim() || "true" };
    let error = "";
    if (seenSku.has(normalized.sku)) error = "BULK_DUPLICATE_SKU: duplicate SKU in file.";
    else if (skuSet.has(normalized.sku)) error = "BULK_SKU_EXISTS: SKU already exists.";
    else if (normalized.barcode && seenBarcode.has(normalized.barcode)) error = "BULK_DUPLICATE_BARCODE: duplicate barcode in file.";
    else if (normalized.barcode && barcodeSet.has(normalized.barcode)) error = "BULK_BARCODE_EXISTS: barcode already exists.";
    else if (parseBoolean(normalized.active) === null) error = "BULK_INVALID_ROW: Active must be true or false.";
    else {
      try { productInputSchema.parse({ ...normalized, active: parseBoolean(normalized.active) }); }
      catch (e) { error = `BULK_INVALID_ROW: ${e instanceof Error ? e.message : "invalid product fields."}`; }
    }
    seenSku.add(normalized.sku); if (normalized.barcode) seenBarcode.add(normalized.barcode);
    return { ...normalized, rowNumber: index + 2, status: error ? "INVALID" : "VALID", ...(error ? { error } : {}) };
  });
}

export async function importBulkProducts(actor: SessionUser, rows: BulkRow[], batchId: string, fileName: string) {
  assertRole(actor.role, [Role.OWNER_ADMIN]);
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS || !/^[0-9a-f-]{36}$/i.test(batchId)) throw new BusinessError("BULK_IMPORT_FAILED", "Invalid import request.");
  const fingerprint = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  const prior = await prisma.auditLog.findFirst({ where: { action: "PRODUCT_BULK_IMPORT_COMPLETED", entityType: "ProductImport", entityId: batchId } });
  if (prior) {
    const metadata = prior.metadata as { createdCount?: number; fingerprint?: string } | null;
    if (prior.actorUserId !== actor.id || metadata?.fingerprint !== fingerprint) throw new BusinessError("BULK_IMPORT_CONFLICT", "This import token belongs to a different batch.");
    return { imported: Number(metadata?.createdCount ?? 0), repeated: true };
  }
  const preview = await previewBulkProducts(actor, rows);
  if (preview.some((row) => row.status !== "VALID")) throw new BusinessError("BULK_IMPORT_CONFLICT", "The batch changed or contains invalid rows; nothing was imported.");
  try {
  return await prisma.$transaction(async (tx) => {
    const locations = await tx.location.findMany({ where: { active: true }, select: { id: true } });
    let createdCount = 0;
    for (let start = 0; start < preview.length; start += 250) {
      const chunk = preview.slice(start, start + 250).map((row) => {
        const parsed = productInputSchema.parse({ ...row, active: parseBoolean(row.active) });
        return { sku: parsed.sku, barcode: parsed.barcode, name: parsed.name, category: parsed.category, unit: parsed.unit, costPrice: new Prisma.Decimal(parsed.costPrice), sellingPrice: new Prisma.Decimal(parsed.sellingPrice), mrp: parsed.mrp ? new Prisma.Decimal(parsed.mrp) : null, warehouseMinStock: new Prisma.Decimal(parsed.warehouseMinStock), storeMinStock: new Prisma.Decimal(parsed.storeMinStock), active: parsed.active };
      });
      const created = await tx.product.createManyAndReturn({ data: chunk });
      createdCount += created.length;
      if (locations.length) await tx.stockBalance.createMany({ data: created.flatMap((product) => locations.map((location) => ({ productId: product.id, locationId: location.id, onHand: new Prisma.Decimal(0), reserved: new Prisma.Decimal(0) }))) });
      await tx.auditLog.createMany({ data: created.map((product) => ({ actorUserId: actor.id, action: "PRODUCT_CREATED", entityType: "Product", entityId: product.id, afterData: { sku: product.sku, barcode: product.barcode, name: product.name } })) });
    }
    await tx.auditLog.create({ data: { actorUserId: actor.id, action: "PRODUCT_BULK_IMPORT_COMPLETED", entityType: "ProductImport", entityId: batchId, metadata: { batchId, fingerprint, filename: fileName.replace(/[\\/]/g, "_").slice(0, 200), rowCount: rows.length, createdCount } } });
    return { imported: createdCount, repeated: false };
  }, { timeout: 120_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new BusinessError("BULK_IMPORT_CONFLICT", "A SKU or barcode was added during import. Nothing was imported; preview the file again.");
    }
    throw error;
  }
}
