import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { readSheet } from "read-excel-file/node";
import {
  Prisma,
  Role,
} from "@/generated/prisma/client";
import { assertRole } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import {
  initializeProductZeroBalances,
  normalizeProductInput,
  productAuditSnapshot,
} from "@/modules/products/product.service";
import { productInputSchema } from "@/modules/products/product.schemas";
import {
  MAX_BULK_PRODUCT_FILE_BYTES,
  MAX_BULK_PRODUCT_ROWS,
  bulkProductCommitSchema,
  type BulkProductImportResult,
  type BulkProductPreview,
  type BulkProductPreviewRow,
} from "@/modules/products/bulk-import.schemas";

type SheetCell = string | number | boolean | Date | null | undefined;
type ProductField =
  | "sku"
  | "barcode"
  | "name"
  | "category"
  | "unit"
  | "costPrice"
  | "sellingPrice"
  | "mrp"
  | "warehouseMinStock"
  | "storeMinStock"
  | "active";

const HEADER_ALIASES: Record<string, ProductField> = {
  sku: "sku",
  barcode: "barcode",
  productname: "name",
  name: "name",
  category: "category",
  unit: "unit",
  costprice: "costPrice",
  sellingprice: "sellingPrice",
  mrp: "mrp",
  warehouseminimum: "warehouseMinStock",
  warehousemin: "warehouseMinStock",
  warehouseminstock: "warehouseMinStock",
  storeminimum: "storeMinStock",
  storemin: "storeMinStock",
  storeminstock: "storeMinStock",
  active: "active",
};

const REQUIRED_FIELDS: ProductField[] = [
  "sku",
  "name",
  "category",
  "unit",
  "costPrice",
  "sellingPrice",
  "warehouseMinStock",
  "storeMinStock",
];

function normalizeHeader(value: SheetCell) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function cellText(value: SheetCell) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return String(value);
  }
  return value.trim();
}

function activeValue(value: SheetCell) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return { value: true, error: null as string | null };
  }
  if (typeof value === "boolean") return { value, error: null as string | null };

  const normalized = String(value).trim().toLowerCase();
  if (["true", "yes", "1", "active"].includes(normalized)) {
    return { value: true, error: null as string | null };
  }
  if (["false", "no", "0", "inactive"].includes(normalized)) {
    return { value: false, error: null as string | null };
  }
  return { value: true, error: "Active must be true/false, yes/no, 1/0 or blank." };
}

function isBlankRow(row: readonly SheetCell[]) {
  return row.every((cell) => cellText(cell) === "");
}

function assertFile(file: File) {
  if (!file || file.size === 0) {
    throw new BusinessError("BULK_FILE_REQUIRED", "Choose a CSV or XLSX file.");
  }
  if (file.size > MAX_BULK_PRODUCT_FILE_BYTES) {
    throw new BusinessError("BULK_FILE_TOO_LARGE", "Bulk import files are limited to 10 MB.");
  }

  const name = file.name.toLowerCase();
  if (!name.endsWith(".csv") && !name.endsWith(".xlsx")) {
    throw new BusinessError(
      "BULK_FILE_UNSUPPORTED",
      "Only .csv and .xlsx product files are supported.",
    );
  }
}

async function rowsFromFile(file: File): Promise<SheetCell[][]> {
  assertFile(file);
  const buffer = Buffer.from(await file.arrayBuffer());
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".csv")) {
    try {
      return parse(buffer.toString("utf8"), {
        bom: true,
        relax_column_count: true,
        skip_empty_lines: true,
      }) as string[][];
    } catch {
      throw new BusinessError("BULK_FILE_UNSUPPORTED", "The CSV file could not be parsed.");
    }
  }

  try {
    return (await readSheet(buffer)) as SheetCell[][];
  } catch {
    throw new BusinessError("BULK_FILE_UNSUPPORTED", "The XLSX file could not be parsed.");
  }
}

