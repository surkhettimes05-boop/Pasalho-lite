import {
  issuedPricingQuoteSchema,
  pricingCatalogSchema,
  validatedPricingQuoteSchema,
  verifiedMembershipCustomerSchema,
  type PricingCatalog,
  type PricingQuotePayload,
} from "@/modules/pricing/pricing.schemas";

export class PricingServiceClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PricingServiceClientError";
  }
}

export type PricingServiceConfig = {
  apiUrl: string;
  serviceToken: string;
  production: boolean;
  requestTimeoutMs?: number;
};

export class MemberPricingClient {
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: PricingServiceConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.baseUrl = new URL(config.apiUrl);
    if (
      this.baseUrl.username ||
      this.baseUrl.password ||
      this.baseUrl.pathname !== "/" ||
      this.baseUrl.search ||
      this.baseUrl.hash
    ) {
      throw new PricingServiceClientError(
        "PRICING_SERVICE_CONFIGURATION_INVALID",
        "The pricing service URL must be an origin without credentials or a path.",
      );
    }
    if (config.production && this.baseUrl.protocol !== "https:") {
      throw new PricingServiceClientError(
        "PRICING_SERVICE_HTTPS_REQUIRED",
        "The pricing service must use HTTPS in production.",
      );
    }
    this.timeoutMs = config.requestTimeoutMs ?? 5_000;
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, this.baseUrl), {
        ...init,
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          authorization: `Bearer ${this.config.serviceToken}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new PricingServiceClientError(
        "PRICING_SERVICE_UNAVAILABLE",
        "The authoritative pricing service could not be reached.",
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new PricingServiceClientError(
        "PRICING_RESPONSE_INVALID",
        "The authoritative pricing service returned an invalid response.",
      );
    }

    if (!response.ok) {
      const error =
        body && typeof body === "object"
          ? (body as { code?: unknown }).code
          : undefined;
      if (response.status === 401 || response.status === 403) {
        throw new PricingServiceClientError(
          "PRICING_SERVICE_AUTH_FAILED",
          "The authoritative pricing service rejected service authentication.",
        );
      }
      if (response.status >= 500) {
        throw new PricingServiceClientError(
          "PRICING_SERVICE_UNAVAILABLE",
          "The authoritative pricing service could not complete the request.",
        );
      }
      throw new PricingServiceClientError(
        typeof error === "string" ? error : "PRICING_REQUEST_REJECTED",
        "The authoritative pricing service rejected the request.",
      );
    }
    return body;
  }

  async createQuote(input: {
    channel: "POS" | "COD";
    storeReference: string;
    customerReference: string | null;
    customerPhoneReference: string | null;
    items: Array<{ sku: string; quantity: string }>;
  }) {
    const body = await this.request("/api/internal/member-pricing/quotes", {
      method: "POST",
      body: JSON.stringify(input),
    });
    const parsed = issuedPricingQuoteSchema.safeParse(body);
    if (!parsed.success) {
      throw new PricingServiceClientError(
        "PRICING_RESPONSE_INVALID",
        "The authoritative pricing service returned an invalid quote.",
      );
    }
    return parsed.data;
  }

  async validateQuote(input: {
    channel: "POS" | "COD";
    storeReference: string;
    customerReference: string | null;
    customerPhoneReference: string | null;
    items: Array<{ sku: string; quantity: string }>;
    saleReference: string;
    signedQuoteToken: string;
  }): Promise<PricingQuotePayload> {
    const body = await this.request(
      "/api/internal/member-pricing/quotes/validate",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
    const parsed = validatedPricingQuoteSchema.safeParse(body);
    if (!parsed.success) {
      throw new PricingServiceClientError(
        "PRICING_RESPONSE_INVALID",
        "The authoritative pricing service returned an invalid validation result.",
      );
    }
    return parsed.data.quote;
  }

  async verifyCustomer(input: {
    customerReference: string;
    customerPhoneReference: string;
    storeReference: string;
  }) {
    const body = await this.request(
      "/api/internal/member-pricing/customers/verify",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
    const parsed = verifiedMembershipCustomerSchema.safeParse(body);
    if (!parsed.success) {
      throw new PricingServiceClientError(
        "PRICING_RESPONSE_INVALID",
        "The authoritative pricing service returned an invalid customer result.",
      );
    }
    return parsed.data.customer;
  }

  async getCatalog(storeReference: string): Promise<PricingCatalog> {
    const url = new URL("/api/internal/member-pricing/catalog", this.baseUrl);
    url.searchParams.set("storeReference", storeReference);
    const body = await this.request(url.pathname + url.search, {
      method: "GET",
    });
    const parsed = pricingCatalogSchema.safeParse(body);
    if (!parsed.success) {
      throw new PricingServiceClientError(
        "PRICING_RESPONSE_INVALID",
        "The authoritative pricing service returned an invalid catalog.",
      );
    }
    return parsed.data;
  }
}
