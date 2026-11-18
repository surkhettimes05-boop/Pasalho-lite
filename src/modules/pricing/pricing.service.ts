import "server-only";
import { Prisma, Role } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { assertRole } from "@/lib/auth/authorization";
import type { SessionUser } from "@/lib/auth/session";
import { BusinessError } from "@/lib/business-error";
import { prisma } from "@/lib/db";
import {
  MemberPricingClient,
  PricingServiceClientError,
} from "@/modules/pricing/pricing.client";
import type {
  PricingCatalog,
  PricingQuotePayload,
} from "@/modules/pricing/pricing.schemas";
import { z } from "zod";

const posPricingFields = z.object({
  customerId: z.string().uuid().nullable(),
  items: z
    .array(
      z
        .object({
          productId: z.string().uuid(),
          quantity: z
            .string()
            .trim()
            .regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/)
            .refine((value) => new Prisma.Decimal(value).greaterThan(0)),
        })
        .strict(),
    )
    .min(1)
    .max(100),
});

function validateUniqueProducts(
  value: { items: Array<{ productId: string }> },
  context: z.RefinementCtx,
) {
  if (
    new Set(value.items.map((item) => item.productId)).size !==
    value.items.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["items"],
      message: "Each product may appear only once in the POS cart.",
    });
  }
}

const posPricingInputSchema = posPricingFields
  .strict()
  .superRefine(validateUniqueProducts);

const validatePricingInputSchema = posPricingFields
  .extend({
    idempotencyKey: z.string().trim().min(8).max(200),
    signedQuoteToken: z.string().min(20).max(32_768),
  })
  .strict()
  .superRefine(validateUniqueProducts);

function getClient() {
  if (
    !env.MODERN_PRICING_API_URL ||
    !env.MODERN_PRICING_SERVICE_TOKEN ||
    !env.MODERN_PRICING_STORE_REFERENCE
  ) {
    throw new BusinessError(
      "PRICING_SERVICE_NOT_CONFIGURED",
      "The authoritative pricing service is not configured.",
    );
  }
  try {
    return new MemberPricingClient({
      apiUrl: env.MODERN_PRICING_API_URL,
      serviceToken: env.MODERN_PRICING_SERVICE_TOKEN,
      production: env.APP_ENV === "production",
    });
  } catch (error) {
    if (error instanceof PricingServiceClientError) {
      throw new BusinessError(error.code, error.message);
    }
    throw error;
  }
}

function storeReference() {
  const reference = env.MODERN_PRICING_STORE_REFERENCE;
  if (!reference) {
    throw new BusinessError(
      "PRICING_SERVICE_NOT_CONFIGURED",
      "The authoritative store reference is not configured.",
    );
  }
  return reference;
}

function modernPhoneReference(phoneNormalized: string) {
  const digits = phoneNormalized.replace(/\D/g, "");
  return digits.startsWith("977") ? digits.slice(3) : digits;
}

async function loadPosPricingContext(
  input: z.infer<typeof posPricingInputSchema>,
) {
  const [store, products, customer] = await Promise.all([
    prisma.location.findFirst({
      where: {
        code: "STORE_MAIN",
        type: "STORE",
        active: true,
      },
    }),
    prisma.product.findMany({
      where: {
        id: { in: input.items.map((item) => item.productId) },
      },
      select: {
        id: true,
        sku: true,
        active: true,
      },
    }),
    input.customerId
      ? prisma.customer.findUnique({
          where: { id: input.customerId },
          select: {
            id: true,
            phoneNormalized: true,
            membershipIdentityId: true,
            active: true,
          },
        })
      : Promise.resolve(null),
  ]);

  if (!store) {
    throw new BusinessError(
      "STORE_NOT_FOUND",
      "The V1 store is not available.",
    );
  }
  if (products.length !== input.items.length) {
    throw new BusinessError(
      "PRODUCT_NOT_AVAILABLE",
      "Every cart item must reference an existing product.",
    );
  }
  if (products.some((product) => !product.active)) {
    throw new BusinessError(
      "PRODUCT_NOT_AVAILABLE",
      "Inactive products cannot be sold.",
    );
  }
  if (input.customerId && (!customer || !customer.active)) {
    throw new BusinessError(
      "CUSTOMER_NOT_AVAILABLE",
      "Selected customer is unavailable.",
    );
  }

  const productById = new Map(products.map((product) => [product.id, product]));
  const items = input.items.map((item) => {
    const product = productById.get(item.productId);
    if (!product) {
      throw new BusinessError(
        "PRODUCT_NOT_AVAILABLE",
        "Every POS item must reference an existing product.",
      );
    }
    return {
      productId: product.id,
      sku: product.sku,
      quantity: new Prisma.Decimal(item.quantity).toString(),
    };
  });

  const customerReference = customer?.membershipIdentityId ?? null;
  return {
    storeReference: storeReference(),
    customerReference,
    customerPhoneReference:
      customerReference && customer
        ? modernPhoneReference(customer.phoneNormalized)
        : null,
    items,
  };
}

