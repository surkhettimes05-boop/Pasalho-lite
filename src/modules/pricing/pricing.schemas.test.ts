import { describe, expect, it } from "vitest";
import {
  issuedPricingQuoteSchema,
  pricingQuotePayloadSchema,
  validatedPricingQuoteSchema,
} from "./pricing.schemas";

function quote(overrides: Record<string, unknown> = {}) {
  return {
    quoteId: "f8e04311-36e5-48c7-8e2c-929f5c2bb03d",
    channel: "POS",
    storeReference: "3d1868fc-042c-4c7a-9b9b-fc615e31e3e1",
    customerReference: null,
    membershipNumber: null,
    membershipTier: null,
    membershipStatus: "NOT_MEMBER",
    customerStatus: null,
    items: [
      {
        sku: "DECIMAL-01",
        quantity: "0.333",
        regularUnitPrice: "10.00",
        appliedUnitPrice: "7.00",
        lineDiscount: "1.00",
        lineTotal: "2.33",
        promotionReference: null,
        promotionSnapshot: null,
      },
    ],
    subtotal: "3.33",
    discountTotal: "1.00",
    finalTotal: "2.33",
    currency: "NPR",
    pricingRuleVersion: 1,
    issuedAt: "2026-11-17T00:00:00.000Z",
    expiresAt: "2026-11-17T00:05:00.000Z",
    ...overrides,
  };
}

describe("authoritative pricing quote schemas", () => {
  it("accepts fractional-quantity money totals using exact paise arithmetic", () => {
    expect(pricingQuotePayloadSchema.safeParse(quote()).success).toBe(true);
  });

  it("accepts the explicit COD pricing channel", () => {
    expect(
      pricingQuotePayloadSchema.safeParse(quote({ channel: "COD" })).success,
    ).toBe(true);
  });

  it("rejects altered line discounts, totals, and unexpected price fields", () => {
    expect(
      pricingQuotePayloadSchema.safeParse(
        quote({
          items: [
            {
              ...(quote().items as Array<Record<string, unknown>>)[0],
              lineDiscount: "0.99",
            },
          ],
        }),
      ).success,
    ).toBe(false);
    expect(
      pricingQuotePayloadSchema.safeParse(quote({ finalTotal: "2.34" }))
        .success,
    ).toBe(false);
    expect(
      pricingQuotePayloadSchema.safeParse(quote({ frontendPrice: "0.01" }))
        .success,
    ).toBe(false);
  });

  it("requires a signed token on issued quotes and a valid result on validation", () => {
    const issued = issuedPricingQuoteSchema.safeParse({
      quote: { ...quote(), signedQuoteToken: "a".repeat(32) },
    });
    expect(issued.success).toBe(true);
    expect(issuedPricingQuoteSchema.safeParse({ quote: quote() }).success).toBe(
      false,
    );
    expect(
      validatedPricingQuoteSchema.safeParse({
        valid: true,
        quote: quote(),
      }).success,
    ).toBe(true);
  });
});
