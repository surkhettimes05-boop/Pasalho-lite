"use client";

import { useMemo, useState } from "react";

type ProductOption = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
  warehouseAvailable: string;
};

type TransferLine = {
  key: string;
  productKey: string;
  quantity: string;
};

function addedLine(): TransferLine {
  return {
    key: crypto.randomUUID(),
    productKey: "",
    quantity: "1",
  };
}

export function CreateTransferForm({
  products,
  action,
}: {
  products: ProductOption[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [lines, setLines] = useState<TransferLine[]>([
    {
      key: "initial-line",
      productKey: "",
      quantity: "1",
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

  function selectedProduct(line: TransferLine) {
    const raw = line.productKey.trim();

    return (
      productByKey.get(raw.toUpperCase()) ??
      productByKey.get(raw) ??
      null
    );
  }

  function updateLine(
    key: string,
    field: "productKey" | "quantity",
    nextValue: string,
  ) {
    setLines((current) =>
      current.map((line) =>
        line.key === key ? { ...line, [field]: nextValue } : line,
      ),
    );
  }

  return (
    <form action={action} className="receive-form">
      <input type="hidden" name="lineCount" value={lines.length} />

      <div className="form-grid">
        <label className="span-2">
          Notes
          <input
            name="notes"
            placeholder="Optional transfer note"
            maxLength={500}
          />
        </label>
      </div>

      <div className="receipt-lines">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Requested stock</p>
            <h3>Warehouse → Store items</h3>
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
            <div className="transfer-create-line" key={line.key}>
              <div className="receipt-product-field">
                <label>
                  Product {index + 1}
                  <input
                    list="transfer-products"
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
                    ? `${product.name} · warehouse available ${product.warehouseAvailable} ${product.unit}`
                    : "Choose an active catalog SKU."}
                </small>
              </div>

              <label>
                Requested quantity
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

              <button
                className="link-button danger-link"
                type="button"
                disabled={lines.length === 1}
                onClick={() =>
                  setLines((current) =>
                    current.length === 1
                      ? current
                      : current.filter((item) => item.key !== line.key),
                  )
                }
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>

      <datalist id="transfer-products">
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
          Creating a draft does not move stock. Warehouse stock changes only
          when a READY transfer is explicitly dispatched.
        </p>
        <button className="primary-button" type="submit">
          Create draft transfer
        </button>
      </div>
    </form>
  );
}
