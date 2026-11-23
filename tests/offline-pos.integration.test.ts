import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InventoryMovementType, PaymentSourceType, Role } from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getDailyClosePreview } from "@/modules/daily-close/daily-close.service";
import { getProvisionCandidates, ingestOfflineSale, provisionOfflineTerminal, renewOfflineSnapshot, revokeOfflineTerminal } from "@/modules/offline-pos/offline-pos.service";
import { createProduct } from "@/modules/products/product.service";
import { postPurchaseReceipt } from "@/modules/receiving/receipt.service";
import { createSupplier } from "@/modules/receiving/supplier.service";
import { createTransfer, dispatchTransfer, markTransferReady, receiveTransfer } from "@/modules/transfers/transfer.service";
import { installModernPricingMock } from "./helpers/modern-pricing-mock";

let owner: SessionUser;
let cashier: SessionUser;
let productId: string;
let storeId: string;
let restoreMock: (() => void) | undefined;
const suffix = randomUUID().slice(0, 8);

beforeAll(async () => {
  restoreMock = installModernPricingMock();
  const ownerRecord = await prisma.user.findUniqueOrThrow({ where: { email: process.env.SEED_OWNER_EMAIL!.toLowerCase() } });
  owner = { id: ownerRecord.id, name: ownerRecord.name, email: ownerRecord.email, role: ownerRecord.role };
  const cashierRecord = await prisma.user.create({ data: { email: `offline-${suffix}@example.test`, name: "Offline Test Cashier", role: Role.CASHIER_STORE, active: true, passwordHash: ownerRecord.passwordHash } });
  cashier = { id: cashierRecord.id, name: cashierRecord.name, email: cashierRecord.email, role: cashierRecord.role };
  storeId = (await prisma.location.findUniqueOrThrow({ where: { code: "STORE_MAIN" } })).id;
  const product = await createProduct(owner, { sku: `OFF-${suffix}`, barcode: "", name: "Offline Test Item", category: "Test", unit: "pcs", costPrice: "40.00", sellingPrice: "100.00", mrp: "120.00", warehouseMinStock: "0", storeMinStock: "0", active: true });
  productId = product.id;
  const supplier = await createSupplier(owner, { name: `Offline Supplier ${suffix}`, phone: "", notes: "" });
  await postPurchaseReceipt(owner, { supplierId: supplier.id, supplierReference: `OFF-${suffix}`, notes: "", idempotencyKey: `offline-receipt-${suffix}`, items: [{ productId, quantity: "10", unitCost: "40.00" }] });
  const transfer = await createTransfer(owner, { notes: "Offline test stock", items: [{ productId, requestedQuantity: "10" }] });
  await markTransferReady(owner, transfer.id);
  const dispatched = await dispatchTransfer(owner, transfer.id, { idempotencyKey: `offline-dispatch-${suffix}` });
  await receiveTransfer(owner, transfer.id, { idempotencyKey: `offline-receive-${suffix}`, items: [{ transferItemId: dispatched.items[0].id, receivedQuantity: "10", discrepancyReason: "" }] });
});
afterAll(() => restoreMock?.());

function device() {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = pair.publicKey.export({ format: "jwk" });
  return { privateKey: pair.privateKey, publicKey: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y } };
}

