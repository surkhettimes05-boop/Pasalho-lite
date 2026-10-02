"use client";

import { useMemo, useState } from "react";

type PosPaymentMethod = "CASH" | "QR_NON_CASH";

type PosProduct = {
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

type CustomerActionResult =
  | { ok: true; customer: CustomerSelection }
  | { ok: false; code: string };

type CartLine = {
  productId: string;
  quantity: string;
};

function normalized(value: string) {
  return value.trim().toLowerCase();
}

export function PosRegister({
  products,
  idempotencyKey,
  action,
  lookupCustomer,
  createCustomer,
}: {
  products: PosProduct[];
  idempotencyKey: string;
  action: (formData: FormData) => void | Promise<void>;
  lookupCustomer: (phone: string) => Promise<CustomerActionResult>;
  createCustomer: (input: {
    phone: string;
    name: string;
  }) => Promise<CustomerActionResult>;
}) {
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>("CASH");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [selectedCustomer, setSelectedCustomer] =
    useState<CustomerSelection | null>(null);
  const [customerMessage, setCustomerMessage] = useState("");
  const [customerBusy, setCustomerBusy] = useState(false);

  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  const matches = useMemo(() => {
    const q = normalized(query);

    if (!q) {
      return products.slice(0, 20);
    }

    return products
      .filter((product) => {
        return (
          product.sku.toLowerCase().includes(q) ||
          product.name.toLowerCase().includes(q) ||
          product.barcode?.toLowerCase().includes(q)
        );
      })
      .slice(0, 20);
  }, [products, query]);

  const subtotal = cart.reduce((sum, line) => {
    const product = productById.get(line.productId);

    if (!product) {
      return sum;
    }

    return sum + Number(product.sellingPrice) * Number(line.quantity || 0);
  }, 0);

  async function handleCustomerLookup() {
    if (!customerPhone.trim()) {
      setCustomerMessage("Enter a phone number.");
      return;
    }

    setCustomerBusy(true);
    setCustomerMessage("");

    try {
      const result = await lookupCustomer(customerPhone);

      if (result.ok) {
        setSelectedCustomer(result.customer);
        setCustomerMessage("Customer selected.");
      } else if (result.code === "CUSTOMER_NOT_FOUND") {
        setSelectedCustomer(null);
        setCustomerMessage("Customer not found. You can create them below.");
      } else {
        setSelectedCustomer(null);
        setCustomerMessage("Check the phone number and try again.");
      }
    } finally {
      setCustomerBusy(false);
    }
  }

  async function handleCustomerCreate() {
    if (!customerPhone.trim()) {
      setCustomerMessage("Enter a phone number first.");
      return;
    }

    setCustomerBusy(true);
    setCustomerMessage("");

    try {
      const result = await createCustomer({
        phone: customerPhone,
        name: customerName,
      });

      if (result.ok) {
        setSelectedCustomer(result.customer);
        setCustomerName("");
        setCustomerMessage("Customer created and selected.");
      } else {
        setCustomerMessage("Customer could not be created.");
      }
    } finally {
      setCustomerBusy(false);
    }
  }

  function clearCustomer() {
    setSelectedCustomer(null);
    setCustomerPhone("");
    setCustomerName("");
    setCustomerMessage("");
  }

  function addProduct(product: PosProduct) {
    if (Number(product.available) <= 0) {
      return;
    }

    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id);

      if (existing) {
        return current.map((line) =>
          line.productId === product.id
            ? {
                ...line,
                quantity: String(Number(line.quantity || 0) + 1),
              }
            : line,
        );
      }

      return [...current, { productId: product.id, quantity: "1" }];
    });

    setQuery("");
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = normalized(query);

    if (!q) {
      return;
    }

    const exact = products.find(
      (product) =>
        normalized(product.barcode ?? "") === q ||
        normalized(product.sku) === q,
    );

    if (exact) {
      addProduct(exact);
      return;
    }

    if (matches.length === 1) {
      addProduct(matches[0]);
    }
  }

  function changeQuantity(productId: string, nextQuantity: string) {
    setCart((current) =>
      current.map((line) =>
        line.productId === productId
          ? { ...line, quantity: nextQuantity }
          : line,
      ),
    );
  }

  function removeProduct(productId: string) {
    setCart((current) =>
      current.filter((line) => line.productId !== productId),
    );
  }

  return (
    <div className="pos-layout">
      <section className="panel pos-catalog-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Scan / search</p>
            <h3>Add product</h3>
            <p className="muted">
              Scanner input can be submitted as barcode or SKU. Prices shown
              here are informational; the server recalculates every sale.
            </p>
          </div>
        </div>

        <form className="pos-search" onSubmit={submitSearch}>
          <input
            autoFocus
            aria-label="Scan barcode or search products"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Scan barcode, enter SKU, or search product"
          />
          <button className="secondary-light-button" type="submit">
            Add exact match
          </button>
        </form>

        <div className="pos-product-results">
          {matches.length === 0 ? (
            <p className="muted">No matching active products.</p>
          ) : (
            matches.map((product) => (
              <button
                className="pos-product-card"
                type="button"
                key={product.id}
                onClick={() => addProduct(product)}
                disabled={Number(product.available) <= 0}
              >
                <span>
                  <strong>{product.name}</strong>
                  <small>
                    {product.sku}
                    {product.barcode ? ` · ${product.barcode}` : ""}
                  </small>
                </span>
                <span className="pos-product-price">
                  Rs {product.sellingPrice}
                  <small>
                    {product.available} {product.unit} available
                  </small>
                </span>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="panel pos-cart-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Current sale</p>
            <h3>Cart</h3>
          </div>
          <span className="status-badge">{cart.length} SKU(s)</span>
        </div>

        <div className="pos-customer-box">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Customer / loyalty</p>
              <h3>{selectedCustomer ? "Customer selected" : "Optional customer"}</h3>
            </div>
            {selectedCustomer ? (
              <button className="link-button" type="button" onClick={clearCustomer}>
                Clear
              </button>
            ) : null}
          </div>

          {selectedCustomer ? (
            <div className="customer-selected-card">
              <div>
                <strong>{selectedCustomer.name ?? selectedCustomer.phoneDisplay}</strong>
                <small>{selectedCustomer.phoneDisplay}</small>
              </div>
              <div>
                <strong>{selectedCustomer.pointBalance} point(s)</strong>
                <small>
                  Rs {selectedCustomer.spendRemainder} carried toward next point
                </small>
              </div>
            </div>
          ) : (
            <>
              <div className="customer-lookup-row">
                <input
                  value={customerPhone}
                  onChange={(event) => setCustomerPhone(event.target.value)}
                  placeholder="Customer phone"
                />
                <button
                  className="secondary-light-button"
                  type="button"
                  onClick={handleCustomerLookup}
                  disabled={customerBusy}
                >
                  Lookup
                </button>
              </div>
              {customerMessage.includes("not found") ? (
                <div className="customer-create-row">
                  <input
                    value={customerName}
                    onChange={(event) => setCustomerName(event.target.value)}
                    placeholder="Name (optional)"
                  />
                  <button
                    className="secondary-light-button"
                    type="button"
                    onClick={handleCustomerCreate}
                    disabled={customerBusy}
                  >
                    Create customer
                  </button>
                </div>
              ) : null}
            </>
          )}

          {customerMessage ? (
            <small className="customer-message">{customerMessage}</small>
          ) : null}
        </div>

        {cart.length === 0 ? (
          <div className="empty-state">
            <h3>Cart is empty</h3>
            <p className="muted">Scan a barcode or select a product.</p>
          </div>
        ) : (
          <form action={action} className="pos-checkout">
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
            <input type="hidden" name="lineCount" value={cart.length} />
            <input
              type="hidden"
              name="customerId"
              value={selectedCustomer?.id ?? ""}
            />

            <div className="pos-cart-lines">
              {cart.map((line, index) => {
                const product = productById.get(line.productId);

                if (!product) {
                  return null;
                }

                const lineTotal =
                  Number(product.sellingPrice) * Number(line.quantity || 0);

                return (
                  <div className="pos-cart-line" key={line.productId}>
                    <input
                      type="hidden"
                      name={`productId_${index}`}
                      value={product.id}
                    />
                    <div>
                      <strong>{product.name}</strong>
                      <small>
                        {product.sku} · Rs {product.sellingPrice}/{product.unit}
                      </small>
                    </div>
                    <label>
                      Qty
                      <input
                        name={`quantity_${index}`}
                        inputMode="decimal"
                        value={line.quantity}
                        onChange={(event) =>
                          changeQuantity(product.id, event.target.value)
                        }
                        required
                      />
                    </label>
                    <strong>Rs {lineTotal.toFixed(2)}</strong>
                    <button
                      className="link-button danger-link"
                      type="button"
                      onClick={() => removeProduct(product.id)}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="pos-totals">
              <div>
                <span>Subtotal</span>
                <strong>Rs {subtotal.toFixed(2)}</strong>
              </div>
              <div>
                <span>Discount</span>
                <strong>Rs 0.00</strong>
              </div>
              <div className="pos-grand-total">
                <span>Total</span>
                <strong>Rs {subtotal.toFixed(2)}</strong>
              </div>
            </div>

            <fieldset className="payment-methods">
              <legend>Payment method</legend>
              <label>
                <input
                  type="radio"
                  name="paymentMethod"
                  value="CASH"
                  checked={paymentMethod === "CASH"}
                  onChange={() => setPaymentMethod("CASH")}
                />
                Cash
              </label>
              <label>
                <input
                  type="radio"
                  name="paymentMethod"
                  value="QR_NON_CASH"
                  checked={paymentMethod === "QR_NON_CASH"}
                  onChange={() => setPaymentMethod("QR_NON_CASH")}
                />
                QR / non-cash
              </label>
            </fieldset>

            <div className="pos-phase-note">
              {selectedCustomer
                ? "This finalized sale is eligible for cumulative loyalty earning."
                : "Anonymous sale: no loyalty will be earned."}
            </div>

            <button className="primary-button pos-finalize" type="submit">
              Finalize sale · Rs {subtotal.toFixed(2)}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
