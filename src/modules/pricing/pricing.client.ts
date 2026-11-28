import { randomUUID } from "node:crypto";
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
    readonly diagnostics?: {
      requestId: string;
      upstreamStatus?: number;
      durationMs: number;
    },
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
  requestId?: string;
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
    this.timeoutMs = config.requestTimeoutMs ?? 70_000;
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const requestId = this.config.requestId ?? randomUUID();
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, this.baseUrl), {
        ...init,
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          "x-request-id": requestId,
          authorization: `Bearer ${this.config.serviceToken}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const timedOut =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      const code = timedOut
        ? "PRICING_SERVICE_TIMEOUT"
        : "PRICING_SERVICE_CONNECTION_FAILED";
      const networkErrorName =
        error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(error.name)
          ? error.name
          : "UnknownError";
      const rawNetworkCode =
        error && typeof error === "object" && "code" in error
          ? (error as { code?: unknown }).code
          : undefined;
      const networkErrorCode =
        typeof rawNetworkCode === "string" &&
        /^[A-Z0-9_]{1,40}$/.test(rawNetworkCode)
          ? rawNetworkCode
          : undefined;
      console.error(
        JSON.stringify({
          event: "pricing_upstream_failure",
          requestId,
          operation: path.split("?")[0],
          errorCategory: code,
          networkErrorName,
          ...(networkErrorCode ? { networkErrorCode } : {}),
          durationMs,
        }),
      );
      throw new PricingServiceClientError(
        code,
        timedOut
          ? "The authoritative pricing service did not respond before the request timed out."
          : "The authoritative pricing service could not be reached.",
        { requestId, durationMs },
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      const durationMs = Date.now() - startedAt;
      const code = !response.ok && response.status >= 500
        ? "PRICING_SERVICE_UNAVAILABLE"
        : "PRICING_RESPONSE_INVALID";
      console.error(
        JSON.stringify({
          event: "pricing_upstream_failure",
          requestId,
          operation: path.split("?")[0],
          upstreamStatus: response.status,
          errorCategory: code,
          durationMs,
        }),
      );
      throw new PricingServiceClientError(
        code,
        "The authoritative pricing service returned an invalid response.",
        { requestId, upstreamStatus: response.status, durationMs },
      );
    }

    if (!response.ok) {
      const error =
        body && typeof body === "object"
          ? (body as { code?: unknown }).code
          : undefined;
      const upstreamCode =
        typeof error === "string" && /^[A-Z][A-Z0-9_]{1,64}$/.test(error)
          ? error
          : "PRICING_REQUEST_REJECTED";
      if (response.status === 401 || response.status === 403) {
        const durationMs = Date.now() - startedAt;
        console.error(
          JSON.stringify({
            event: "pricing_upstream_failure",
            requestId,
            operation: path.split("?")[0],
            upstreamStatus: response.status,
            errorCategory: "PRICING_SERVICE_AUTH_FAILED",
            durationMs,
          }),
        );
        throw new PricingServiceClientError(
          "PRICING_SERVICE_AUTH_FAILED",
          "The authoritative pricing service rejected service authentication.",
          { requestId, upstreamStatus: response.status, durationMs },
        );
      }
      if (response.status >= 500) {
        const durationMs = Date.now() - startedAt;
        console.error(
          JSON.stringify({
            event: "pricing_upstream_failure",
            requestId,
            operation: path.split("?")[0],
            upstreamStatus: response.status,
            errorCategory: "PRICING_SERVICE_UNAVAILABLE",
            durationMs,
          }),
        );
        throw new PricingServiceClientError(
          "PRICING_SERVICE_UNAVAILABLE",
          "The authoritative pricing service could not complete the request.",
          { requestId, upstreamStatus: response.status, durationMs },
        );
      }
      const durationMs = Date.now() - startedAt;
      console.error(
        JSON.stringify({
          event: "pricing_upstream_failure",
          requestId,
          operation: path.split("?")[0],
          upstreamStatus: response.status,
          errorCategory: upstreamCode,
          durationMs,
        }),
      );
      throw new PricingServiceClientError(
        upstreamCode,
        "The authoritative pricing service rejected the request.",
        { requestId, upstreamStatus: response.status, durationMs },
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
