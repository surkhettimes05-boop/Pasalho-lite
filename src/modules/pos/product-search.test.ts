import { describe, expect, it } from "vitest";
import { createPosProductSearchIndex } from "@/modules/pos/product-search";

describe("POS product search index", () => {
  it("resolves exact SKUs and barcodes case-insensitively", () => {
    const index = createPosProductSearchIndex([
      { id: "one", sku: "SKU-ONE", name: "Rice", barcode: "0890123" },
    ]);

    expect(index.findExact(" sku-one ")?.id).toBe("one");
    expect(index.findExact("0890123")?.id).toBe("one");
  });

  it("does not guess when one product's SKU collides with another barcode", () => {
    const index = createPosProductSearchIndex([
      { id: "one", sku: "SKU-ONE", name: "Rice", barcode: "0890123" },
      { id: "two", sku: "0890123", name: "Oil", barcode: "0890999" },
    ]);

    expect(index.findExact("0890123")).toBeNull();
  });
});
