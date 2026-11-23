import "server-only";
import { createHash, createPublicKey, verify } from "node:crypto";
import { CashMovementEffect, CashMovementType, InventoryMovementType, LocationType, PaymentMethod, PaymentSourceType, PaymentStatus, Prisma, Role, SaleStatus, DailyCloseStatus } from "@/generated/prisma/client";
import { assertRole } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import { recordPhysicalInventoryMovement } from "@/modules/inventory/inventory.service";
import { getOfflineRegularPriceCatalog } from "@/modules/pricing/pricing.service";
import { getNepalOperatingDateKey, parseOperatingDate } from "@/lib/time";
import { offlineSaleSchema, offlineSnapshotSchema, type OfflineSale, type OfflineSnapshot } from "./offline-pos.schemas";
import { z } from "zod";

const publicKeySchema = z.object({
  kty: z.literal("EC"), crv: z.literal("P-256"),
  x: z.string().regex(/^[A-Za-z0-9_-]{40,120}$/),
  y: z.string().regex(/^[A-Za-z0-9_-]{40,120}$/),
}).strict();

const provisionSchema = z.object({
  terminalId: z.string().uuid(),
  cashierEmail: z.email(),
  publicKey: publicKeySchema,
  productIds: z.array(z.string().uuid()).min(1).max(1000),
  approvedPrices: z.array(z.object({ productId: z.string().uuid(), priceCents: z.number().int().positive() }).strict()).min(1).max(1000),
  taxInclusiveApproved: z.literal(true),
}).strict();

function cents(amount: Prisma.Decimal) {
  return amount.mul(100).toNumber();
}

async function postOfflineSale(
  tx: Prisma.TransactionClient,
  sale: OfflineSale,
  snapshot: OfflineSnapshot,
  cashierId: string,
  actorId: string,
  currentById: Map<string, { costPrice: Prisma.Decimal }>,
  resolved: boolean,
) {
  const productById = new Map(snapshot.products.map((product) => [product.productId, product]));
  const total = new Prisma.Decimal(sale.subtotalCents).div(100);
  const newSale = await tx.sale.create({ data: {
    id: sale.transactionId, receiptNumber: sale.receiptNumber, storeLocationId: snapshot.storeId,
    customerId: null, pricingQuoteSnapshot: { offlineSnapshotId: snapshot.id, terminalId: snapshot.terminalId, priceAuthority: "MODERN_CATALOG_REGULAR", taxPolicy: snapshot.taxPolicy, localCreatedAt: sale.createdAt, ...(resolved ? { ownerResolved: true } : {}) },
    status: SaleStatus.FINALIZED, subtotal: total, discountTotal: new Prisma.Decimal(0), total,
    paymentStatus: PaymentStatus.PAID, finalizedAt: new Date(sale.createdAt), finalizedByUserId: cashierId,
    idempotencyKey: `offline:${sale.transactionId}`,
    items: { create: sale.items.map((item) => {
      const product = productById.get(item.productId)!;
      const current = currentById.get(item.productId)!;
      const price = new Prisma.Decimal(item.priceCents).div(100);
      return { productId: item.productId, skuSnapshot: product.sku, productNameSnapshot: product.name, quantity: new Prisma.Decimal(item.quantity), unitPrice: price, regularUnitPrice: price, appliedUnitPrice: price, discountAmount: new Prisma.Decimal(0), lineTotal: new Prisma.Decimal(item.lineTotalCents).div(100), unitCostSnapshot: current.costPrice, currency: "NPR" };
    }) },
  } });
  await tx.payment.create({ data: { sourceType: PaymentSourceType.SALE, sourceId: newSale.id, method: PaymentMethod.CASH, status: PaymentStatus.PAID, amount: total, collectedAt: new Date(sale.createdAt), refundedAmount: new Prisma.Decimal(0), idempotencyKey: `offline-payment:${sale.transactionId}`, recordedByUserId: cashierId } });
  for (const item of sale.items) await recordPhysicalInventoryMovement(tx, { productId: item.productId, locationId: snapshot.storeId, type: InventoryMovementType.POS_SALE, quantityDelta: new Prisma.Decimal(-item.quantity), referenceType: "SALE", referenceId: newSale.id, idempotencyKey: `offline-movement:${sale.transactionId}:${item.productId}`, reason: `Offline cash sale ${sale.receiptNumber}`, actorUserId: cashierId });
  await tx.auditLog.create({ data: { actorUserId: actorId, action: resolved ? "OFFLINE_SALE_OWNER_POSTED" : "OFFLINE_SALE_SYNCED", entityType: "Sale", entityId: newSale.id, afterData: { receiptNumber: sale.receiptNumber, total: total.toFixed(2), terminalId: snapshot.terminalId, snapshotId: snapshot.id, localCreatedAt: sale.createdAt } } });
  return newSale;
}

