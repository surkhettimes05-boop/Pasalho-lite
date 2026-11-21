import { config } from "dotenv";

config({ path: ".env.test", override: false });
config({ path: ".env", override: false });

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL is required. Use a dedicated test database, never the development or production database.",
  );
}

process.env.APP_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.ENABLE_REAL_CUSTOMER_ORDERS ??= "true";

process.env.MODERN_PRICING_API_URL ??= "http://modern-pricing.test";
process.env.MODERN_PRICING_SERVICE_TOKEN ??=
  "lite-integration-test-service-token-that-is-not-production";
process.env.MODERN_PRICING_STORE_REFERENCE ??=
  "3d1868fc-042c-4c7a-9b9b-fc615e31e3e1";