function assertQuoteMatchesCart(
  quote: PricingQuotePayload,
  context: Awaited<ReturnType<typeof loadPosPricingContext>>,
  channel: PricingQuotePayload["channel"] = "POS",
) {
  const expectedItems = context.items
    .map(({ sku, quantity }) => ({ sku, quantity }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
  const actualItems = quote.items
    .map(({ sku, quantity }) => ({ sku, quantity }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
  if (
    quote.channel !== channel ||
    quote.storeReference !== context.storeReference ||
    quote.customerReference !== context.customerReference ||
    JSON.stringify(actualItems) !== JSON.stringify(expectedItems)
  ) {
    throw new BusinessError(
      "PRICING_RESPONSE_MISMATCH",
      "The pricing service returned a quote for a different cart or customer.",
    );
  }
}

async function callPricingService<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PricingServiceClientError) {
      throw new BusinessError(error.code, error.message);
    }
    throw error;
  }
}

export async function quotePosPricing(actor: SessionUser, rawInput: unknown) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const parsed = posPricingInputSchema.parse(rawInput);
  const context = await loadPosPricingContext(parsed);
  const client = getClient();
  const issued = await callPricingService(() =>
    client.createQuote({
      channel: "POS",
      storeReference: context.storeReference,
      customerReference: context.customerReference,
      customerPhoneReference: context.customerPhoneReference,
      items: context.items.map(({ sku, quantity }) => ({ sku, quantity })),
    }),
  );
  assertQuoteMatchesCart(issued, context);
  return issued;
}

export async function validatePosPricingQuote(
  actor: SessionUser,
  rawInput: unknown,
): Promise<PricingQuotePayload> {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const parsed = validatePricingInputSchema.parse(rawInput);
  const context = await loadPosPricingContext(parsed);
  const client = getClient();
  const quote = await callPricingService(() =>
    client.validateQuote({
      channel: "POS",
      storeReference: context.storeReference,
      customerReference: context.customerReference,
      customerPhoneReference: context.customerPhoneReference,
      items: context.items.map(({ sku, quantity }) => ({ sku, quantity })),
      saleReference: parsed.idempotencyKey,
      signedQuoteToken: parsed.signedQuoteToken,
    }),
  );
  assertQuoteMatchesCart(quote, context);
  return quote;
}

export async function quoteCustomerOrderPricing(
  actor: SessionUser,
  rawInput: unknown,
): Promise<PricingQuotePayload> {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const parsed = posPricingInputSchema.parse(rawInput);
  const context = await loadPosPricingContext(parsed);
  const client = getClient();
  const issued = await callPricingService(() =>
    client.createQuote({
      channel: "COD",
      storeReference: context.storeReference,
      customerReference: context.customerReference,
      customerPhoneReference: context.customerPhoneReference,
      items: context.items.map(({ sku, quantity }) => ({ sku, quantity })),
    }),
  );
  assertQuoteMatchesCart(issued, context, "COD");

  const quote = await callPricingService(() =>
    client.validateQuote({
      channel: "COD",
      storeReference: context.storeReference,
      customerReference: context.customerReference,
      customerPhoneReference: context.customerPhoneReference,
      items: context.items.map(({ sku, quantity }) => ({ sku, quantity })),
      saleReference: `COD:${issued.quoteId}`,
      signedQuoteToken: issued.signedQuoteToken,
    }),
  );
  assertQuoteMatchesCart(quote, context, "COD");
  return quote;
}