export async function getProvisionCandidates(actor: SessionUser) {
  assertRole(actor.role, [Role.OWNER_ADMIN]);
  const store = await prisma.location.findFirst({ where: { code: "STORE_MAIN", type: LocationType.STORE, active: true } });
  if (!store) throw new BusinessError("STORE_NOT_FOUND", "Store unavailable.");
  const catalog = await getOfflineRegularPriceCatalog(actor);
  const [products, cashiers] = await Promise.all([
    prisma.product.findMany({ where: { active: true }, include: { stockBalances: { where: { locationId: store.id } } }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { active: true, role: { in: [Role.OWNER_ADMIN, Role.CASHIER_STORE] } }, select: { email: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const skuCounts = new Map<string, number>();
  for (const item of catalog.products) skuCounts.set(item.sku, (skuCounts.get(item.sku) ?? 0) + 1);
  const bySku = new Map(catalog.products.map((item) => [item.sku, item]));
  return { cashiers, products: products.flatMap((product) => {
    const remote = bySku.get(product.sku);
    if (skuCounts.get(product.sku) !== 1 || !remote?.active || !remote.regularUnitPrice || remote.currency !== "NPR" || !/^\d+\.\d{2}$/.test(remote.regularUnitPrice)) return [];
    const price = new Prisma.Decimal(remote.regularUnitPrice);
    if (price.lessThanOrEqualTo(0) || price.greaterThan(50_000)) return [];
    const balance = product.stockBalances[0];
    const available = (balance?.onHand ?? new Prisma.Decimal(0)).sub(balance?.reserved ?? new Prisma.Decimal(0));
    return [{ productId: product.id, sku: product.sku, barcode: product.barcode, name: product.name, unit: product.unit, priceCents: cents(price), availableUnits: Math.max(0, available.floor().toNumber()) }];
  }) };
}

export async function provisionOfflineTerminal(actor: SessionUser, input: unknown) {
  assertRole(actor.role, [Role.OWNER_ADMIN]);
  const parsed = provisionSchema.parse(input);
  if (new Set(parsed.productIds).size !== parsed.productIds.length) throw new BusinessError("INVALID_OFFLINE_PRODUCTS", "Duplicate product selection.");
  if (new Set(parsed.approvedPrices.map((item) => item.productId)).size !== parsed.approvedPrices.length) throw new BusinessError("INVALID_OFFLINE_PRODUCTS", "Duplicate approved price.");
  try { createPublicKey({ key: parsed.publicKey, format: "jwk" }); } catch { throw new BusinessError("INVALID_DEVICE_KEY", "Device public key is invalid."); }
  const store = await prisma.location.findFirst({ where: { code: "STORE_MAIN", type: LocationType.STORE, active: true } });
  const cashier = await prisma.user.findUnique({ where: { email: parsed.cashierEmail } });
  if (!store || !cashier?.active || (cashier.role !== Role.OWNER_ADMIN && cashier.role !== Role.CASHIER_STORE)) throw new BusinessError("INVALID_OFFLINE_CASHIER", "Cashier or store unavailable.");
  const candidates = await getProvisionCandidates(actor);
  const productById = new Map(candidates.products.map((product) => [product.productId, product]));
  const selected = parsed.productIds.map((id) => productById.get(id));
  if (selected.some((product) => !product)) throw new BusinessError("INVALID_OFFLINE_PRODUCTS", "Selected product is not in the authoritative regular price catalog.");
  const approvedById = new Map(parsed.approvedPrices.map((item) => [item.productId, item.priceCents]));
  if (approvedById.size !== selected.length || selected.some((product) => approvedById.get(product!.productId) !== product!.priceCents)) throw new BusinessError("OFFLINE_PRICE_CHANGED", "Regular prices changed after owner review. Reload and approve the current prices.");
  const now = new Date();
  const snapshotId = crypto.randomUUID();
  const snapshot: OfflineSnapshot = {
    version: 1, id: snapshotId, terminalId: parsed.terminalId, storeId: store.id, storeName: store.name,
    cashierId: cashier.id, cashierName: cashier.name, issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString(),
    maxTotalCents: 5_000_000, taxPolicy: "REGULAR_PRICE_TAX_INCLUSIVE", products: selected as OfflineSnapshot["products"],
  };
  await prisma.$transaction(async (tx) => {
    const existing = await tx.offlineTerminal.findUnique({ where: { id: parsed.terminalId } });
    if (existing) throw new BusinessError("TERMINAL_ALREADY_EXISTS", "This device is already provisioned; revoke it before replacing it.");
    await tx.offlineTerminal.create({ data: { id: parsed.terminalId, storeLocationId: store.id, cashierUserId: cashier.id, approvedByUserId: actor.id, publicKey: parsed.publicKey, snapshots: { create: { id: snapshotId, payload: snapshot, expiresAt: new Date(snapshot.expiresAt) } } } });
    await tx.auditLog.create({ data: { actorUserId: actor.id, action: "OFFLINE_TERMINAL_PROVISIONED", entityType: "OfflineTerminal", entityId: parsed.terminalId, afterData: { cashierId: cashier.id, snapshotId, productCount: snapshot.products.length, expiresAt: snapshot.expiresAt } } });
  });
  return snapshot;
}

export async function revokeOfflineTerminal(actor: SessionUser, terminalId: string) {
  assertRole(actor.role, [Role.OWNER_ADMIN]);
  const id = z.string().uuid().parse(terminalId);
  await prisma.$transaction(async (tx) => {
    const terminal = await tx.offlineTerminal.findUnique({ where: { id } });
    if (!terminal) throw new BusinessError("TERMINAL_NOT_FOUND", "Terminal not found.");
    if (terminal.revokedAt) return;
    await tx.offlineTerminal.update({ where: { id }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({ data: { actorUserId: actor.id, action: "OFFLINE_TERMINAL_REVOKED", entityType: "OfflineTerminal", entityId: id } });
  });
}

export async function listOfflineTerminals(actor: SessionUser) {
  assertRole(actor.role, [Role.OWNER_ADMIN]);
  const rows = await prisma.offlineTerminal.findMany({
    include: { cashier: { select: { name: true, email: true } }, snapshots: { select: { id: true, expiresAt: true }, orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { createdAt: "desc" }, take: 100,
  });
  return rows.map((row) => ({ id: row.id, cashier: row.cashier.name, email: row.cashier.email, revokedAt: row.revokedAt?.toISOString() ?? null, snapshotId: row.snapshots[0]?.id ?? null, expiresAt: row.snapshots[0]?.expiresAt.toISOString() ?? null }));
}

export async function renewOfflineSnapshot(actor: SessionUser, input: unknown) {
  assertRole(actor.role, [Role.OWNER_ADMIN]);
  const parsed = z.object({ terminalId: z.string().uuid(), productIds: z.array(z.string().uuid()).min(1).max(1000), approvedPrices: z.array(z.object({ productId: z.string().uuid(), priceCents: z.number().int().positive() }).strict()).min(1).max(1000), taxInclusiveApproved: z.literal(true) }).strict().parse(input);
  const terminal = await prisma.offlineTerminal.findUnique({ where: { id: parsed.terminalId }, include: { cashier: true, storeLocation: true } });
  if (!terminal || terminal.revokedAt || !terminal.cashier.active || !terminal.storeLocation.active || (terminal.cashier.role !== Role.CASHIER_STORE && terminal.cashier.role !== Role.OWNER_ADMIN)) throw new BusinessError("TERMINAL_NOT_AVAILABLE", "Terminal or cashier is not authorized.");
  const candidates = await getProvisionCandidates(actor);
  const byId = new Map(candidates.products.map((product) => [product.productId, product]));
  if (new Set(parsed.productIds).size !== parsed.productIds.length) throw new BusinessError("INVALID_OFFLINE_PRODUCTS", "Duplicate product selection.");
  const products = parsed.productIds.map((id) => byId.get(id));
  if (products.some((item) => !item)) throw new BusinessError("INVALID_OFFLINE_PRODUCTS", "Product no longer has an approved regular price.");
  const approvedById = new Map(parsed.approvedPrices.map((item) => [item.productId, item.priceCents]));
  if (approvedById.size !== products.length || products.some((product) => approvedById.get(product!.productId) !== product!.priceCents)) throw new BusinessError("OFFLINE_PRICE_CHANGED", "Regular prices changed after owner review. Reload and approve the current prices.");
  const now = new Date();
  const snapshot: OfflineSnapshot = { version: 1, id: crypto.randomUUID(), terminalId: terminal.id, storeId: terminal.storeLocationId, storeName: terminal.storeLocation.name, cashierId: terminal.cashierUserId, cashierName: terminal.cashier.name, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 8 * 60 * 60_000).toISOString(), maxTotalCents: 5_000_000, taxPolicy: "REGULAR_PRICE_TAX_INCLUSIVE", products: products as OfflineSnapshot["products"] };
  await prisma.$transaction(async (tx) => {
    await tx.offlineSnapshot.create({ data: { id: snapshot.id, terminalId: terminal.id, payload: snapshot, expiresAt: new Date(snapshot.expiresAt) } });
    await tx.auditLog.create({ data: { actorUserId: actor.id, action: "OFFLINE_SNAPSHOT_RENEWED", entityType: "OfflineSnapshot", entityId: snapshot.id, afterData: { terminalId: terminal.id, productCount: snapshot.products.length, expiresAt: snapshot.expiresAt } } });
  });
  return snapshot;
}

export async function ingestOfflineSale(actor: SessionUser, input: unknown) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const envelope = z.object({ payload: z.string().min(20).max(100_000), signature: z.string().min(40).max(1000) }).strict().parse(input);
  const sale = offlineSaleSchema.parse(JSON.parse(envelope.payload));
  const hash = createHash("sha256").update(envelope.payload).digest("hex");
  const terminal = await prisma.offlineTerminal.findUnique({ where: { id: sale.terminalId }, include: { cashier: true } });
  const record = await prisma.offlineSnapshot.findUnique({ where: { id: sale.snapshotId } });
  if (!terminal || !record || record.terminalId !== terminal.id) throw new BusinessError("OFFLINE_AUTHORIZATION_INVALID", "Terminal snapshot is unknown.");
  const snapshot = offlineSnapshotSchema.parse(record.payload);
  if (snapshot.terminalId !== terminal.id || snapshot.storeId !== terminal.storeLocationId || snapshot.cashierId !== terminal.cashierUserId || sale.storeId !== snapshot.storeId || sale.cashierId !== snapshot.cashierId || sale.terminalId !== snapshot.terminalId) throw new BusinessError("OFFLINE_AUTHORIZATION_INVALID", "Terminal, store or cashier mismatch.");
  let verified = false;
  try { verified = verify("sha256", Buffer.from(envelope.payload), { key: createPublicKey({ key: publicKeySchema.parse(terminal.publicKey), format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(envelope.signature, "base64")); } catch { /* invalid signature */ }
  if (!verified) throw new BusinessError("OFFLINE_SIGNATURE_INVALID", "Device signature is invalid.");
  const existing = await prisma.offlineSubmission.findUnique({ where: { transactionId: sale.transactionId }, include: { resolution: true } });
  if (existing) {
    if (existing.payloadHash !== hash) throw new BusinessError("IDEMPOTENCY_CONFLICT", "Offline transaction ID has different contents.");
    return { status: existing.resolution?.action === "CASH_REFUNDED" ? "REFUNDED" : existing.resolution?.action === "POST_SALE" ? "SYNCED" : existing.status, reason: existing.resolution ? null : existing.reason, transactionId: sale.transactionId, saleId: existing.resolution?.saleId ?? existing.saleId };
  }
  const createdAt = new Date(sale.createdAt);
  const issuedAt = new Date(snapshot.issuedAt);
  const expiresAt = new Date(snapshot.expiresAt);
  const productById = new Map(snapshot.products.map((product) => [product.productId, product]));
  if (new Set(sale.items.map((item) => item.productId)).size !== sale.items.length || sale.items.some((item) => {
    const product = productById.get(item.productId);
    return !product || product.priceCents !== item.priceCents || product.priceCents * item.quantity !== item.lineTotalCents;
  }) || sale.subtotalCents > snapshot.maxTotalCents) throw new BusinessError("OFFLINE_PRICE_MISMATCH", "Offline sale does not match the approved price snapshot.");
  const operatingDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit" }).format(createdAt);
  const reviewReason = terminal.revokedAt ? "TERMINAL_REVOKED" :
    !terminal.cashier.active || (terminal.cashier.role !== Role.OWNER_ADMIN && terminal.cashier.role !== Role.CASHIER_STORE) ? "CASHIER_PERMISSION_CHANGED" :
    actor.id !== terminal.cashierUserId && actor.role !== Role.OWNER_ADMIN ? "SYNC_ACTOR_MISMATCH" :
    createdAt < new Date(issuedAt.getTime() - 5 * 60_000) || createdAt > expiresAt ? "OFFLINE_AUTHORIZATION_EXPIRED_OR_CLOCK_DRIFT" :
    Date.now() > expiresAt.getTime() + 72 * 60 * 60_000 ? "SYNC_TOO_LATE" : null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const replay = await tx.offlineSubmission.findUnique({ where: { transactionId: sale.transactionId }, include: { resolution: true } });
        if (replay) {
          if (replay.payloadHash !== hash) throw new BusinessError("IDEMPOTENCY_CONFLICT", "Offline transaction ID has different contents.");
          return { status: replay.resolution?.action === "CASH_REFUNDED" ? "REFUNDED" : replay.resolution?.action === "POST_SALE" ? "SYNCED" : replay.status, reason: replay.resolution ? null : replay.reason, transactionId: sale.transactionId, saleId: replay.resolution?.saleId ?? replay.saleId };
        }
        await tx.$queryRaw`SELECT "id" FROM "OfflineTerminal" WHERE "id" = ${terminal.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${terminal.cashierUserId} FOR SHARE`;
        const currentTerminal = await tx.offlineTerminal.findUniqueOrThrow({ where: { id: terminal.id }, include: { cashier: true } });
        const closed = await tx.dailyClose.findFirst({ where: { storeLocationId: snapshot.storeId, operatingDate: new Date(`${operatingDate}T00:00:00.000Z`), status: DailyCloseStatus.CLOSED } });
        let reason = reviewReason ?? (closed ? "OPERATING_DAY_CLOSED" : null);
        if (currentTerminal.revokedAt) reason = "TERMINAL_REVOKED";
        else if (!currentTerminal.cashier.active || (currentTerminal.cashier.role !== Role.OWNER_ADMIN && currentTerminal.cashier.role !== Role.CASHIER_STORE)) reason = "CASHIER_PERMISSION_CHANGED";
        const products = await tx.product.findMany({ where: { id: { in: sale.items.map((item) => item.productId) } }, include: { stockBalances: { where: { locationId: snapshot.storeId } } } });
        const currentById = new Map(products.map((product) => [product.id, product]));
        if (!reason && sale.items.some((item) => !currentById.get(item.productId)?.active)) reason = "PRODUCT_DEACTIVATED";
        let status = reason ? "REQUIRES_REVIEW" : "SYNCED";
        if (!reason && sale.items.some((item) => {
          const balance = currentById.get(item.productId)?.stockBalances[0];
          return !balance || balance.onHand.sub(balance.reserved).lessThan(item.quantity);
        })) { status = "CONFLICT"; reason = "INSUFFICIENT_STOCK"; }
        const payload = JSON.parse(envelope.payload) as Prisma.InputJsonValue;
        if (status !== "SYNCED") {
          await tx.offlineSubmission.create({ data: { transactionId: sale.transactionId, terminalId: terminal.id, snapshotId: snapshot.id, payload, payloadHash: hash, status, reason } });
          await tx.auditLog.create({ data: { actorUserId: actor.id, action: "OFFLINE_SALE_REVIEW_REQUIRED", entityType: "OfflineSubmission", entityId: sale.transactionId, afterData: { status, reason, terminalId: terminal.id } } });
          return { status, reason, transactionId: sale.transactionId, saleId: null };
        }
        const newSale = await postOfflineSale(tx, sale, snapshot, terminal.cashierUserId, actor.id, currentById, false);
        await tx.offlineSubmission.create({ data: { transactionId: sale.transactionId, terminalId: terminal.id, snapshotId: snapshot.id, payload, payloadHash: hash, status: "SYNCED", saleId: newSale.id } });
        return { status: "SYNCED", reason: null, transactionId: sale.transactionId, saleId: newSale.id };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code) && attempt < 2) continue;
      throw error;
    }
  }
  throw new BusinessError("OFFLINE_SYNC_RETRY_EXHAUSTED", "Concurrent stock update prevented synchronization.");
}

export async function listOfflineReviews(actor: SessionUser) {
  assertRole(actor.role, [Role.OWNER_ADMIN]);
  const submissions = await prisma.offlineSubmission.findMany({
    where: { status: { in: ["CONFLICT", "REQUIRES_REVIEW"] } },
    include: { resolution: true },
    orderBy: { createdAt: "asc" },
  });
  return submissions.map((row) => ({
    transactionId: row.transactionId,
    payloadHash: row.payloadHash,
    status: row.status,
    reason: row.reason,
    sale: row.payload,
    receivedAt: row.createdAt.toISOString(),
    resolution: row.resolution && {
      action: row.resolution.action,
      cashAmount: row.resolution.cashAmount.toFixed(2),
      saleId: row.resolution.saleId,
      evidence: row.resolution.evidence,
      resolvedAt: row.resolution.resolvedAt.toISOString(),
    },
  }));
}

const resolveSchema = z.object({
  transactionId: z.string().uuid(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  cashAmountCents: z.number().int().positive(),
  action: z.enum(["POST_SALE", "CASH_REFUNDED"]),
  evidence: z.string().trim().min(20).max(2000),
}).strict();

export async function resolveOfflineSubmission(actor: SessionUser, input: unknown) {
  assertRole(actor.role, [Role.OWNER_ADMIN]);
  const parsed = resolveSchema.parse(input);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "transactionId" FROM "OfflineSubmission" WHERE "transactionId" = ${parsed.transactionId}::uuid FOR UPDATE`;
        const submission = await tx.offlineSubmission.findUnique({ where: { transactionId: parsed.transactionId }, include: { resolution: true, snapshot: true, terminal: true } });
        if (!submission || submission.status === "SYNCED") throw new BusinessError("OFFLINE_REVIEW_NOT_FOUND", "An unresolved offline submission was not found.");
        if (submission.payloadHash !== parsed.payloadHash) throw new BusinessError("OFFLINE_REVIEW_CHANGED", "The submitted receipt evidence changed.");
        const sale = offlineSaleSchema.parse(submission.payload);
        const snapshot = offlineSnapshotSchema.parse(submission.snapshot.payload);
        if (sale.transactionId !== submission.transactionId || sale.snapshotId !== snapshot.id || sale.terminalId !== submission.terminalId || sale.storeId !== snapshot.storeId) throw new BusinessError("OFFLINE_REVIEW_INVALID", "Stored receipt and authorization do not match.");
        if (sale.subtotalCents !== parsed.cashAmountCents) throw new BusinessError("OFFLINE_CASH_AMOUNT_MISMATCH", "Cash amount must equal the original receipt total.");
        if (submission.resolution) {
          if (submission.resolution.action !== parsed.action || submission.resolution.evidence !== parsed.evidence || !submission.resolution.cashAmount.equals(new Prisma.Decimal(parsed.cashAmountCents).div(100))) throw new BusinessError("OFFLINE_RESOLUTION_CONFLICT", "This receipt has already been resolved differently.");
          return { transactionId: sale.transactionId, action: submission.resolution.action, saleId: submission.resolution.saleId };
        }
        const originalDay = parseOperatingDate(getNepalOperatingDateKey(new Date(sale.createdAt)));
        const today = parseOperatingDate(getNepalOperatingDateKey());
        if (parsed.action === "POST_SALE" && new Date(sale.createdAt).getTime() > Date.now() + 5 * 60_000) throw new BusinessError("OFFLINE_CLOCK_INVALID", "A future-dated offline receipt cannot be posted.");
        const postedDay = parsed.action === "POST_SALE" ? originalDay : today;
        const closed = await tx.dailyClose.findFirst({ where: { storeLocationId: snapshot.storeId, operatingDate: postedDay, status: DailyCloseStatus.CLOSED } });
        if (closed) throw new BusinessError("OFFLINE_DAY_CLOSED", "Reopen the applicable cash day before resolving this receipt.");
        const total = new Prisma.Decimal(sale.subtotalCents).div(100);
        let saleId: string | null = null;
        if (parsed.action === "POST_SALE") {
          const products = await tx.product.findMany({ where: { id: { in: sale.items.map((item) => item.productId) } }, include: { stockBalances: { where: { locationId: snapshot.storeId } } } });
          const byId = new Map(products.map((product) => [product.id, product]));
          if (sale.items.some((item) => {
            const product = byId.get(item.productId);
            const approved = snapshot.products.find((candidate) => candidate.productId === item.productId);
            const balance = product?.stockBalances[0];
            return !product?.active || !approved || approved.priceCents !== item.priceCents || !balance || balance.onHand.sub(balance.reserved).lessThan(item.quantity);
          })) throw new BusinessError("OFFLINE_STOCK_OR_PRICE_UNRESOLVED", "Reconcile and adjust physical stock through the inventory workflow before posting the original sale.");
          const posted = await postOfflineSale(tx, sale, snapshot, submission.terminal.cashierUserId, actor.id, byId, true);
          saleId = posted.id;
        } else {
          await tx.cashMovement.createMany({ data: [
            { storeLocationId: snapshot.storeId, operatingDate: today, type: CashMovementType.OTHER_APPROVED, effect: CashMovementEffect.IN, amount: total, category: "OFFLINE_RECEIPT_COLLECTED", reason: parsed.evidence, referenceType: "OFFLINE_SUBMISSION", referenceId: sale.transactionId, idempotencyKey: `offline-cash-in:${sale.transactionId}`, userId: actor.id },
            { storeLocationId: snapshot.storeId, operatingDate: today, type: CashMovementType.REFUND_OUT, effect: CashMovementEffect.OUT, amount: total, category: "OFFLINE_RECEIPT_REFUNDED", reason: parsed.evidence, referenceType: "OFFLINE_SUBMISSION", referenceId: sale.transactionId, idempotencyKey: `offline-cash-refund:${sale.transactionId}`, userId: actor.id },
          ] });
        }
        await tx.offlineResolution.create({ data: { transactionId: sale.transactionId, action: parsed.action, cashAmount: total, evidence: parsed.evidence, saleId, resolvedByUserId: actor.id } });
        await tx.auditLog.create({ data: { actorUserId: actor.id, action: "OFFLINE_SUBMISSION_RESOLVED", entityType: "OfflineSubmission", entityId: sale.transactionId, beforeData: { status: submission.status, reason: submission.reason, payloadHash: submission.payloadHash }, afterData: { action: parsed.action, originalCashAmount: total.toFixed(2), saleId, evidence: parsed.evidence, cashDay: getNepalOperatingDateKey(postedDay) } } });
        return { transactionId: sale.transactionId, action: parsed.action, saleId };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code) && attempt < 2) continue;
      throw error;
    }
  }
  throw new BusinessError("OFFLINE_RESOLUTION_RETRY_EXHAUSTED", "Concurrent resolution prevented settlement.");
}
