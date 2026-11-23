import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

type QuoteRequest = {
  channel: "POS" | "COD";
  storeReference: string;
  customerReference: string | null;
  items: Array<{ sku: string; quantity: string }>;
  signedQuoteToken?: string;
  saleReference?: string;
};

export type ModernPricingMembershipProfile = {
  membershipNumber: number | null;
  membershipTier: "REGISTERED_MEMBER" | "FOUNDING_1000" | null;
  membershipStatus: "ACTIVE" | "SUSPENDED" | "CANCELLED" | "NOT_MEMBER";
};

export type ModernPricingMockCleanup = (() => void) & {
  setMembershipProfile: (
    customerReference: string,
    profile: ModernPricingMembershipProfile,
  ) => void;
};

function response(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export function installModernPricingMock() {
  const originalFetch = globalThis.fetch;
  const quotes = new Map<string, Record<string, unknown>>();
  const claimedSaleByToken = new Map<string, string>();
  const membershipProfiles = new Map<
    string,
    ModernPricingMembershipProfile
  >();

  globalThis.fetch = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    const headers = new Headers(init?.headers);
    if (
      headers.get("authorization") !==
      `Bearer ${process.env.MODERN_PRICING_SERVICE_TOKEN}`
    ) {
      return response({ code: "SERVICE_AUTH_INVALID" }, 401);
    }

    if (url.pathname.endsWith("/customers/verify")) {
      const request = JSON.parse(String(init?.body)) as {
        customerReference: string;
      };
      return response({
        customer: {
          customerReference: request.customerReference,
          ...(membershipProfiles.get(request.customerReference) ?? {
            membershipNumber: 1,
            membershipTier: "REGISTERED_MEMBER",
            membershipStatus: "ACTIVE",
          }),
        },
      });
    }

    if (url.pathname.endsWith("/catalog")) {
      const products = await prisma.product.findMany({
        select: { sku: true, active: true, sellingPrice: true },
      });
      return response({
        storeReference: url.searchParams.get("storeReference"),
        currency: "NPR",
        products: products.map((product) => ({
          productReference: randomUUID(),
          sku: product.sku,
          active: product.active,
          regularUnitPrice: product.sellingPrice.toFixed(2),
          currency: "NPR",
          memberPricingEligible: true,
          ineligibilityReasons: [],
        })),
      });
    }

    if (url.pathname.endsWith("/quotes/validate")) {
      const request = JSON.parse(String(init?.body)) as QuoteRequest;
      const token = request.signedQuoteToken ?? "";
      const quote = quotes.get(token);
      if (!quote || !request.saleReference) {
        return response({ code: "QUOTE_SIGNATURE_INVALID" }, 409);
      }
      const existingSale = claimedSaleByToken.get(token);
      if (existingSale && existingSale !== request.saleReference) {
        return response({ code: "QUOTE_REPLAY" }, 409);
      }
      if (
        quote.channel !== request.channel ||
        quote.storeReference !== request.storeReference ||
        quote.customerReference !== request.customerReference ||
        JSON.stringify(
          (quote.items as Array<{ sku: string; quantity: string }>).map(
            ({ sku, quantity }) => ({ sku, quantity }),
          ),
        ) !==
          JSON.stringify(
            request.items.map(({ sku, quantity }) => ({
              sku,
              quantity: new Prisma.Decimal(quantity).toString(),
            })),
          )
      ) {
        return response({ code: "QUOTE_MISMATCH" }, 409);
      }
      claimedSaleByToken.set(token, request.saleReference);
      const payload = { ...quote };
      delete payload.signedQuoteToken;
      return response({ valid: true, quote: payload });
    }

    if (!url.pathname.endsWith("/quotes")) {
      return response({ code: "NOT_FOUND" }, 404);
    }

    const request = JSON.parse(String(init?.body)) as QuoteRequest;
    const products = await prisma.product.findMany({
      where: { sku: { in: request.items.map((item) => item.sku) } },
      select: { sku: true, sellingPrice: true },
    });
    if (products.length !== request.items.length) {
      return response({ code: "SKU_NOT_FOUND" }, 409);
    }

    const productBySku = new Map(
      products.map((product) => [product.sku, product]),
    );
    const membership = request.customerReference
      ? membershipProfiles.get(request.customerReference) ?? {
          membershipNumber: 1,
          membershipTier: "REGISTERED_MEMBER" as const,
          membershipStatus: "ACTIVE" as const,
        }
      : {
          membershipNumber: null,
          membershipTier: null,
          membershipStatus: "NOT_MEMBER" as const,
        };
    const isMember =
      membership.membershipStatus === "ACTIVE" &&
      membership.membershipTier !== null;
    let subtotal = new Prisma.Decimal(0);
    let discountTotal = new Prisma.Decimal(0);
    const items = request.items.map((item) => {
      const product = productBySku.get(item.sku);
      if (!product) throw new Error("Missing test pricing product.");
      const unitPrice = product.sellingPrice.toFixed(2);
      const appliedUnitPrice = isMember
        ? new Prisma.Decimal(unitPrice).sub(5).toFixed(2)
        : unitPrice;
      const regularLineTotal = new Prisma.Decimal(unitPrice)
        .mul(item.quantity)
        .toDecimalPlaces(2)
        .toFixed(2);
      const lineTotal = new Prisma.Decimal(appliedUnitPrice)
        .mul(item.quantity)
        .toDecimalPlaces(2)
        .toFixed(2);
      const lineDiscount = new Prisma.Decimal(regularLineTotal)
        .sub(lineTotal)
        .toFixed(2);
      subtotal = subtotal.add(regularLineTotal);
      discountTotal = discountTotal.add(lineDiscount);
      return {
        sku: item.sku,
        quantity: new Prisma.Decimal(item.quantity).toString(),
        regularUnitPrice: unitPrice,
        appliedUnitPrice,
        lineDiscount,
        lineTotal,
        promotionReference: isMember
          ? "3d1868fc-042c-4c7a-9b9b-fc615e31e3e1"
          : null,
        promotionSnapshot: isMember
          ? {
              id: "3d1868fc-042c-4c7a-9b9b-fc615e31e3e1",
              name: "Test member promotion",
              version: 1,
            }
          : null,
      };
    });
    const now = new Date();
    const signedQuoteToken = `test-quote-${randomUUID()}`;
    const quote = {
      quoteId: randomUUID(),
      channel: request.channel,
      storeReference: request.storeReference,
      customerReference: request.customerReference,
      membershipNumber: membership.membershipNumber,
      membershipTier: membership.membershipTier,
      membershipStatus: membership.membershipStatus,
      customerStatus: request.customerReference ? "ACTIVE" : null,
      items,
      subtotal: subtotal.toFixed(2),
      discountTotal: discountTotal.toFixed(2),
      finalTotal: subtotal.sub(discountTotal).toFixed(2),
      currency: "NPR",
      pricingRuleVersion: 1,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      signedQuoteToken,
    };
    quotes.set(signedQuoteToken, quote);
    return response({ quote }, 201);
  };

  const cleanup = (() => {
    globalThis.fetch = originalFetch;
  }) as ModernPricingMockCleanup;
  cleanup.setMembershipProfile = (customerReference, profile) => {
    membershipProfiles.set(customerReference, profile);
  };
  return cleanup;
}
