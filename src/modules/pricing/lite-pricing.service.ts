import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma, Role } from "@/generated/prisma/client";
import { assertRole } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import {
  issuedPricingQuoteSchema,
  pricingQuotePayloadSchema,
  type PricingQuotePayload,
} from "@/modules/pricing/pricing.schemas";
import { z } from "zod";

const posInputSchema = z.object({
  customerId: z.string().uuid().nullable(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.string().trim().regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/),
  }).strict()).min(1).max(100),
}).strict().superRefine((value, context) => {
  if (new Set(value.items.map((item) => item.productId)).size !== value.items.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "Each product may appear only once in the POS cart." });
  }
});

const validateInputSchema = posInputSchema.extend({
  idempotencyKey: z.string().trim().min(8).max(200),
  signedQuoteToken: z.string().min(20).max(32_768),
}).strict();

const tokenSchema = z.object({
  actorId: z.string().uuid(),
  quote: pricingQuotePayloadSchema,
}).strict();

const tokenPrefix = "lite1";
const quoteLifetimeMs = 5 * 60 * 1000;

function error(code: string, message: string): never {
  throw new BusinessError(code, message);
}

function sign(encoded: string) {
  return createHmac("sha256", env.AUTH_SECRET).update(encoded).digest();
}

function issueToken(actorId: string, quote: PricingQuotePayload) {
  const encoded = Buffer.from(JSON.stringify({ actorId, quote })).toString("base64url");
  return `${tokenPrefix}.${encoded}.${sign(encoded).toString("base64url")}`;
}

function readToken(token: string, actorId: string): PricingQuotePayload {
  const [prefix, encoded, signature, extra] = token.split(".");
  if (prefix !== tokenPrefix || !encoded || !signature || extra !== undefined) {
    return error("QUOTE_INVALID", "The local price quote is invalid. Request a new quote.");
  }
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, "base64url");
  } catch {
    return error("QUOTE_INVALID", "The local price quote is invalid. Request a new quote.");
  }
  const expected = sign(encoded);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return error("QUOTE_INVALID", "The local price quote is invalid. Request a new quote.");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return error("QUOTE_INVALID", "The local price quote is invalid. Request a new quote.");
  }
  const parsed = tokenSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.actorId !== actorId) {
    return error("QUOTE_INVALID", "The local price quote is invalid. Request a new quote.");
  }
  if (Date.parse(parsed.data.quote.expiresAt) <= Date.now()) {
    return error("QUOTE_EXPIRED", "The price quote expired. Request a new quote.");
  }
  return parsed.data.quote;
}

