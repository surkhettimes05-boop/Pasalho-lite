"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { createPosProductSearchIndex } from "@/modules/pos/product-search";
import type { IssuedPricingQuote } from "@/modules/pricing/pricing.schemas";

type PosPaymentMethod = "CASH" | "QR_NON_CASH";

type PosProduct = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
  available: string;
};

type CustomerSelection = {
  id: string;
  phoneMasked: string;
  name: string | null;
  active: boolean;
  pointBalance: number;
  spendRemainder: string;
  membershipNumber: number | null;
  membershipTier: "REGISTERED_MEMBER" | "FOUNDING_1000" | null;
  membershipStatus: "ACTIVE" | "SUSPENDED" | "CANCELLED" | "NOT_MEMBER" | "EXTERNAL_UNVERIFIED";
};

type CustomerActionResult =
  | { ok: true; customer: CustomerSelection }
  | { ok: false; code: string };

type CartLine = {
  productId: string;
  quantity: string;
};

type QuoteActionResult =
  | { ok: true; quote: IssuedPricingQuote }
  | { ok: false; code: string };

function membershipTierLabel(tier: CustomerSelection["membershipTier"]) {
  if (tier === "FOUNDING_1000") return "Founding 1,000";
  if (tier === "REGISTERED_MEMBER") return "Registered member";
  return "No membership";
}

function membershipStatusLabel(
  status: CustomerSelection["membershipStatus"],
) {
  if (status === "NOT_MEMBER") return "not a member";
  if (status === "EXTERNAL_UNVERIFIED") return "external membership not verified; Lite regular price applies";
  return status.toLowerCase();
}

