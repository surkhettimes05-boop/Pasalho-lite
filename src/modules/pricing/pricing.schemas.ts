import { z } from "zod";

const moneySchema = z.string().regex(/^(?:0|[1-9]\d{0,9})\.\d{2}$/);
const quantitySchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/)
  .refine((value) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0")) > 0n;
  });

function cents(value: string) {
  const [whole, fraction] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction);
}

const pricingQuoteItemSchema = z
  .object({
    sku: z.string().min(1).max(100),
    quantity: quantitySchema,
    regularUnitPrice: moneySchema,
    appliedUnitPrice: moneySchema,
    lineDiscount: moneySchema,
    lineTotal: moneySchema,
    promotionReference: z.string().uuid().nullable(),
    promotionSnapshot: z
      .object({
        id: z.string().uuid(),
        name: z.string(),
        version: z.number().int().positive(),
      })
      .strict()
      .nullable(),
  })
  .strict();

const quotePayloadFields = z
  .object({
    quoteId: z.string().uuid(),
    channel: z.enum(["POS", "WEB", "APP", "COD"]),
    storeReference: z.string().uuid(),
    customerReference: z.string().uuid().nullable(),
    membershipNumber: z.number().int().positive().nullable(),
    membershipTier: z.enum(["REGISTERED_MEMBER", "FOUNDING_1000"]).nullable(),
    membershipStatus: z.enum([
      "ACTIVE",
      "SUSPENDED",
      "CANCELLED",
      "NOT_MEMBER",
    ]),
    customerStatus: z.string().max(40).nullable(),
    items: z.array(pricingQuoteItemSchema).min(1).max(100),
    subtotal: moneySchema,
    discountTotal: moneySchema,
    finalTotal: moneySchema,
    currency: z.literal("NPR"),
    pricingRuleVersion: z.number().int().positive(),
    issuedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

function validateQuoteTotals(
  quote: z.infer<typeof quotePayloadFields>,
  context: z.RefinementCtx,
) {
  const lineTotals = quote.items.reduce(
    (sum, item) => sum + cents(item.lineTotal),
    0n,
  );
  const lineDiscounts = quote.items.reduce(
    (sum, item) => sum + cents(item.lineDiscount),
    0n,
  );
  const invalidLine = quote.items.some((item) => {
    const [whole, fraction = ""] = item.quantity.split(".");
    const quantityMilli =
      BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
    const regularLine =
      (cents(item.regularUnitPrice) * quantityMilli + 500n) / 1000n;
    const appliedLine =
      (cents(item.appliedUnitPrice) * quantityMilli + 500n) / 1000n;
    return (
      cents(item.appliedUnitPrice) > cents(item.regularUnitPrice) ||
      cents(item.lineTotal) !== appliedLine ||
      cents(item.lineDiscount) !== regularLine - appliedLine
    );
  });

  if (
    lineTotals !== cents(quote.finalTotal) ||
    lineDiscounts !== cents(quote.discountTotal) ||
    cents(quote.subtotal) !== lineTotals + lineDiscounts ||
    invalidLine
  ) {
    context.addIssue({
      code: "custom",
      path: ["items"],
      message: "The pricing quote totals are inconsistent.",
    });
  }
}

export const pricingQuotePayloadSchema =
  quotePayloadFields.superRefine(validateQuoteTotals);

export const issuedPricingQuoteSchema = z
  .object({
    quote: quotePayloadFields
      .extend({ signedQuoteToken: z.string().min(20).max(32_768) })
      .strict()
      .superRefine(validateQuoteTotals),
  })
  .strict()
  .transform(({ quote }) => quote);

export const validatedPricingQuoteSchema = z
  .object({
    valid: z.literal(true),
    quote: pricingQuotePayloadSchema,
  })
  .strict();

export const pricingCatalogSchema = z
  .object({
    storeReference: z.string().uuid(),
    currency: z.literal("NPR"),
    products: z.array(
      z
        .object({
          productReference: z.string().uuid(),
          sku: z.string().min(1).max(100),
          active: z.boolean(),
          regularUnitPrice: moneySchema.nullable(),
          currency: z.string().nullable(),
          memberPricingEligible: z.boolean(),
          ineligibilityReasons: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict();

export const verifiedMembershipCustomerSchema = z
  .object({
    customer: z
      .object({
        customerReference: z.string().uuid(),
        membershipNumber: z.number().int().positive().nullable(),
        membershipTier: z
          .enum(["REGISTERED_MEMBER", "FOUNDING_1000"])
          .nullable(),
        membershipStatus: z.enum([
          "ACTIVE",
          "SUSPENDED",
          "CANCELLED",
          "NOT_MEMBER",
        ]),
      })
      .strict(),
  })
  .strict();

export type PricingQuotePayload = z.infer<typeof pricingQuotePayloadSchema>;
export type IssuedPricingQuote = z.infer<typeof issuedPricingQuoteSchema>;
export type PricingCatalog = z.infer<typeof pricingCatalogSchema>;
