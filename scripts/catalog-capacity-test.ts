import "../tests/setup-env";
import { File } from "node:buffer";
import { performance } from "node:perf_hooks";
import { PaymentMethod, Role } from "../src/generated/prisma/client";
import type { SessionUser } from "../src/lib/auth/session";
import { prisma } from "../src/lib/db";
import { createPosProductSearchIndex } from "../src/modules/pos/product-search";
import { finalizeSale, getPosCatalog } from "../src/modules/pos/pos.service";
import { quotePosPricing } from "../src/modules/pricing/pricing.service";
import { commitBulkProductImport } from "../src/modules/products/bulk-import.service";
import { createSupplier } from "../src/modules/receiving/supplier.service";
import { postPurchaseReceipt } from "../src/modules/receiving/receipt.service";
import { createTransfer, dispatchTransfer, markTransferReady, receiveTransfer } from "../src/modules/transfers/transfer.service";

const prefix = `CAP${Date.now().toString(36).toUpperCase()}`;
const importedCount = 3_000;
const totalStressCount = 10_000;
const generatedCount = totalStressCount - importedCount;
const header = "SKU,Barcode,Product Name,Category,Unit,Cost Price,Selling Price,MRP,Warehouse Minimum,Store Minimum,Active";
const actorRecord = await prisma.user.findUniqueOrThrow({
  where: { email: process.env.SEED_OWNER_EMAIL!.toLowerCase() },
});
const owner: SessionUser = { ...actorRecord, role: Role.OWNER_ADMIN };
const cashier: SessionUser = { ...owner, role: Role.CASHIER_STORE };
const warehouse: SessionUser = { ...owner, role: Role.WAREHOUSE_STAFF };
const originalFetch = globalThis.fetch;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function percentile(values: number[], percent: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.ceil((percent / 100) * sorted.length) - 1].toFixed(3));
}

