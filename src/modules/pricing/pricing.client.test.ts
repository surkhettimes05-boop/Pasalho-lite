import { describe, expect, it, vi } from "vitest";
import {
  MemberPricingClient,
  PricingServiceClientError,
} from "./pricing.client";

const validQuote = {
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
      sku: "CLIENT-01",
      quantity: "1",
      regularUnitPrice: "10.00",
      appliedUnitPrice: "10.00",
      lineDiscount: "0.00",
      lineTotal: "10.00",
      promotionReference: null,
      promotionSnapshot: null,
    },
  ],
  subtotal: "10.00",
  discountTotal: "0.00",
  finalTotal: "10.00",
  currency: "NPR",
  pricingRuleVersion: 1,
  issuedAt: "2026-11-17T00:00:00.000Z",
  expiresAt: "2026-11-17T00:05:00.000Z",
};

const config = {
  apiUrl: "https://pricing.example.test",
  serviceToken: "test-service-token-that-is-never-rendered-to-a-browser",
  production: true,
};

describe("Modern member pricing client", () => {
  it("sends authenticated quote requests and parses the authoritative response", async () => {
    let request: Request | undefined;
    const client = new MemberPricingClient(config, async (input, init) => {
      request = new Request(input, init);
      return Response.json({
        quote: { ...validQuote, signedQuoteToken: "signed-token".repeat(4) },
      });
    });

    const result = await client.createQuote({
      channel: "POS",
      storeReference: validQuote.storeReference,
      customerReference: null,
      customerPhoneReference: null,
      items: [{ sku: "CLIENT-01", quantity: "1" }],
    });

    expect(result.finalTotal).toBe("10.00");
    expect(request?.headers.get("authorization")).toBe(
      `Bearer ${config.serviceToken}`,
    );
    expect(request?.url).toBe(
      "https://pricing.example.test/api/internal/member-pricing/quotes",
    );
  });

  it("preserves the explicit COD channel in quote requests and responses", async () => {
    let requestBody: unknown;
    const client = new MemberPricingClient(config, async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        quote: {
          ...validQuote,
          channel: "COD",
          signedQuoteToken: "signed-token".repeat(4),
        },
      });
    });

    const result = await client.createQuote({
      channel: "COD",
      storeReference: validQuote.storeReference,
      customerReference: null,
      customerPhoneReference: null,
      items: [{ sku: "CLIENT-01", quantity: "1" }],
    });

    expect(requestBody).toMatchObject({ channel: "COD" });
    expect(result.channel).toBe("COD");
  });

  it("requires HTTPS for production and fails explicitly when the API is unavailable", async () => {
    expect(
      () =>
        new MemberPricingClient({
          ...config,
          apiUrl: "http://pricing.example.test",
        }),
    ).toThrowError(PricingServiceClientError);

    const client = new MemberPricingClient(config, async () => {
      throw new Error("network unavailable");
    });
    await expect(
      client.createQuote({
        channel: "POS",
        storeReference: validQuote.storeReference,
        customerReference: null,
        customerPhoneReference: null,
        items: [{ sku: "CLIENT-01", quantity: "1" }],
      }),
    ).rejects.toMatchObject({ code: "PRICING_SERVICE_UNAVAILABLE" });
  });

  it("rejects a response with altered totals instead of trusting it", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        quote: {
          ...validQuote,
          finalTotal: "9.99",
          signedQuoteToken: "signed-token".repeat(4),
        },
      }),
    );
    const client = new MemberPricingClient(config, fetcher);
    await expect(
      client.createQuote({
        channel: "POS",
        storeReference: validQuote.storeReference,
        customerReference: null,
        customerPhoneReference: null,
        items: [{ sku: "CLIENT-01", quantity: "1" }],
      }),
    ).rejects.toMatchObject({ code: "PRICING_RESPONSE_INVALID" });
  });
});
