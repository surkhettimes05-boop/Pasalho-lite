import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

const base: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:pass@db.internal:5432/pasalho",
  MODERN_PRICING_API_URL: "https://pricing.internal",
  MODERN_PRICING_SERVICE_TOKEN: "nonprod-pricing-token-7c12f09a6b1e4d3a",
  MODERN_PRICING_STORE_REFERENCE: "3d1868fc-042c-4c7a-9b9b-fc615e31e3e1",
  SESSION_TTL_HOURS: "12",
};

describe("production environment validation", () => {
  it("accepts hardened standalone production config with Modern Trade unavailable", () => {
    const standalone = { ...base };
    delete standalone.MODERN_PRICING_API_URL;
    delete standalone.MODERN_PRICING_SERVICE_TOKEN;
    delete standalone.MODERN_PRICING_STORE_REFERENCE;
    const parsed = parseEnv({
      ...standalone,
      APP_ENV: "production",
      APP_URL: "https://pasalho.example.com",
      AUTH_SECRET: "9Qf7kL2mN8rT4vX6zA1cD3eG5hJ7pS9uW2yB4nM6qR8tV1xZ",
    });
    expect(parsed.APP_ENV).toBe("production");
    expect(parsed.MODERN_PRICING_API_URL).toBeUndefined();
  });

  it("rejects non-HTTPS production APP_URL", () => {
    expect(() =>
      parseEnv({
        ...base,
        APP_ENV: "production",
        APP_URL: "http://pasalho.example.com",
        AUTH_SECRET: "x".repeat(64),
      }),
    ).toThrow(/HTTPS/);
  });

  it("rejects placeholder/weak production auth secret", () => {
    expect(() =>
      parseEnv({
        ...base,
        APP_ENV: "production",
        APP_URL: "https://pasalho.example.com",
        AUTH_SECRET: "replace-with-a-secret-that-is-long-enough-123456789",
      }),
    ).toThrow(/AUTH_SECRET/);
  });

  it("accepts hardened production configuration", () => {
    const parsed = parseEnv({
      ...base,
      APP_ENV: "production",
      APP_URL: "https://pasalho.example.com",
      AUTH_SECRET:
        "9Qf7kL2mN8rT4vX6zA1cD3eG5hJ7pS9uW2yB4nM6qR8tV1xZ",
    });

    expect(parsed.APP_ENV).toBe("production");
    expect(parsed.APP_URL).toBe("https://pasalho.example.com");
  });
});