export async function getPosMembershipSnapshot(
  actor: SessionUser,
  customerId: string,
) {
  assertRole(actor.role, [Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const parsedCustomerId = z.string().uuid().parse(customerId);
  const customer = await prisma.customer.findUnique({
    where: { id: parsedCustomerId },
    select: {
      id: true,
      phoneNormalized: true,
      membershipIdentityId: true,
      active: true,
    },
  });
  if (!customer || !customer.active) {
    throw new BusinessError(
      "CUSTOMER_NOT_AVAILABLE",
      "Selected customer is unavailable.",
    );
  }
  const membershipIdentityId = customer.membershipIdentityId;
  if (!membershipIdentityId) {
    return {
      membershipNumber: null,
      membershipTier: null,
      membershipStatus: "NOT_MEMBER" as const,
    };
  }

  const verified = await callPricingService(() =>
    getClient().verifyCustomer({
      customerReference: membershipIdentityId,
      customerPhoneReference: modernPhoneReference(customer.phoneNormalized),
      storeReference: storeReference(),
    }),
  );
  if (verified.customerReference !== membershipIdentityId) {
    throw new BusinessError(
      "MEMBERSHIP_IDENTITY_MISMATCH",
      "The pricing service verified a different customer identity.",
    );
  }
  return {
    membershipNumber: verified.membershipNumber,
    membershipTier: verified.membershipTier,
    membershipStatus: verified.membershipStatus,
  };
}

export async function linkCustomerMembershipIdentity(
  actor: SessionUser,
  input: { customerId: string; membershipIdentityId: string | null },
) {
  assertRole(actor.role, [Role.OWNER_ADMIN]);
  const parsed = z
    .object({
      customerId: z.string().uuid(),
      membershipIdentityId: z.string().uuid().nullable(),
    })
    .strict()
    .parse(input);
  const customer = await prisma.customer.findUnique({
    where: { id: parsed.customerId },
    select: {
      id: true,
      phoneNormalized: true,
      active: true,
      membershipIdentityId: true,
    },
  });
  if (!customer || !customer.active) {
    throw new BusinessError(
      "CUSTOMER_NOT_AVAILABLE",
      "Selected customer is unavailable.",
    );
  }

  let membership = null;
  const membershipIdentityId = parsed.membershipIdentityId;
  if (membershipIdentityId) {
    const verified = await callPricingService(() =>
      getClient().verifyCustomer({
        customerReference: membershipIdentityId,
        customerPhoneReference: modernPhoneReference(customer.phoneNormalized),
        storeReference: storeReference(),
      }),
    );
    if (verified.customerReference !== membershipIdentityId) {
      throw new BusinessError(
        "MEMBERSHIP_IDENTITY_MISMATCH",
        "The pricing service verified a different customer identity.",
      );
    }
    membership = {
      tier: verified.membershipTier,
      status: verified.membershipStatus,
    };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.customer.findUnique({
        where: { id: customer.id },
        select: {
          id: true,
          phoneNormalized: true,
          active: true,
          membershipIdentityId: true,
        },
      });
      if (
        !current ||
        !current.active ||
        current.phoneNormalized !== customer.phoneNormalized
      ) {
        throw new BusinessError(
          "CUSTOMER_NOT_AVAILABLE",
          "Customer details changed while the membership link was verified.",
        );
      }

      const updated = await tx.customer.update({
        where: { id: current.id },
        data: { membershipIdentityId: parsed.membershipIdentityId },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: parsed.membershipIdentityId
            ? "CUSTOMER_MEMBERSHIP_LINKED"
            : "CUSTOMER_MEMBERSHIP_UNLINKED",
          entityType: "Customer",
          entityId: customer.id,
          beforeData: {
            membershipIdentityId: current.membershipIdentityId,
          },
          afterData: {
            membershipIdentityId: updated.membershipIdentityId,
            membershipTier: membership?.tier ?? null,
            membershipStatus: membership?.status ?? null,
          },
        },
      });
      return updated;
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new BusinessError(
        "MEMBERSHIP_IDENTITY_ALREADY_LINKED",
        "That modern-trade customer is already linked to another Lite customer.",
      );
    }
    throw error;
  }
}

export type SkuReconciliationReport = {
  generatedAt: string;
  currency: string;
  missingInModern: Array<{ sku: string; productId: string }>;
  missingInLite: Array<{ sku: string; productReference: string }>;
  duplicateSkuMappings: Array<{
    sku: string;
    liteProductIds: string[];
    modernProductReferences: string[];
  }>;
  regularPriceMismatches: Array<{
    sku: string;
    liteRegularPrice: string;
    modernRegularPrice: string;
  }>;
  inactiveProducts: Array<{
    sku: string;
    liteActive: boolean | null;
    modernActive: boolean | null;
  }>;
  memberPricingIneligible: Array<{
    sku: string;
    reasons: string[];
  }>;
};