/** Compatibility parser retained for the pre-batch parser tests and callers. */
export async function parseProductFile(
  fileName: string,
  bytes: Uint8Array,
): Promise<Array<{ sku: string; barcode: string; active: string; [key: string]: string }>> {
  const file = new File([new Blob([Buffer.from(bytes)])], fileName);
  const sheet = await rowsFromFile(file);
  if (sheet.length === 0) {
    throw new BusinessError("BULK_FILE_INVALID", "The file is empty.");
  }
  const { map, globalErrors } = buildColumnMap(sheet[0]);
  if (globalErrors.length > 0) {
    throw new BusinessError("BULK_REQUIRED_COLUMN_MISSING", globalErrors.join(" "));
  }
  return sheet.slice(1).filter((row) => !isBlankRow(row)).map((row) => {
    const result = {
      sku: "",
      barcode: "",
      active: "",
    } as { sku: string; barcode: string; active: string; [key: string]: string };
    for (const field of REQUIRED_FIELDS.concat("barcode", "mrp", "active")) {
      result[field] = cellText(rowCell(row, map, field));
    }
    if (!result.active) result.active = "true";
    return result;
  });
}

function buildColumnMap(header: readonly SheetCell[]) {
  const map = new Map<ProductField, number>();
  const globalErrors: string[] = [];

  header.forEach((cell, index) => {
    const normalized = normalizeHeader(cell);
    if (!normalized) return;
    const field = HEADER_ALIASES[normalized];
    if (!field) return;
    if (map.has(field)) {
      globalErrors.push(`Ambiguous duplicate column for ${field}.`);
      return;
    }
    map.set(field, index);
  });

  for (const field of REQUIRED_FIELDS) {
    if (!map.has(field)) {
      globalErrors.push(`Missing required column: ${field}.`);
    }
  }

  return { map, globalErrors };
}

function rowCell(
  row: readonly SheetCell[],
  map: Map<ProductField, number>,
  field: ProductField,
) {
  const index = map.get(field);
  return index === undefined ? undefined : row[index];
}

function rowFromCells(
  source: readonly SheetCell[],
  rowNumber: number,
  map: Map<ProductField, number>,
): BulkProductPreviewRow {
  const active = activeValue(rowCell(source, map, "active"));
  const barcodeCell = rowCell(source, map, "barcode");
  const errors: string[] = [];

  if (
    typeof barcodeCell === "number" &&
    (!Number.isSafeInteger(barcodeCell) || barcodeCell < 0)
  ) {
    errors.push("Barcode numeric value is unsafe; format the barcode cell as text.");
  }

  if (active.error) errors.push(active.error);

  const candidate = {
    sku: cellText(rowCell(source, map, "sku")),
    barcode: cellText(barcodeCell),
    name: cellText(rowCell(source, map, "name")),
    category: cellText(rowCell(source, map, "category")),
    unit: cellText(rowCell(source, map, "unit")),
    costPrice: cellText(rowCell(source, map, "costPrice")),
    sellingPrice: cellText(rowCell(source, map, "sellingPrice")),
    mrp: cellText(rowCell(source, map, "mrp")),
    warehouseMinStock: cellText(rowCell(source, map, "warehouseMinStock")),
    storeMinStock: cellText(rowCell(source, map, "storeMinStock")),
    active: active.value,
  };

  const parsed = productInputSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "row");
      errors.push(`${field}: ${issue.message}`);
    }
  }

  return {
    rowNumber,
    ...candidate,
    errors: Array.from(new Set(errors)),
  };
}

function addWithinFileDuplicates(rows: BulkProductPreviewRow[]) {
  const skus = new Map<string, number[]>();
  const barcodes = new Map<string, number[]>();

  for (const row of rows) {
    const sku = row.sku.trim().toUpperCase();
    if (sku) skus.set(sku, [...(skus.get(sku) ?? []), row.rowNumber]);
    const barcode = row.barcode.trim();
    if (barcode) {
      barcodes.set(barcode, [...(barcodes.get(barcode) ?? []), row.rowNumber]);
    }
  }

  for (const row of rows) {
    const skuRows = skus.get(row.sku.trim().toUpperCase()) ?? [];
    if (skuRows.length > 1) {
      row.errors.push(`Duplicate SKU in file (rows ${skuRows.join(", ")}).`);
    }
    if (row.barcode.trim()) {
      const barcodeRows = barcodes.get(row.barcode.trim()) ?? [];
      if (barcodeRows.length > 1) {
        row.errors.push(`Duplicate barcode in file (rows ${barcodeRows.join(", ")}).`);
      }
    }
    row.errors = Array.from(new Set(row.errors));
  }
}