try {
  const importedRows = Array.from({ length: importedCount }, (_, index) => {
    const sequence = String(index + 1).padStart(5, "0");
    const price = 25 + (index % 975);
    return `${prefix}-IMP-${sequence},${prefix}${sequence},Grocery Shelf Product ${sequence},Grocery,each,${(price * 0.7).toFixed(2)},${price.toFixed(2)},${(price * 1.1).toFixed(2)},0,0,true`;
  });
  const csv = new File([[header, ...importedRows].join("\n")], `${prefix.toLowerCase()}-catalog.csv`, { type: "text/csv" }) as unknown as globalThis.File;
  const importStarted = performance.now();
  const imported = await commitBulkProductImport(owner, {
    file: csv,
    idempotencyKey: `${prefix}-IMPORT-3000`,
  });
  const importMs = performance.now() - importStarted;
  assert(imported.createdCount === importedCount, `Expected ${importedCount} imported products, received ${imported.createdCount}.`);

  for (let start = 0; start < generatedCount; start += 1_000) {
    const batch = Array.from({ length: Math.min(1_000, generatedCount - start) }, (_, offset) => {
      const index = importedCount + start + offset + 1;
      const sequence = String(index).padStart(5, "0");
      const price = 25 + (index % 975);
      return {
        sku: `${prefix}-GEN-${sequence}`,
        barcode: `${prefix}${sequence}`,
        name: `Grocery Shelf Product ${sequence}`,
        category: "Grocery",
        unit: "each",
        costPrice: (price * 0.7).toFixed(2),
        sellingPrice: price.toFixed(2),
        mrp: (price * 1.1).toFixed(2),
        warehouseMinStock: "0",
        storeMinStock: "0",
        active: true,
      };
    });
    await prisma.product.createMany({ data: batch });
  }

  const catalogStarted = performance.now();
  const catalog = await getPosCatalog();
  const catalogLoadMs = performance.now() - catalogStarted;
  const stressProducts = catalog.filter((product) => product.sku.startsWith(`${prefix}-`));
  assert(stressProducts.length === totalStressCount, `Expected ${totalStressCount} products in the POS catalog, got ${stressProducts.length}.`);

  const indexStarted = performance.now();
  const searchIndex = createPosProductSearchIndex(stressProducts);
  const indexBuildMs = performance.now() - indexStarted;
  const barcodeQuery = `${prefix}03000`;
  const skuQuery = `${prefix}-IMP-03000`;
  const exactSamples: number[] = [];
  const textSamples: number[] = [];
  for (let i = 0; i < 100; i += 1) {
    let started = performance.now();
    const byBarcode = searchIndex.findExact(barcodeQuery);
    exactSamples.push(performance.now() - started);
    assert(byBarcode?.sku === skuQuery, "Exact barcode lookup returned the wrong SKU.");

    started = performance.now();
    const byText = searchIndex.search("grocery shelf product 03");
    textSamples.push(performance.now() - started);
    assert(byText.length > 0, "Product-name search returned no matches.");
  }

  const checkoutProduct = await prisma.product.findUniqueOrThrow({ where: { sku: `${prefix}-IMP-00001` } });
  const supplier = await createSupplier(owner, { name: `${prefix} test supplier`, phone: "", notes: "Disposable catalog stress fixture" });
  await postPurchaseReceipt(warehouse, {
    supplierId: supplier.id,
    supplierReference: `${prefix}-RECEIPT`,
    notes: "Disposable catalog stress checkout fixture",
    idempotencyKey: `${prefix}-RECEIPT-IDEMPOTENCY`,
    items: [{ productId: checkoutProduct.id, quantity: "3", unitCost: checkoutProduct.costPrice.toFixed(2) }],
  });
  const transfer = await createTransfer(warehouse, { notes: `${prefix} checkout fixture`, items: [{ productId: checkoutProduct.id, requestedQuantity: "3" }] });
  await markTransferReady(warehouse, transfer.id);
  const dispatched = await dispatchTransfer(warehouse, transfer.id, { idempotencyKey: `${prefix}-TRANSFER-DISPATCH` });
  await receiveTransfer(cashier, transfer.id, {
    idempotencyKey: `${prefix}-TRANSFER-RECEIVE`,
    items: [{ transferItemId: dispatched.items[0].id, receivedQuantity: "3", discrepancyReason: "" }],
  });

  globalThis.fetch = async () => { throw new Error("Modern Trade intentionally unavailable during capacity checkout."); };
  const quote = await quotePosPricing(cashier, { customerId: null, items: [{ productId: checkoutProduct.id, quantity: "1" }] });
  const sale = await finalizeSale(cashier, {
    idempotencyKey: `${prefix}-CASH-SALE`,
    paymentMethod: PaymentMethod.CASH,
    customerId: null,
    signedQuoteToken: quote.signedQuoteToken,
    items: [{ productId: checkoutProduct.id, quantity: "1" }],
  });
  assert(sale.sale.items[0]?.skuSnapshot === checkoutProduct.sku, "Stress catalog checkout returned the wrong SKU.");

  console.log(JSON.stringify({
    fixture: "synthetic-test-data-only",
    bulkImportProducts: imported.createdCount,
    stressCatalogProducts: stressProducts.length,
    bulkImportMs: Number(importMs.toFixed(3)),
    posCatalogLoadMs: Number(catalogLoadMs.toFixed(3)),
    searchIndexBuildMs: Number(indexBuildMs.toFixed(3)),
    exactBarcodeLookupMs: { p50: percentile(exactSamples, 50), p95: percentile(exactSamples, 95) },
    productNameSearchMs: { p50: percentile(textSamples, 50), p95: percentile(textSamples, 95) },
    checkout: { saleId: sale.sale.id, receiptNumber: sale.sale.receiptNumber, payment: sale.payment.status },
  }));
} finally {
  globalThis.fetch = originalFetch;
  await prisma.$disconnect();
}