export function reconcilePricingCatalog(
  liteProducts: Array<{
    id: string;
    sku: string;
    sellingPrice: string;
    active: boolean;
  }>,
  modernCatalog: PricingCatalog,
): SkuReconciliationReport {
  const liteBySku = new Map<string, typeof liteProducts>();
  const modernBySku = new Map<string, PricingCatalog["products"]>();
  for (const product of liteProducts) {
    const rows = liteBySku.get(product.sku) ?? [];
    rows.push(product);
    liteBySku.set(product.sku, rows);
  }
  for (const product of modernCatalog.products) {
    const rows = modernBySku.get(product.sku) ?? [];
    rows.push(product);
    modernBySku.set(product.sku, rows);
  }

  const missingInModern: SkuReconciliationReport["missingInModern"] = [];
  const missingInLite: SkuReconciliationReport["missingInLite"] = [];
  const duplicateSkuMappings: SkuReconciliationReport["duplicateSkuMappings"] =
    [];
  const regularPriceMismatches: SkuReconciliationReport["regularPriceMismatches"] =
    [];
  const inactiveProducts: SkuReconciliationReport["inactiveProducts"] = [];
  const memberPricingIneligible: SkuReconciliationReport["memberPricingIneligible"] =
    [];
  const allSkus = new Set([...liteBySku.keys(), ...modernBySku.keys()]);

  for (const sku of allSkus) {
    const liteRows = liteBySku.get(sku) ?? [];
    const modernRows = modernBySku.get(sku) ?? [];
    if (!modernRows.length) {
      missingInModern.push(
        ...liteRows.map(({ id }) => ({ sku, productId: id })),
      );
    }
    if (!liteRows.length) {
      missingInLite.push(
        ...modernRows.map(({ productReference }) => ({
          sku,
          productReference,
        })),
      );
    }
    if (liteRows.length > 1 || modernRows.length > 1) {
      duplicateSkuMappings.push({
        sku,
        liteProductIds: liteRows.map(({ id }) => id),
        modernProductReferences: modernRows.map(
          ({ productReference }) => productReference,
        ),
      });
    }
    if (liteRows.length === 1 && modernRows.length === 1) {
      const local = liteRows[0];
      const remote = modernRows[0];
      if (
        remote.regularUnitPrice &&
        !new Prisma.Decimal(local.sellingPrice).equals(remote.regularUnitPrice)
      ) {
        regularPriceMismatches.push({
          sku,
          liteRegularPrice: new Prisma.Decimal(local.sellingPrice).toFixed(2),
          modernRegularPrice: remote.regularUnitPrice,
        });
      }
      if (!local.active || !remote.active) {
        inactiveProducts.push({
          sku,
          liteActive: local.active,
          modernActive: remote.active,
        });
      }
      if (!remote.memberPricingEligible) {
        memberPricingIneligible.push({
          sku,
          reasons: remote.ineligibilityReasons,
        });
      }
    } else {
      for (const local of liteRows) {
        if (!local.active) {
          inactiveProducts.push({
            sku,
            liteActive: false,
            modernActive: null,
          });
        }
      }
      for (const remote of modernRows) {
        if (!remote.active) {
          inactiveProducts.push({
            sku,
            liteActive: null,
            modernActive: false,
          });
        }
        if (!remote.memberPricingEligible) {
          memberPricingIneligible.push({
            sku,
            reasons: remote.ineligibilityReasons,
          });
        }
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    currency: modernCatalog.currency,
    missingInModern,
    missingInLite,
    duplicateSkuMappings,
    regularPriceMismatches,
    inactiveProducts,
    memberPricingIneligible,
  };
}

export async function getSkuReconciliationReport(actor: SessionUser) {
  assertRole(actor.role, [Role.OWNER_ADMIN]);
  const modernStoreReference = storeReference();
  const [liteProducts, modernCatalog] = await Promise.all([
    prisma.product.findMany({
      select: {
        id: true,
        sku: true,
        sellingPrice: true,
        active: true,
      },
      orderBy: { sku: "asc" },
    }),
    callPricingService(() => getClient().getCatalog(modernStoreReference)),
  ]);
  if (modernCatalog.storeReference !== modernStoreReference) {
    throw new BusinessError(
      "PRICING_RESPONSE_MISMATCH",
      "The pricing service returned a catalog for a different store.",
    );
  }
  return reconcilePricingCatalog(
    liteProducts.map((product) => ({
      ...product,
      sellingPrice: product.sellingPrice.toString(),
    })),
    modernCatalog,
  );
}
