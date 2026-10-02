"use client";

import { useMemo, useState } from "react";

type ProductOption = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
};

type SupplierOption = {
  id: string;
  name: string;
};

type ReceiptLine = {
  key: string;
  productKey: string;
  quantity: string;
  unitCost: string;
};

function addedLine(): ReceiptLine {
  return {
    key: crypto.randomUUID(),
    productKey: "",
    quantity: "1",
    unitCost: "0.00",
  };
}

export function ReceiveStockForm({
  suppliers,
  products,
  idempotencyKey,
  action,
}: {
  suppliers: SupplierOption[];
  products: ProductOption[];
  idempotencyKey: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [lines, setLines] = useState<ReceiptLine[]>([
    {
      key: "initial-line",
      productKey: "",
      quantity: "1",
      unitCost: "0.00",
    },
  ]);

  const productByKey = useMemo(() => {
    const map = new Map<string, ProductOption>();

    for (const product of products) {
      map.set(product.sku.trim().toUpperCase(), product);

      if (product.barcode) {
        map.set(product.barcode.trim(), product);
      }
    }

    return map;
  }, [products]);

  function updateLine(
    key: string,
    field: keyof Omit<ReceiptLine, "key">,
    nextValue: string,
  ) {
    setLines((current) =>
      current.map((line) =>
        line.key === key ? { ...line, [field]: nextValue } : line,
      ),
    );
  }

  function selectedProduct(line: ReceiptLine) {
    const raw = line.productKey.trim();

    return (
      productByKey.get(raw.toUpperCase()) ??
      productByKey.get(raw) ??
      null
    );
  }

  return (
    <form action={action} className="receive-form">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="lineCount" value={lines.length} />

      <div className="form-grid">
        <label>
          Supplier
          <select name="supplierId" required defaultValue="">
            <option value="" disabled>
              Select supplier
            </option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Supplier reference
          <input
            name="supplierReference"
            placeholder="Invoice / challan number (optional)"
          />
        </label>

        <label className="span-2">
          Notes
          <input name="notes" placeholder="Optional receiving note" />
        </label>
      </div>

      <div className="receipt-lines">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Items</p>
            <h3>Received products</h3>
          </div>
          <button
            className="secondary-light-button"
            type="button"
            onClick={() => setLines((current) => [...current, addedLine()])}
            disabled={lines.length >= 100}
          >
            Add line
          </button>
        </div>

        {lines.map((line, index) => {
          const product = selectedProduct(line);

          return (
            <div className="receipt-line" key={line.key}>
              <div className="receipt-product-field">
                <label>
                  Product {index + 1}
                  <input
                    list="receiving-products"
                    value={line.productKey}
                    onChange={(event) =>
                      updateLine(line.key, "productKey", event.target.value)
                    }
                    placeholder="Type or scan SKU / barcode"
                    required
                  />
                </label>
                <input
                  type="hidden"
                  name={`productId_${index}`}
                  value={product?.id ?? ""}
                />
                <small>
                  {product
                    ? `${product.name} · ${product.unit}`
                    : "Choose a catalog SKU or scan a known barcode."}
                </small>
              </div>

              <label>
                Quantity
                <input
                  name={`quantity_${index}`}
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(event) =>
                    updateLine(line.key, "quantity", event.target.value)
                  }
                  required
                />
              </label>

              <label>
                Unit cost (NPR)
                <input
                  name={`unitCost_${index}`}
                  inputMode="decimal"
                  value={line.unitCost}
                  onChange={(event) =>
                    updateLine(line.key, "unitCost", event.target.value)
                  }
                  required
                />
              </label>

              <button
                className="link-button danger-link"
                type="button"
                onClick={() =>
                  setLines((current) =>
                    current.length === 1
                      ? current
                      : current.filter((item) => item.key !== line.key),
                  )
                }
                disabled={lines.length === 1}
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>

      <datalist id="receiving-products">
        {products.flatMap((product) => {
          const options = [
            <option key={`${product.id}-sku`} value={product.sku}>
              {product.name}
            </option>,
          ];

          if (product.barcode) {
            options.push(
              <option
                key={`${product.id}-barcode`}
                value={product.barcode}
              >
                {product.sku} — {product.name}
              </option>,
            );
          }

          return options;
        })}
      </datalist>

      <div className="receive-submit">
        <p className="muted">
          Posting records the current server time and immediately adds the
          received quantity to central warehouse stock.
        </p>
        <button className="primary-button" type="submit">
          Post receipt
        </button>
      </div>
    </form>
  );
}
