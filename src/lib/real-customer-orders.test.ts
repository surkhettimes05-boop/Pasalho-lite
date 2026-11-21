import { describe, expect, it } from "vitest";
import { realCustomerOrdersEnabled } from "./real-customer-orders";

describe("real customer order release gate", () => {
  it("blocks production order creation unless explicitly enabled", () => {
    expect(realCustomerOrdersEnabled({ APP_ENV: "production" })).toBe(false);
    expect(realCustomerOrdersEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(
      realCustomerOrdersEnabled({
        APP_ENV: "development",
        NODE_ENV: "production",
      }),
    ).toBe(false);
    expect(
      realCustomerOrdersEnabled({
        APP_ENV: "production",
        ENABLE_REAL_CUSTOMER_ORDERS: "false",
      }),
    ).toBe(false);
    expect(
      realCustomerOrdersEnabled({
        APP_ENV: "production",
        ENABLE_REAL_CUSTOMER_ORDERS: "true",
      }),
    ).toBe(true);
  });

  it("keeps non-production acceptance flows available", () => {
    expect(realCustomerOrdersEnabled({ APP_ENV: "test" })).toBe(true);
    expect(realCustomerOrdersEnabled({ APP_ENV: "staging" })).toBe(true);
  });
});
