import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";

let parseProductFile: (name: string, bytes: Uint8Array) => Promise<Array<{ sku: string; barcode: string; active: string }>>;

beforeAll(async () => {
  process.env.APP_ENV = "test";
  process.env.DATABASE_URL = "postgresql://pasalho:pasalho@localhost:5432/pasalho_lite?schema=public";
  process.env.AUTH_SECRET = "bulk-import-parser-test-secret-123456789";
  ({ parseProductFile } = await import("./bulk-import.service"));
});

const headers = "SKU,Barcode,Product Name,Category,Unit,Cost Price,Selling Price,Warehouse Minimum,Store Minimum";

describe("bulk product file parsing", () => {
  it("reads quoted CSV fields without splitting commas", async () => {
    const csv = `${headers}\nTEST-CSV,8901764012345,"Noodles, Spicy",Food,pcs,15,20,10,5\n`;
    const rows = await parseProductFile("products.csv", Buffer.from(csv));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sku: "TEST-CSV", barcode: "8901764012345" });
  });

  it("preserves text barcodes and reads numeric Excel cells", async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Products");
    sheet.addRow(headers.split(","));
    sheet.addRow(["TEST-XLSX", "08901764012345", "Noodles", "Food", "pcs", 15, 20, 10, 5]);
    const bytes = await book.xlsx.writeBuffer();
    const rows = await parseProductFile("products.xlsx", new Uint8Array(bytes));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sku: "TEST-XLSX", barcode: "08901764012345", costPrice: "15" });
  });

  it("rejects unsupported and oversized files", async () => {
    await expect(parseProductFile("products.txt", Buffer.from("bad"))).rejects.toMatchObject({ code: "BULK_FILE_UNSUPPORTED" });
    await expect(parseProductFile("products.csv", new Uint8Array(10 * 1024 * 1024 + 1))).rejects.toMatchObject({ code: "BULK_FILE_TOO_LARGE" });
  });
});