async function addDatabaseDuplicates(
  rows: BulkProductPreviewRow[],
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const skus = rows.map((row) => row.sku.trim().toUpperCase()).filter(Boolean);
  const barcodes = rows.map((row) => row.barcode.trim()).filter(Boolean);

  if (skus.length === 0 && barcodes.length === 0) return;

  const existing = await client.product.findMany({
    where: {
      OR: [
        ...(skus.length ? [{ sku: { in: skus } }] : []),
        ...(barcodes.length ? [{ barcode: { in: barcodes } }] : []),
      ],
    },
    select: { sku: true, barcode: true },
  });

  const existingSkus = new Set(existing.map((item) => item.sku));
  const existingBarcodes = new Set(
    existing.map((item) => item.barcode).filter((value): value is string => Boolean(value)),
  );

  for (const row of rows) {
    if (existingSkus.has(row.sku.trim().toUpperCase())) {
      row.errors.push("SKU already exists in Pasalho.");
    }
    if (row.barcode && existingBarcodes.has(row.barcode)) {
      row.errors.push("Barcode already exists in Pasalho.");
    }
    row.errors = Array.from(new Set(row.errors));
  }
}

async function buildPreview(file: File, includeDatabaseChecks: boolean) {
  const sheet = await rowsFromFile(file);
  if (sheet.length === 0) {
    throw new BusinessError("BULK_INVALID_ROW", "The file has no header row.");
  }

  const { map, globalErrors } = buildColumnMap(sheet[0]);
  const dataRows = sheet
    .slice(1)
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => !isBlankRow(row));

  if (dataRows.length > MAX_BULK_PRODUCT_ROWS) {
    throw new BusinessError(
      "BULK_ROW_LIMIT_EXCEEDED",
      `Bulk import is limited to ${MAX_BULK_PRODUCT_ROWS} products.`,
    );
  }

  const rows = dataRows.map(({ row, rowNumber }) =>
    rowFromCells(row, rowNumber, map),
  );
  addWithinFileDuplicates(rows);

  if (includeDatabaseChecks && globalErrors.length === 0) {
    await addDatabaseDuplicates(rows);
  }

  return {
    fileName: file.name,
    totalRows: rows.length,
    validRows: rows.filter((row) => row.errors.length === 0).length,
    invalidRows: rows.filter((row) => row.errors.length > 0).length,
    globalErrors,
    rows,
  } satisfies BulkProductPreview;
}

export async function previewBulkProductImport(
  actor: SessionUser,
  file: File,
): Promise<BulkProductPreview> {
  assertRole(actor.role, [Role.OWNER_ADMIN]);
  return buildPreview(file, true);
}

function assertPreviewValid(preview: BulkProductPreview) {
  if (preview.globalErrors.length > 0 || preview.invalidRows > 0) {
    throw new BusinessError(
      "BULK_INVALID_ROW",
      "Fix every bulk import validation error before importing.",
    );
  }
  if (preview.totalRows === 0) {
    throw new BusinessError("BULK_INVALID_ROW", "The file contains no product rows.");
  }
}

function sameBatch(
  batch: {
    fileName: string;
    fileSha256: string;
    rowCount: number;
  },
  input: {
    fileName: string;
    fileSha256: string;
    rowCount: number;
  },
) {
  return (
    batch.fileName === input.fileName &&
    batch.fileSha256 === input.fileSha256 &&
    batch.rowCount === input.rowCount
  );
}