export function PosRegister({
  products,
  idempotencyKey,
  action,
  quotePricing,
  lookupCustomer,
  createCustomer,
}: {
  products: PosProduct[];
  idempotencyKey: string;
  action: (formData: FormData) => void | Promise<void>;
  quotePricing: (input: {
    customerId: string | null;
    items: CartLine[];
  }) => Promise<QuoteActionResult>;
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
  const [pricingBusy, setPricingBusy] = useState(false);
  const [pricingQuote, setPricingQuote] = useState<IssuedPricingQuote | null>(
    null,
  );
  const [pricingMessage, setPricingMessage] = useState("");
  const [quoteRevision, setQuoteRevision] = useState(0);

  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const productSearch = useMemo(() => createPosProductSearchIndex(products), [products]);
  const matches = useMemo(() => productSearch.search(query), [productSearch, query]);

  useEffect(() => {
    let cancelled = false;

    if (!cart.length) return;

    if (
      cart.some(
        (line) =>
          !/^\d+(?:\.\d{1,3})?$/.test(line.quantity.trim()) ||
          Number(line.quantity) <= 0,
      )
    ) {
      const timer = setTimeout(() => {
        if (!cancelled) setPricingMessage("INVALID_POS_INPUT");
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }

    const timer = setTimeout(() => {
      startTransition(async () => {
        setPricingBusy(true);
        try {
          const result = await quotePricing({
            customerId: selectedCustomer?.id ?? null,
            items: cart,
          });
          if (cancelled) return;
          if (!result.ok) {
            setPricingMessage(result.code);
            return;
          }
          if (Date.parse(result.quote.expiresAt) <= Date.now()) {
            setPricingMessage("QUOTE_EXPIRED");
            return;
          }

          setPricingQuote(result.quote);
          setSelectedCustomer((current) => {
            if (!current) return current;
            if (
              current.membershipNumber === result.quote.membershipNumber &&
              current.membershipTier === result.quote.membershipTier &&
              current.membershipStatus === result.quote.membershipStatus
            ) {
              return current;
            }
            return {
              ...current,
              membershipNumber: result.quote.membershipNumber,
              membershipTier: result.quote.membershipTier,
              membershipStatus: result.quote.membershipStatus,
            };
          });
        } catch {
          if (!cancelled) setPricingMessage("PRICING_SERVICE_UNAVAILABLE");
        } finally {
          if (!cancelled) setPricingBusy(false);
        }
      });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cart, selectedCustomer?.id, quoteRevision, quotePricing]);

  useEffect(() => {
    if (!pricingQuote) return;
    const delay = Date.parse(pricingQuote.expiresAt) - Date.now();
    const quoteId = pricingQuote.quoteId;
    const timer = setTimeout(() => {
      setPricingQuote((current) =>
        current?.quoteId === quoteId ? null : current,
      );
      setPricingMessage("QUOTE_EXPIRED");
    }, Math.max(0, delay));
    return () => clearTimeout(timer);
  }, [pricingQuote]);

  async function handleCustomerLookup() {
    if (!customerPhone.trim()) {
      setCustomerMessage("Enter a phone number.");
      return;
    }

    setCustomerBusy(true);
    setPricingBusy(false);
    setCustomerMessage("");
    setPricingQuote(null);
    setPricingMessage("");

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
        setCustomerMessage(`Customer lookup failed (${result.code}).`);
      }
    } catch {
      setSelectedCustomer(null);
      setCustomerMessage("Customer lookup failed. Check the connection and retry.");
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
    setPricingBusy(false);
    setCustomerMessage("");
    setPricingQuote(null);
    setPricingMessage("");

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
        setCustomerMessage(`Customer could not be created (${result.code}).`);
      }
    } catch {
      setCustomerMessage("Customer creation failed. Check the connection and retry.");
    } finally {
      setCustomerBusy(false);
    }
  }

  function clearCustomer() {
    setSelectedCustomer(null);
    setCustomerPhone("");
    setCustomerName("");
    setCustomerMessage("");
    setPricingQuote(null);
    setPricingBusy(false);
    setPricingMessage("");
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
    setPricingQuote(null);
    setPricingBusy(false);
    setPricingMessage("");

    setQuery("");
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const exact = productSearch.findExact(query);

    if (exact) {
      addProduct(exact);
      return;
    }

    if (matches.length === 1) {
      addProduct(matches[0]);
    }
  }

  function changeQuantity(productId: string, nextQuantity: string) {
    setPricingQuote(null);
    setPricingBusy(false);
    setPricingMessage(
      /^\d+(?:\.\d{1,3})?$/.test(nextQuantity.trim()) &&
        Number(nextQuantity) > 0
        ? ""
        : "INVALID_POS_INPUT",
    );
    setCart((current) =>
      current.map((line) =>
        line.productId === productId
          ? { ...line, quantity: nextQuantity }
          : line,
      ),
    );
  }

  function removeProduct(productId: string) {
    setPricingQuote(null);
    setPricingBusy(false);
    setPricingMessage("");
    setCart((current) =>
      current.filter((line) => line.productId !== productId),
    );
  }

  function handlePricingQuote() {
    setPricingQuote(null);
    setPricingBusy(false);
    setPricingMessage("");
    setQuoteRevision((current) => current + 1);
  }

  const quoteReady = pricingQuote !== null && !pricingBusy;

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
        <p className="pos-keyboard-hint">
          Scanner tip: barcode or exact SKU + Enter adds the product immediately.
        </p>

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
                Remove customer
              </button>
            ) : null}
          </div>

          {selectedCustomer ? (
            <div className="customer-selected-card">
              <div>
                <strong>{selectedCustomer.name ?? "Customer"}</strong>
                <small>{selectedCustomer.phoneMasked}</small>
                <small>
                  {membershipTierLabel(selectedCustomer.membershipTier)}
                  {selectedCustomer.membershipNumber
                    ? ` · Membership #${selectedCustomer.membershipNumber}`
                    : ""}
                  {" · "}
                  {membershipStatusLabel(selectedCustomer.membershipStatus)}
                </small>
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
                  aria-label="Customer phone"
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
                    aria-label="Customer name"
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
          <form
            action={action}
            className="pos-checkout"
            onSubmit={(event) => {
              if (!pricingQuote || Date.parse(pricingQuote.expiresAt) <= Date.now()) {
                event.preventDefault();
                setPricingQuote(null);
                setPricingMessage("QUOTE_EXPIRED");
              }
            }}
          >
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
            <input type="hidden" name="lineCount" value={cart.length} />
            <input
              type="hidden"
              name="customerId"
              value={selectedCustomer?.id ?? ""}
            />
            <input
              type="hidden"
              name="signedQuoteToken"
              value={pricingQuote?.signedQuoteToken ?? ""}
            />

            <div className="pos-cart-lines">
              {cart.map((line, index) => {
                const product = productById.get(line.productId);

                if (!product) {
                  return null;
                }

                const quoteItem = pricingQuote?.items.find(
                  (item) => item.sku === product.sku,
                );

                return (
                  <div className="pos-cart-line" key={line.productId}>
                    <input
                      type="hidden"
                      name={`productId_${index}`}
                      value={product.id}
                    />
                    <div>
                      <strong>{product.name}</strong>
                      <small>{product.sku} · {product.unit}</small>
                      {quoteItem ? (
                        <small>
                          Regular Rs {quoteItem.regularUnitPrice} · Applied Rs{" "}
                          {quoteItem.appliedUnitPrice}
                        </small>
                      ) : null}
                      {quoteItem ? (
                        <small>Member saving Rs {quoteItem.lineDiscount}</small>
                      ) : null}
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
                    <strong>
                      {quoteItem ? `Rs ${quoteItem.lineTotal}` : "Not quoted"}
                    </strong>
                    {quoteItem?.promotionSnapshot ? (
                      <small>{quoteItem.promotionSnapshot.name}</small>
                    ) : null}
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
                <span>Regular subtotal</span>
                <strong>
                  {pricingQuote ? `Rs ${pricingQuote.subtotal}` : "—"}
                </strong>
              </div>
              <div>
                <span>Member discount</span>
                <strong>
                  {pricingQuote ? `Rs ${pricingQuote.discountTotal}` : "—"}
                </strong>
              </div>
              <div className="pos-grand-total">
                <span>Final payable</span>
                <strong>
                  {pricingQuote ? `Rs ${pricingQuote.finalTotal}` : "—"}
                </strong>
              </div>
            </div>
            <div className="pos-phase-note">
              {pricingQuote
                ? `Authoritative quote · ${membershipTierLabel(pricingQuote.membershipTier)} · ${membershipStatusLabel(pricingQuote.membershipStatus)} · expires ${pricingQuote.expiresAt}.`
                : "Waiting for an authoritative price quote. No local price will be used."}
            </div>
            {pricingMessage ? (
              <p className="error-message" role="alert">
                Pricing quote failed ({pricingMessage}). No local price will be used.
              </p>
            ) : null}
            <button
              className="secondary-light-button"
              type="button"
              onClick={handlePricingQuote}
              disabled={pricingBusy}
            >
              {pricingBusy ? "Requesting price..." : "Refresh authoritative price"}
            </button>

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

            <button
              className="primary-button pos-finalize"
              type="submit"
              disabled={!quoteReady || pricingBusy}
            >
              Finalize sale
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
