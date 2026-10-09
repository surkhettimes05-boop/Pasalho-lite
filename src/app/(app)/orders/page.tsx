import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Role } from "@/generated/prisma/client";
import { CreateOrderForm } from "@/components/create-order-form";
import { requirePageRole } from "@/lib/auth/require-role";
import { formatNepalDateTime } from "@/lib/time";
import {
  getCustomerOrderPage,
  getOrderCatalog,
} from "@/modules/orders/order.service";

const errors: Record<string, string> = {
  CUSTOMER_NOT_AVAILABLE: "Select an active customer.",
  PRODUCT_NOT_AVAILABLE: "Every order item must use an active product.",
  STORE_NOT_FOUND: "The Pasalho Store location is unavailable.",
  IDEMPOTENCY_CONFLICT: "This order request conflicts with an earlier request.",
  INVALID_ORDER_INPUT: "Check the order fields and try again.",
  ORDER_OPERATION_FAILED: "The order could not be created.",
};

function pageNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function money(value: { toString: () => string }) {
  const numeric = Number(value.toString());
  return Number.isFinite(numeric)
    ? `Rs ${numeric.toFixed(2)}`
    : `Rs ${value.toString()}`;
}

export const dynamic = "force-dynamic";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; page?: string }>;
}) {
  await requirePageRole([Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const params = await searchParams;
  const [catalog, history] = await Promise.all([
    getOrderCatalog(),
    getCustomerOrderPage(pageNumber(params.page), 30),
  ]);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h2>WhatsApp / phone COD orders</h2>
          <p className="muted">
            Staff-entered customer orders. WhatsApp is communication only; this
            order record is the source of truth.
          </p>
        </div>
        <span className="status-badge">{history.total} orders</span>
      </header>

      {params.error ? (
        <p className="error-message" role="alert">
          {errors[params.error] ?? "The order operation failed."}
        </p>
      ) : null}

      <section className="panel">
        <CreateOrderForm
          products={catalog}
          idempotencyKey={randomUUID()}
        />
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Order queue</p>
            <h3>Recent COD orders</h3>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Created</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Total</th>
                <th>Payment</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.orders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-cell">No COD orders yet.</td>
                </tr>
              ) : (
                history.orders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <Link className="text-link" href={`/orders/${order.id}`}>
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td>{formatNepalDateTime(order.createdAt)}</td>
                    <td>
                      {order.customer.name ?? order.phoneSnapshot}
                      <small>{order.phoneSnapshot}</small>
                    </td>
                    <td>{order.items.length}</td>
                    <td>{money(order.total)}</td>
                    <td>{order.paymentStatus}</td>
                    <td>
                      <span className={`type-pill order-status-${order.status.toLowerCase()}`}>
                        {order.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <span>
            Page {history.page} of {history.totalPages} · {history.total} order
            {history.total === 1 ? "" : "s"}
          </span>
          <div>
            {history.page > 1 ? (
              <Link className="text-link" href={`/orders?page=${history.page - 1}`}>
                Previous
              </Link>
            ) : null}
            {history.page < history.totalPages ? (
              <Link className="text-link" href={`/orders?page=${history.page + 1}`}>
                Next
              </Link>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