export async function commitBulkProductImport(
  actor: SessionUser,
  input: { file: File; idempotencyKey: string },
): Promise<BulkProductImportResult> {
  assertRole(actor.role, [Role.OWNER_ADMIN]);
  const command = bulkProductCommitSchema.parse({
    idempotencyKey: input.idempotencyKey,
  });
  assertFile(input.file);

  const fileBuffer = Buffer.from(await input.file.arrayBuffer());
  const fileSha256 = createHash("sha256").update(fileBuffer).digest("hex");
  const preview = await buildPreview(input.file, false);
  assertPreviewValid(preview);

  const identity = {
    fileName: input.file.name,
    fileSha256,
    rowCount: preview.totalRows,
  };

  const existing = await prisma.productImportBatch.findUnique({
    where: { idempotencyKey: command.idempotencyKey },
  });

  if (existing) {
    if (!sameBatch(existing, identity)) {
      throw new BusinessError(
        "BULK_IMPORT_CONFLICT",
        "This import key was already used for a different file.",
      );
    }
    return {
      batchId: existing.id,
      fileName: existing.fileName,
      rowCount: existing.rowCount,
      createdCount: existing.createdCount,
      replayed: true,
    };
  }

  const rows = preview.rows;
  const data = rows.map((row) =>
    normalizeProductInput({
      sku: row.sku,
      barcode: row.barcode,
      name: row.name,
      category: row.category,
      unit: row.unit,
      costPrice: row.costPrice,
      sellingPrice: row.sellingPrice,
      mrp: row.mrp,
      warehouseMinStock: row.warehouseMinStock,
      storeMinStock: row.storeMinStock,
      active: row.active,
    }),
  );

  try {
    return await prisma.$transaction(
      async (tx) => {
        const replay = await tx.productImportBatch.findUnique({
          where: { idempotencyKey: command.idempotencyKey },
        });
        if (replay) {
          if (!sameBatch(replay, identity)) {
            throw new BusinessError(
              "BULK_IMPORT_CONFLICT",
              "This import key was already used for a different file.",
            );
          }
          return {
            batchId: replay.id,
            fileName: replay.fileName,
            rowCount: replay.rowCount,
            createdCount: replay.createdCount,
            replayed: true,
          };
        }

        const validationRows = rows.map((row) => ({
          ...row,
          errors: [...row.errors],
        }));
        await addDatabaseDuplicates(validationRows, tx);
        if (validationRows.some((row) => row.errors.length > 0)) {
          throw new BusinessError(
            "BULK_IMPORT_CONFLICT",
            "The product catalog changed after preview. Preview the file again.",
          );
        }

        const batch = await tx.productImportBatch.create({
          data: {
            idempotencyKey: command.idempotencyKey,
            fileName: identity.fileName,
            fileSha256: identity.fileSha256,
            rowCount: identity.rowCount,
            createdCount: identity.rowCount,
            createdByUserId: actor.id,
          },
        });

        await tx.product.createMany({ data });

        const created = await tx.product.findMany({
          where: { sku: { in: data.map((product) => product.sku) } },
          orderBy: { sku: "asc" },
        });

        if (created.length !== data.length) {
          throw new BusinessError(
            "BULK_IMPORT_FAILED",
            "Pasalho could not verify every imported product.",
          );
        }

        const locations = await tx.location.findMany({
          where: { active: true },
          select: { id: true },
        });

        await initializeProductZeroBalances(
          tx,
          created.map((product) => product.id),
          locations.map((location) => location.id),
        );

        await tx.auditLog.createMany({
          data: created.map((product) => ({
            actorUserId: actor.id,
            action: "PRODUCT_CREATED",
            entityType: "Product",
            entityId: product.id,
            afterData: productAuditSnapshot(product),
            metadata: {
              source: "BULK_IMPORT",
              importBatchId: batch.id,
            },
          })),
        });

        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            action: "PRODUCT_BULK_IMPORT_COMPLETED",
            entityType: "ProductImportBatch",
            entityId: batch.id,
            metadata: {
              fileName: batch.fileName,
              rowCount: batch.rowCount,
              createdCount: batch.createdCount,
            },
          },
        });

        return {
          batchId: batch.id,
          fileName: batch.fileName,
          rowCount: batch.rowCount,
          createdCount: batch.createdCount,
          replayed: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const replay = await prisma.productImportBatch.findUnique({
        where: { idempotencyKey: command.idempotencyKey },
      });
      if (replay && sameBatch(replay, identity)) {
        return {
          batchId: replay.id,
          fileName: replay.fileName,
          rowCount: replay.rowCount,
          createdCount: replay.createdCount,
          replayed: true,
        };
      }
      throw new BusinessError(
        "BULK_IMPORT_CONFLICT",
        "The catalog changed while importing. Preview the file again.",
      );
    }
    throw error;
  }
}
