import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Role } from "@/generated/prisma/client";
import {
  createCustomerForPosAction,
  finalizeSaleAction,
  lookupCustomerForPosAction,
  quotePosPricingAction,
} from "@/app/(app)/pos/actions";
import { PosRegister } from "@/components/pos-register";
import { requirePageRole } from "@/lib/auth/require-role";
import { formatNepalDateTime } from "@/lib/time";
import { getPosCatalog, getSalePage } from "@/modules/pos/pos.service";

const errors: Record<string, string> = {
  STORE_NOT_FOUND: "The Pasalho Store location is unavailable.",
  PRODUCT_NOT_AVAILABLE: "One or more products cannot be sold.",
  CUSTOMER_NOT_AVAILABLE: "The selected customer is unavailable.",
  INSUFFICIENT_STOCK: "Store available stock is insufficient for this sale.",
  RESERVED_STOCK_CONFLICT: "Some stock is reserved and cannot be sold.",
  IDEMPOTENCY_CONFLICT: "This checkout conflicts with an earlier POS request.",
  SALE_INTEGRITY_ERROR: "An existing sale failed an integrity check.",
  INVALID_POS_INPUT: "Check the POS cart and payment method.",
  UNAUTHORIZED_ACTION: "Your role cannot finalize POS sales.",
  POS_OPERATION_FAILED: "The POS sale could not be completed.",
  PRICING_SERVICE_UNAVAILABLE: "The authoritative pricing service is unavailable. No sale was finalized.",
  PRICING_SERVICE_NOT_CONFIGURED: "The authoritative pricing service is not configured.",
  QUOTE_EXPIRED: "The price quote expired. Request a new quote.",
  QUOTE_MISMATCH: "The price quote no longer matches this cart or customer.",
  QUOTE_REPLAY: "This price quote is already bound to another sale.",
  QUOTE_NOT_FOUND: "The pricing quote is not recognized. Request a new quote.",
  QUOTE_SIGNATURE_INVALID: "The pricing quote signature is invalid. Request a new quote.",
  CUSTOMER_MISMATCH: "The customer membership changed or no longer matches this quote.",
  DUPLICATE_SKU: "A SKU maps to multiple modern-trade products. Resolve reconciliation first.",
  SKU_NOT_FOUND: "A cart SKU is not available in the modern-trade catalog.",
  SKU_MISMATCH: "The modern-trade catalog returned a different SKU mapping.",
  PRICING_SERVICE_AUTH_FAILED: "The pricing service rejected its service credentials.",
};

export const dynamic = "force-dynamic";

export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requirePageRole([Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const params = await searchParams;
  const [products, recent] = await Promise.all([
    getPosCatalog(),
    getSalePage(1, 10),
  ]);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h2>POS</h2>
          <p className="muted">
            Store sales with optional phone-based customer identity and
            cumulative loyalty earning.
          </p>
        </div>
        <span className="status-badge">{products.length} sellable SKUs</span>
        <Link className="secondary-light-button" href="/offline-pos.html">
          Offline cash terminal
        </Link>
        {actor.role === Role.OWNER_ADMIN ? <Link className="secondary-light-button" href="/offline-reviews.html">Offline cash reviews</Link> : null}
      </header>

      {params.error ? (
        <p className="error-message" role="alert">
          {errors[params.error] ?? "The POS sale could not be completed."}
        </p>
      ) : null}

      <PosRegister
        products={products}
        idempotencyKey={randomUUID()}
        action={finalizeSaleAction}
        quotePricing={quotePosPricingAction}
        lookupCustomer={lookupCustomerForPosAction}
        createCustomer={createCustomerForPosAction}
      />

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Receipts</p>
            <h3>Recent sales</h3>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Time</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Total</th>
                <th>Payment</th>
                <th>Cashier</th>
              </tr>
            </thead>
            <tbody>
              {recent.sales.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    No POS sales yet.
                  </td>
                </tr>
              ) : (
                recent.sales.map(({ sale, payment }) => (
                  <tr key={sale.id}>
                    <td>
                      <Link className="text-link" href={`/pos/${sale.id}`}>
                        {sale.receiptNumber}
                      </Link>
                    </td>
                    <td>{formatNepalDateTime(sale.finalizedAt)}</td>
                    <td>{sale.customer?.name ?? sale.customer?.phoneDisplay ?? "Anonymous"}</td>
                    <td>{sale.items.length}</td>
                    <td>Rs {sale.total.toFixed(2)}</td>
                    <td>{payment?.method.replaceAll("_", " ") ?? "—"}</td>
                    <td>{sale.finalizedBy.name}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
