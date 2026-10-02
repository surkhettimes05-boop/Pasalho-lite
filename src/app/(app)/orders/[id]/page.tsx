import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerOrderStatus, ReservationStatus, Role } from "@/generated/prisma/client";
import {
  cancelCustomerOrderAction,
  confirmCustomerOrderAction,
  deliverCustomerOrderAction,
  dispatchCustomerOrderAction,
  packCustomerOrderAction,
} from "@/app/(app)/orders/actions";
import { requirePageRole } from "@/lib/auth/require-role";
import { formatNepalDateTime } from "@/lib/time";
import { getCustomerOrderById } from "@/modules/orders/order.service";

const errors: Record<string, string> = {
  ORDER_NOT_FOUND: "Order not found.",
  INVALID_STATE_TRANSITION: "That order state transition is not allowed.",
  INSUFFICIENT_STOCK: "Store available stock is insufficient to confirm this order.",
  RESERVATION_INTEGRITY_ERROR: "The order reservation no longer reconciles correctly.",
  PAYMENT_INTEGRITY_ERROR: "The COD payment is not in the expected state.",
  IDEMPOTENCY_CONFLICT: "This command conflicts with an earlier order command.",
  ORDER_OPERATION_FAILED: "The order operation could not be completed.",
};

const success: Record<string, string> = {
  created: "NEW order created. No stock has been reserved or deducted.",
  confirmed: "Order confirmed. Store stock is reserved but physical on-hand is unchanged.",
  packed: "Order packed. Reservation remains active and physical stock is unchanged.",
  dispatched: "Order dispatched. Reservation was consumed and physical store stock was deducted once.",
  delivered: "Order delivered, COD collected and loyalty posted. Delivery did not deduct inventory again.",
  cancelled: "Order cancelled before dispatch. Any active reservation was released.",
};

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  await requirePageRole([Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const { id } = await params;
  const query = await searchParams;
  const result = await getCustomerOrderById(id);

  if (!result || !result.payment) notFound();

  const { order, payment, loyaltyTransaction } = result;
  const activeReserved = order.reservations
    .filter((reservation) => reservation.status === ReservationStatus.ACTIVE)
    .reduce((sum, reservation) => sum + Number(reservation.quantity), 0);

  const whatsappDigits = order.customer.phoneNormalized.replace(/\D/g, "");
  const whatsappText = encodeURIComponent(
    `Pasalho order ${order.orderNumber}: status ${order.status}, total Rs ${order.total.toFixed(2)}.`,
  );
  const whatsappHref = `https://wa.me/${whatsappDigits}?text=${whatsappText}`;

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">COD order</p>
          <h2>{order.orderNumber}</h2>
          <p className="muted">
            {order.customer.name ?? order.phoneSnapshot} · {order.phoneSnapshot}
          </p>
        </div>
        <div className="receipt-actions">
          <a className="secondary-light-button" href={whatsappHref} target="_blank" rel="noreferrer">
            Open WhatsApp
          </a>
          <Link className="text-link" href="/orders">Back to orders</Link>
        </div>
      </header>

      {query.error ? (
        <p className="error-message" role="alert">
          {errors[query.error] ?? "The order operation failed."}
        </p>
      ) : null}
      {query.success ? (
        <p className="success-message" role="status">
          {success[query.success] ?? "Order updated."}
        </p>
      ) : null}

      <section className="summary-grid">
        <article className="summary-card">
          <span>Status</span>
          <strong>{order.status}</strong>
          <small>{formatNepalDateTime(order.createdAt)}</small>
        </article>
        <article className="summary-card">
          <span>COD payment</span>
          <strong>{payment.status}</strong>
          <small>Rs {payment.amount.toFixed(2)}</small>
        </article>
        <article className="summary-card">
          <span>Active reserved quantity</span>
          <strong>{activeReserved}</strong>
          <small>Physical stock is separate</small>
        </article>
      </section>

      <section className="panel">
        <div className="order-meta">
          <div>
            <span>Address</span>
            <strong>{order.addressText}</strong>
          </div>
          <div>
            <span>Created by</span>
            <strong>{order.createdBy.name}</strong>
          </div>
          <div>
            <span>Confirmed</span>
            <strong>{order.confirmedAt ? formatNepalDateTime(order.confirmedAt) : "—"}</strong>
          </div>
          <div>
            <span>Dispatched</span>
            <strong>{order.dispatchedAt ? formatNepalDateTime(order.dispatchedAt) : "—"}</strong>
          </div>
          <div>
            <span>Delivered</span>
            <strong>{order.deliveredAt ? formatNepalDateTime(order.deliveredAt) : "—"}</strong>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Qty</th>
                <th>Rate</th>
                <th>Line total</th>
                <th>Reservation</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => {
                const reservation = order.reservations.find(
                  (entry) => entry.productId === item.productId,
                );
                return (
                  <tr key={item.id}>
                    <td>{item.skuSnapshot}</td>
                    <td>{item.productNameSnapshot}</td>
                    <td>{item.quantity.toString()}</td>
                    <td>Rs {item.unitPrice.toFixed(2)}</td>
                    <td>Rs {item.lineTotal.toFixed(2)}</td>
                    <td>{reservation?.status ?? "NONE"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="order-totals">
          <div><span>Subtotal</span><strong>Rs {order.subtotal.toFixed(2)}</strong></div>
          <div><span>Discount</span><strong>Rs {order.discountTotal.toFixed(2)}</strong></div>
          <div><span>Delivery</span><strong>Rs {order.deliveryCharge.toFixed(2)}</strong></div>
          <div className="receipt-total"><span>Total COD</span><strong>Rs {order.total.toFixed(2)}</strong></div>
          {loyaltyTransaction ? (
            <div><span>Loyalty posted</span><strong>+{loyaltyTransaction.pointsDelta} point(s)</strong></div>
          ) : null}
        </div>
      </section>

      {order.notes ? <section className="panel"><strong>Notes</strong><p>{order.notes}</p></section> : null}

      <section className="panel transfer-actions-panel">
        <div>
          <p className="eyebrow">Next action</p>
          <h3>{order.status}</h3>
          <p className="muted">
            State skipping is blocked. After dispatch, cancellation is not allowed; use the future return/recovery workflow.
          </p>
        </div>
        <div className="transfer-action-row">
          {order.status === CustomerOrderStatus.NEW ? (
            <form action={confirmCustomerOrderAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button className="primary-button" type="submit">Confirm + reserve</button>
            </form>
          ) : null}
          {order.status === CustomerOrderStatus.CONFIRMED ? (
            <form action={packCustomerOrderAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button className="primary-button" type="submit">Mark PACKED</button>
            </form>
          ) : null}
          {order.status === CustomerOrderStatus.PACKED ? (
            <form action={dispatchCustomerOrderAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button className="primary-button" type="submit">Dispatch order</button>
            </form>
          ) : null}
          {order.status === CustomerOrderStatus.DISPATCHED ? (
            <form action={deliverCustomerOrderAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button className="primary-button" type="submit">Delivered + COD collected</button>
            </form>
          ) : null}
          {[CustomerOrderStatus.NEW, CustomerOrderStatus.CONFIRMED, CustomerOrderStatus.PACKED].includes(order.status) ? (
            <form action={cancelCustomerOrderAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button className="secondary-light-button" type="submit">Cancel order</button>
            </form>
          ) : null}
        </div>
      </section>
    </div>
  );
}
