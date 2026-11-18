import { describe, expect, it } from "vitest";
import type { PricingCatalog } from "./pricing.schemas";
import { reconcilePricingCatalog } from "./pricing.service";

const reference = (tail: string) => `00000000-0000-4000-8000-0000000000${tail}`;

describe("SKU reconciliation", () => {
  it("reports exact-SKU gaps, duplicates, price/activity differences, and ineligibility", () => {
    const report = reconcilePricingCatalog(
      [
        {
          id: reference("01"),
          sku: "DUP",
          sellingPrice: "10.00",
          active: true,
        },
        {
          id: reference("02"),
          sku: "DUP",
          sellingPrice: "10.00",
          active: true,
        },
        {
          id: reference("03"),
          sku: "PRICE",
          sellingPrice: "10.00",
          active: true,
        },
        {
          id: reference("04"),
          sku: "INACTIVE",
          sellingPrice: "5.00",
          active: false,
        },
        {
          id: reference("05"),
          sku: "INELIGIBLE",
          sellingPrice: "6.00",
          active: true,
        },
        {
          id: reference("06"),
          sku: "LITE-ONLY",
          sellingPrice: "2.00",
          active: true,
        },
      ],
      {
        storeReference: reference("20"),
        currency: "NPR",
        products: [
          {
            productReference: reference("11"),
            sku: "DUP",
            active: true,
            regularUnitPrice: "10.00",
            currency: "NPR",
            memberPricingEligible: true,
            ineligibilityReasons: [],
          },
          {
            productReference: reference("12"),
            sku: "DUP",
            active: true,
            regularUnitPrice: "10.00",
            currency: "NPR",
            memberPricingEligible: true,
            ineligibilityReasons: [],
          },
          {
            productReference: reference("13"),
            sku: "PRICE",
            active: true,
            regularUnitPrice: "11.00",
            currency: "NPR",
            memberPricingEligible: true,
            ineligibilityReasons: [],
          },
          {
            productReference: reference("14"),
            sku: "INACTIVE",
            active: false,
            regularUnitPrice: "5.00",
            currency: "NPR",
            memberPricingEligible: true,
            ineligibilityReasons: [],
          },
          {
            productReference: reference("15"),
            sku: "INELIGIBLE",
            active: true,
            regularUnitPrice: "6.00",
            currency: "NPR",
            memberPricingEligible: false,
            ineligibilityReasons: ["NO_ACTIVE_PRICE"],
          },
          {
            productReference: reference("16"),
            sku: "MODERN-ONLY",
            active: true,
            regularUnitPrice: "4.00",
            currency: "NPR",
            memberPricingEligible: true,
            ineligibilityReasons: [],
          },
        ],
      } satisfies PricingCatalog,
    );

    expect(report.missingInModern).toMatchObject([{ sku: "LITE-ONLY" }]);
    expect(report.missingInLite).toMatchObject([{ sku: "MODERN-ONLY" }]);
    expect(report.duplicateSkuMappings).toHaveLength(1);
    expect(report.duplicateSkuMappings[0].sku).toBe("DUP");
    expect(report.regularPriceMismatches).toEqual([
      {
        sku: "PRICE",
        liteRegularPrice: "10.00",
        modernRegularPrice: "11.00",
      },
    ]);
    expect(report.inactiveProducts.map((row) => row.sku)).toContain("INACTIVE");
    expect(report.memberPricingIneligible).toEqual([
      { sku: "INELIGIBLE", reasons: ["NO_ACTIVE_PRICE"] },
    ]);
  });
});
