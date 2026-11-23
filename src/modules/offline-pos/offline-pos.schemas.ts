import { z } from "zod";

export const offlineProductSchema = z.object({
  productId: z.string().uuid(),
  sku: z.string().min(1),
  barcode: z.string().nullable(),
  name: z.string().min(1),
  unit: z.string().min(1),
  priceCents: z.number().int().nonnegative().max(100_000_000),
  availableUnits: z.number().int().nonnegative(),
}).strict();

export const offlineSnapshotSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  terminalId: z.string().uuid(),
  storeId: z.string().uuid(),
  storeName: z.string().min(1),
  cashierId: z.string().uuid(),
  cashierName: z.string().min(1),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  maxTotalCents: z.number().int().positive(),
  taxPolicy: z.literal("REGULAR_PRICE_TAX_INCLUSIVE"),
  products: z.array(offlineProductSchema).min(1).max(1000),
}).strict();

export const offlineSaleSchema = z.object({
  version: z.literal(1),
  transactionId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  terminalId: z.string().uuid(),
  storeId: z.string().uuid(),
  cashierId: z.string().uuid(),
  createdAt: z.string().datetime(),
  receiptNumber: z.string().regex(/^OFF-[A-Z0-9-]{8,60}$/),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive().max(1000),
    priceCents: z.number().int().nonnegative(),
    lineTotalCents: z.number().int().nonnegative(),
  }).strict()).min(1).max(100),
  subtotalCents: z.number().int().positive(),
  discountCents: z.literal(0),
  taxPolicy: z.literal("REGULAR_PRICE_TAX_INCLUSIVE"),
  payment: z.object({
    method: z.literal("CASH"),
    tenderedCents: z.number().int().nonnegative(),
  }).strict(),
}).strict().superRefine((sale, context) => {
  if (new Set(sale.items.map((item) => item.productId)).size !== sale.items.length ||
      sale.receiptNumber !== `OFF-${sale.transactionId.toUpperCase()}` ||
      sale.items.some((item) => item.priceCents * item.quantity !== item.lineTotalCents) ||
      sale.items.reduce((sum, item) => sum + item.lineTotalCents, 0) !== sale.subtotalCents ||
      sale.payment.tenderedCents < sale.subtotalCents) {
    context.addIssue({ code: "custom", message: "Offline sale totals or items are inconsistent." });
  }
});

export type OfflineSnapshot = z.infer<typeof offlineSnapshotSchema>;
export type OfflineSale = z.infer<typeof offlineSaleSchema>;