function envelope(snapshot: Awaited<ReturnType<typeof provisionOfflineTerminal>>, privateKey: ReturnType<typeof device>["privateKey"], overrides: Record<string, unknown> = {}) {
  const transactionId = randomUUID();
  const product = snapshot.products.find((item) => item.productId === productId)!;
  const payload = JSON.stringify({ version: 1, transactionId, snapshotId: snapshot.id, terminalId: snapshot.terminalId, storeId: snapshot.storeId, cashierId: snapshot.cashierId, createdAt: new Date().toISOString(), receiptNumber: `OFF-${transactionId.toUpperCase()}`, items: [{ productId, quantity: 1, priceCents: product.priceCents, lineTotalCents: product.priceCents }], subtotalCents: product.priceCents, discountCents: 0, taxPolicy: "REGULAR_PRICE_TAX_INCLUSIVE", payment: { method: "CASH", tenderedCents: product.priceCents }, ...overrides });
  const signature = sign("sha256", Buffer.from(payload), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
  return { payload, signature };
}

async function provision() {
  const keys = device();
  const candidate = (await getProvisionCandidates(owner)).products.find((item) => item.productId === productId)!;
  const snapshot = await provisionOfflineTerminal(owner, { terminalId: randomUUID(), cashierEmail: cashier.email, publicKey: keys.publicKey, productIds: [productId], approvedPrices: [{ productId, priceCents: candidate.priceCents }], taxInclusiveApproved: true });
  return { snapshot, keys };
}

describe("offline cash POS reconciliation", () => {
  it("denies warehouse provisioning and unsigned or price-tampered submissions", async () => {
    await expect(getProvisionCandidates({ ...owner, role: Role.WAREHOUSE_STAFF })).rejects.toMatchObject({ code: "UNAUTHORIZED_ACTION" });
    const otherKeys = device();
    await expect(provisionOfflineTerminal(owner, { terminalId: randomUUID(), cashierEmail: cashier.email, publicKey: otherKeys.publicKey, productIds: [productId], approvedPrices: [{ productId, priceCents: 1 }], taxInclusiveApproved: true })).rejects.toMatchObject({ code: "OFFLINE_PRICE_CHANGED" });
    const { snapshot, keys } = await provision();
    const signed = envelope(snapshot, keys.privateKey);
    await expect(ingestOfflineSale(cashier, { ...signed, signature: Buffer.alloc(64).toString("base64") })).rejects.toMatchObject({ code: "OFFLINE_SIGNATURE_INVALID" });
    const item = JSON.parse(signed.payload);
    item.items[0].priceCents -= 100;
    item.items[0].lineTotalCents -= 100;
    item.subtotalCents -= 100;
    item.payment.tenderedCents -= 100;
    const payload = JSON.stringify(item);
    const signature = sign("sha256", Buffer.from(payload), { key: keys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
    await expect(ingestOfflineSale(cashier, { payload, signature })).rejects.toMatchObject({ code: "OFFLINE_PRICE_MISMATCH" });
  });

  it("uses Modern regular price, records one sale/payment/movement, and replays idempotently", async () => {
    const candidates = await getProvisionCandidates(owner);
    expect(candidates.products.find((item) => item.productId === productId)?.priceCents).toBe(10000);
    const { snapshot, keys } = await provision();
    const request = envelope(snapshot, keys.privateKey);
    const transactionId = JSON.parse(request.payload).transactionId as string;
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const part = (type: string) => parts.find((entry) => entry.type === type)!.value;
    const operatingDate = `${part("year")}-${part("month")}-${part("day")}`;
    const cashBefore = (await getDailyClosePreview(operatingDate)).snapshot.cashPosSales;
    const first = await ingestOfflineSale(cashier, request);
    const replay = await ingestOfflineSale(cashier, request);
    expect(first.status).toBe("SYNCED");
    expect(replay).toEqual(first);
    expect(first.saleId).toBe(transactionId);
    const [sale, payments, movements, loyalty] = await Promise.all([
      prisma.sale.findUniqueOrThrow({ where: { id: transactionId }, include: { items: true } }),
      prisma.payment.findMany({ where: { sourceType: PaymentSourceType.SALE, sourceId: transactionId } }),
      prisma.inventoryMovement.findMany({ where: { referenceType: "SALE", referenceId: transactionId } }),
      prisma.loyaltyTransaction.findMany({ where: { sourceId: transactionId } }),
    ]);
    expect(sale.total.toFixed(2)).toBe("100.00");
    expect(sale.items).toHaveLength(1);
    expect(payments).toHaveLength(1);
    expect(movements).toHaveLength(1);
    expect(movements[0].type).toBe(InventoryMovementType.POS_SALE);
    expect(movements[0].quantityDelta.toString()).toBe("-1");
    expect(loyalty).toHaveLength(0);
    await expect(prisma.offlineSubmission.update({ where: { transactionId }, data: { status: "CONFLICT" } })).rejects.toThrow();
    const cashAfter = (await getDailyClosePreview(operatingDate)).snapshot.cashPosSales;
    expect(cashAfter.sub(cashBefore).toFixed(2)).toBe("100.00");
    const changedPayload = JSON.parse(request.payload);
    changedPayload.payment.tenderedCents += 100;
    const altered = JSON.stringify(changedPayload);
    await expect(ingestOfflineSale(cashier, { payload: altered, signature: sign("sha256", Buffer.from(altered), { key: keys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64") })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("keeps an approved historical regular price after the catalog changes", async () => {
    const { snapshot, keys } = await provision();
    await prisma.product.update({ where: { id: productId }, data: { sellingPrice: "120.00" } });
    const result = await ingestOfflineSale(cashier, envelope(snapshot, keys.privateKey));
    expect(result.status).toBe("SYNCED");
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: result.saleId! } })).total.toFixed(2)).toBe("100.00");
  });

  it("requires review after expiry or device revocation", async () => {
    const { snapshot, keys } = await provision();
    const expired = envelope(snapshot, keys.privateKey, { createdAt: new Date(Date.parse(snapshot.expiresAt) + 1000).toISOString() });
    expect((await ingestOfflineSale(cashier, expired)).status).toBe("REQUIRES_REVIEW");
    await revokeOfflineTerminal(owner, snapshot.terminalId);
    const revoked = envelope(snapshot, keys.privateKey);
    expect((await ingestOfflineSale(cashier, revoked)).reason).toBe("TERMINAL_REVOKED");
  });

  it("requires review when the assigned cashier loses permission", async () => {
    const { snapshot, keys } = await provision();
    await prisma.user.update({ where: { id: cashier.id }, data: { role: Role.WAREHOUSE_STAFF } });
    try {
      const result = await ingestOfflineSale(owner, envelope(snapshot, keys.privateKey));
      expect(result.status).toBe("REQUIRES_REVIEW");
      expect(result.reason).toBe("CASHIER_PERMISSION_CHANGED");
    } finally {
      await prisma.user.update({ where: { id: cashier.id }, data: { role: Role.CASHIER_STORE } });
    }
  });

  it("shows a conflict when another terminal consumes the last stock", async () => {
    const first = await provision();
    const second = await provision();
    const balance = await prisma.stockBalance.findUniqueOrThrow({ where: { productId_locationId: { productId, locationId: storeId } } });
    const available = balance.onHand.sub(balance.reserved).toNumber();
    // One terminal sells the remaining units; the second has the same older snapshot.
    const firstProduct = first.snapshot.products.find((item) => item.productId === productId)!;
    const id = randomUUID();
    const payload = JSON.stringify({ version: 1, transactionId: id, snapshotId: first.snapshot.id, terminalId: first.snapshot.terminalId, storeId, cashierId: cashier.id, createdAt: new Date().toISOString(), receiptNumber: `OFF-${id.toUpperCase()}`, items: [{ productId, quantity: available, priceCents: firstProduct.priceCents, lineTotalCents: available * firstProduct.priceCents }], subtotalCents: available * firstProduct.priceCents, discountCents: 0, taxPolicy: "REGULAR_PRICE_TAX_INCLUSIVE", payment: { method: "CASH", tenderedCents: available * firstProduct.priceCents } });
    const signature = sign("sha256", Buffer.from(payload), { key: first.keys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
    expect((await ingestOfflineSale(cashier, { payload, signature })).status).toBe("SYNCED");
    const later = await ingestOfflineSale(cashier, envelope(second.snapshot, second.keys.privateKey));
    expect(later.status).toBe("CONFLICT");
    expect(later.reason).toBe("INSUFFICIENT_STOCK");
    expect(await prisma.sale.findUnique({ where: { id: later.transactionId } })).toBeNull();
    expect(await prisma.offlineSubmission.findUnique({ where: { transactionId: later.transactionId } })).not.toBeNull();
  });

  it("requires owner reapproval when renewal prices change", async () => {
    const { snapshot } = await provision();
    const oldPrice = snapshot.products.find((item) => item.productId === productId)!.priceCents;
    await prisma.product.update({ where: { id: productId }, data: { sellingPrice: "130.00" } });
    const input = { terminalId: snapshot.terminalId, productIds: [productId], approvedPrices: [{ productId, priceCents: oldPrice }], taxInclusiveApproved: true as const };
    await expect(renewOfflineSnapshot(owner, input)).rejects.toMatchObject({ code: "OFFLINE_PRICE_CHANGED" });
    const renewed = await renewOfflineSnapshot(owner, { ...input, approvedPrices: [{ productId, priceCents: 13000 }] });
    expect(renewed.products[0].priceCents).toBe(13000);
    expect(renewed.id).not.toBe(snapshot.id);
  });
});