async function createRegularQuote(
  rawInput: unknown,
): Promise<PricingQuotePayload> {
  const input = posInputSchema.parse(rawInput);
  const [store, products, customer] = await Promise.all([
    prisma.location.findFirst({ where: { code: "STORE_MAIN", type: "STORE", active: true } }),
    prisma.product.findMany({
      where: { id: { in: input.items.map((item) => item.productId) } },
      select: { id: true, sku: true, active: true, sellingPrice: true },
    }),
    input.customerId
      ? prisma.customer.findUnique({ where: { id: input.customerId }, select: { id: true, active: true, membershipIdentityId: true } })
      : Promise.resolve(null),
  ]);

  if (!store) error("STORE_NOT_FOUND", "The V1 store is not available.");
  if (products.length !== input.items.length || products.some((product) => !product.active)) {
    error("PRODUCT_NOT_AVAILABLE", "Every cart item must reference an active Lite product.");
  }
  if (input.customerId && (!customer || !customer.active)) {
    error("CUSTOMER_NOT_AVAILABLE", "Selected customer is unavailable.");
  }

  const productById = new Map(products.map((product) => [product.id, product]));
  const items = input.items.map((item) => {
    const product = productById.get(item.productId);
    if (!product) error("PRODUCT_NOT_AVAILABLE", "Every cart item must reference an active Lite product.");
    const price = new Prisma.Decimal(product.sellingPrice).toDecimalPlaces(2);
    if (!price.greaterThan(0)) error("PRICE_NOT_CONFIGURED", `A valid Lite selling price is not configured for ${product.sku}.`);
    const quantity = new Prisma.Decimal(item.quantity);
    const lineTotal = price.mul(quantity).toDecimalPlaces(2);
    return {
      sku: product.sku,
      quantity: quantity.toString(),
      regularUnitPrice: price.toFixed(2),
      appliedUnitPrice: price.toFixed(2),
      lineDiscount: "0.00",
      lineTotal: lineTotal.toFixed(2),
      promotionReference: null,
      promotionSnapshot: null,
    };
  });
  const subtotal = items.reduce((sum, item) => sum.add(item.lineTotal), new Prisma.Decimal(0)).toDecimalPlaces(2);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + quoteLifetimeMs);

  return pricingQuotePayloadSchema.parse({
    quoteId: randomUUID(),
    channel: "POS",
    storeReference: store.id,
    customerReference: customer?.id ?? null,
    membershipNumber: null,
    membershipTier: null,
    membershipStatus: customer?.membershipIdentityId
      ? "EXTERNAL_UNVERIFIED"
      : "NOT_MEMBER",
    customerStatus: customer ? "ACTIVE" : null,
    items,
    subtotal: subtotal.toFixed(2),
    discountTotal: "0.00",
    finalTotal: subtotal.toFixed(2),
    currency: "NPR",
    pricingRuleVersion: 1,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
}

export async function quoteLitePosPricing(actor: SessionUser, input: unknown) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const quote = await createRegularQuote(input);
  return issuedPricingQuoteSchema.parse({ quote: { ...quote, signedQuoteToken: issueToken(actor.id, quote) } });
}

export async function validateLitePosPricingQuote(actor: SessionUser, rawInput: unknown) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const input = validateInputSchema.parse(rawInput);
  const issued = readToken(input.signedQuoteToken, actor.id);
  const current = await createRegularQuote({ customerId: input.customerId, items: input.items });
  const expectedItems = issued.items.map(({ sku, quantity, regularUnitPrice, appliedUnitPrice, lineTotal }) => ({ sku, quantity, regularUnitPrice, appliedUnitPrice, lineTotal })).sort((a, b) => a.sku.localeCompare(b.sku));
  const currentItems = current.items.map(({ sku, quantity, regularUnitPrice, appliedUnitPrice, lineTotal }) => ({ sku, quantity, regularUnitPrice, appliedUnitPrice, lineTotal })).sort((a, b) => a.sku.localeCompare(b.sku));
  if (
    issued.channel !== "POS" ||
    issued.storeReference !== current.storeReference ||
    issued.customerReference !== current.customerReference ||
    JSON.stringify(expectedItems) !== JSON.stringify(currentItems) ||
    issued.subtotal !== current.subtotal ||
    issued.discountTotal !== current.discountTotal ||
    issued.finalTotal !== current.finalTotal
  ) {
    error("QUOTE_MISMATCH", "The Lite price quote no longer matches this cart or current product prices. Request a new quote.");
  }
  return issued;
}

export async function getLiteRegularPriceCatalog(actor: SessionUser) {
  assertRole(actor.role, [Role.OWNER_ADMIN]);
  const store = await prisma.location.findFirst({ where: { code: "STORE_MAIN", type: "STORE", active: true } });
  if (!store) error("STORE_NOT_FOUND", "The V1 store is not available.");
  const products = await prisma.product.findMany({
    where: { active: true },
    orderBy: { sku: "asc" },
    select: { id: true, sku: true, sellingPrice: true },
  });
  return {
    storeReference: store.id,
    currency: "NPR" as const,
    products: products.map((product) => ({
      productReference: product.id,
      sku: product.sku,
      active: true,
      regularUnitPrice: product.sellingPrice.toFixed(2),
      currency: "NPR",
      memberPricingEligible: false,
      ineligibilityReasons: ["LITE_REGULAR_PRICE_ONLY"],
    })),
  };
}
