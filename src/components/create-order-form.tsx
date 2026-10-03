"use client";

import { useMemo, useState } from "react";

type ProductOption = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
  sellingPrice: string;
  available: string;
};

type CustomerSelection = {
  id: string;
  phoneDisplay: string;
  phoneNormalized: string;
  name: string | null;
  active: boolean;
  pointBalance: number;
  spendRemainder: string;
};

type CustomerResult =
  | { ok: true; customer: CustomerSelection }
  | { ok: false; code: string };

type Line = {
  key: string;
  productKey: string;
  quantity: string;
};

function newLine(): Line {
  return {
    key: crypto.randomUUID(),
    productKey: "",
    quantity: "1",
  };
}

export function CreateOrderForm({
  products,
  idempotencyKey,
  action,
  lookupCustomer,
  createCustomer,
}: {
  products: ProductOption[];
  idempotencyKey: string;
  action: (formData: FormData) => void | Promise<void>;
  lookupCustomer: (phone: string) => Promise<CustomerResult>;
  createCustomer: (input: { phone: string; name: string }) => Promise<CustomerResult>;
}) {
  const [lines, setLines] = useState<Line[]>([{ key: "initial", productKey: "", quantity: "1" }]);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [customer, setCustomer] = useState<CustomerSelection | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const productByKey = useMemo(() => {
    const map = new Map<string, ProductOption>();
    for (const product of products) {
      map.set(product.sku.trim().toUpperCase(), product);
      if (product.barcode) map.set(product.barcode.trim(), product);
    }
    return map;
  }, [products]);
  const duplicateSkus = useMemo(() => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const line of lines) {
      const raw = line.productKey.trim();
      const product = productByKey.get(raw.toUpperCase()) ?? productByKey.get(raw);
      if (!product) continue;
      if (seen.has(product.id)) duplicates.add(product.sku);
      seen.add(product.id);
    }
    return duplicates;
  }, [lines, productByKey]);

  function selectedProduct(line: Line) {
    const raw = line.productKey.trim();
    return productByKey.get(raw.toUpperCase()) ?? productByKey.get(raw) ?? null;
  }

  async function lookup() {
    if (!phone.trim()) {
      setMessage("Enter a customer phone.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await lookupCustomer(phone);
      if (result.ok) {
        setCustomer(result.customer);
        setMessage("Customer selected.");
      } else if (result.code === "CUSTOMER_NOT_FOUND") {
        setCustomer(null);
        setMessage("Customer not found. Create them below.");
      } else {
        setMessage("Check the phone and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!phone.trim()) return;
    setBusy(true);
    try {
      const result = await createCustomer({ phone, name });
      if (result.ok) {
        setCustomer(result.customer);
        setName("");
        setMessage("Customer created and selected.");
      } else {
        setMessage("Customer could not be created.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={action} className="receive-form">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="customerId" value={customer?.id ?? ""} />
      <input type="hidden" name="lineCount" value={lines.length} />

      <div className="order-customer-section">
        <div>
          <p className="eyebrow">Customer</p>
          <h3>Phone order identity</h3>
        </div>
        {customer ? (
          <div className="customer-selected-card">
            <div>
              <strong>{customer.name ?? customer.phoneDisplay}</strong>
              <small>{customer.phoneDisplay}</small>
            </div>
            <div>
              <strong>{customer.pointBalance} point(s)</strong>
              <small>Rs {customer.spendRemainder} remainder</small>
            </div>
            <button
              className="link-button"
              type="button"
              onClick={() => {
                setCustomer(null);
                setMessage("");
              }}
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <div className="customer-lookup-row">
              <input aria-label="Customer phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="98XXXXXXXX"
              />
              <button className="secondary-light-button" type="button" onClick={lookup} disabled={busy}>
                Lookup
              </button>
            </div>
            {message.includes("not found") ? (
              <div className="customer-create-row">
                <input aria-label="Customer name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Name (optional)"
                />
                <button className="secondary-light-button" type="button" onClick={create} disabled={busy}>
                  Create customer
                </button>
              </div>
            ) : null}
          </>
        )}
        {message ? <small className="customer-message">{message}</small> : null}
      </div>

      <div className="form-grid">
        <label className="span-2">
          Delivery address
          <input name="addressText" required maxLength={500} placeholder="Full delivery address" />
        </label>
        <label>
          Delivery charge
          <input name="deliveryCharge" defaultValue="0" inputMode="decimal" required />
        </label>
        <label>
          Notes
          <input name="notes" maxLength={500} placeholder="Optional order note" />
        </label>
      </div>

      <div className="receipt-lines">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Items</p>
            <h3>Order lines</h3>
          </div>
          <button
            className="secondary-light-button"
            type="button"
            onClick={() => setLines((current) => [...current, newLine()])}
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
                    list="order-products"
                    value={line.productKey}
                    onChange={(event) =>
                      setLines((current) =>
                        current.map((item) =>
                          item.key === line.key
                            ? { ...item, productKey: event.target.value }
                            : item,
                        ),
                      )
                    }
                    placeholder="Type or scan SKU / barcode"
                    required
                  />
                </label>
                <input type="hidden" name={`productId_${index}`} value={product?.id ?? ""} />
                <small>
                  {product
                    ? `${product.name} · Rs ${product.sellingPrice} · ${product.available} ${product.unit} available now`
                    : "Choose an active store SKU."}
                </small>
                {product && duplicateSkus.has(product.sku) ? <small className="error-message">{product.sku} is already in this order. Change its quantity instead.</small> : null}
              </div>

              <label>
                Quantity
                <input
                  name={`quantity_${index}`}
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((item) =>
                        item.key === line.key
                          ? { ...item, quantity: event.target.value }
                          : item,
                      ),
                    )
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

      <datalist id="order-products">
        {products.flatMap((product) => {
          const options = [
            <option key={`${product.id}-sku`} value={product.sku}>
              {product.name}
            </option>,
          ];
          if (product.barcode) {
            options.push(
              <option key={`${product.id}-barcode`} value={product.barcode}>
                {product.sku} — {product.name}
              </option>,
            );
          }
          return options;
        })}
      </datalist>

      <div className="receive-submit">
        <p className="muted">
          NEW orders do not reserve or deduct stock. Product prices and totals
          are recalculated by the server when the order is created.
        </p>
        {!customer ? <p className="muted">Select or create a customer before creating this COD order.</p> : null}
        <button className="primary-button" type="submit" disabled={!customer || duplicateSkus.size > 0 || busy}>
          Create COD order
        </button>
      </div>
    </form>
  );
}
