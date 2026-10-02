import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma, Role, TransferStatus } from "@/generated/prisma/client";
import {
  cancelTransferAction,
  dispatchTransferAction,
  markTransferReadyAction,
  receiveTransferAction,
} from "@/app/(app)/transfers/actions";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { formatNepalDateTime } from "@/lib/time";
import {
  getTransferById,
  transferItemInTransitQuantity,
} from "@/modules/transfers/transfer.service";

const errors: Record<string, string> = {
  TRANSFER_NOT_FOUND: "Transfer not found.",
  INVALID_STATE_TRANSITION: "That transfer state change is not allowed.",
  INSUFFICIENT_STOCK: "Warehouse stock is insufficient for this dispatch.",
  RESERVED_STOCK_CONFLICT:
    "Dispatch would reduce warehouse stock below reserved stock.",
  IDEMPOTENCY_CONFLICT:
    "This request conflicts with an earlier transfer command.",
  TRANSFER_ITEMS_MISMATCH:
    "Every dispatched transfer item must be counted at store receipt.",
  RECEIVED_EXCEEDS_DISPATCHED:
    "Received quantity cannot exceed the dispatched quantity.",
  DISCREPANCY_REASON_REQUIRED:
    "Explain any shortage before completing store receipt.",
  INVALID_TRANSFER_INPUT: "Check the transfer fields and try again.",
  UNAUTHORIZED_ACTION: "Your role cannot perform this transfer action.",
  TRANSFER_OPERATION_FAILED: "The transfer operation could not be completed.",
};

const successMessages: Record<string, string> = {
  created: "Draft transfer created. No stock has moved yet.",
  ready: "Transfer marked READY. No stock has moved yet.",
  cancelled: "Transfer cancelled without changing inventory.",
  dispatched: "Transfer dispatched. Warehouse stock was deducted once.",
  received: "Transfer received. Counted stock was added to the store once.",
};

export const dynamic = "force-dynamic";

export default async function TransferDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const user = await requireCurrentUser();
  const { id } = await params;
  const query = await searchParams;
  const transfer = await getTransferById(id);

  if (!transfer) {
    notFound();
  }

  const canWarehouseAction =
    user.role === Role.OWNER_ADMIN || user.role === Role.WAREHOUSE_STAFF;
  const canReceive =
    user.role === Role.OWNER_ADMIN || user.role === Role.CASHIER_STORE;

  const requestedTotal = transfer.items.reduce(
    (sum, item) => sum.add(item.requestedQuantity),
    new Prisma.Decimal(0),
  );
  const dispatchedTotal = transfer.items.reduce(
    (sum, item) =>
      sum.add(item.dispatchedQuantity ?? new Prisma.Decimal(0)),
    new Prisma.Decimal(0),
  );
  const receivedTotal = transfer.items.reduce(
    (sum, item) =>
      sum.add(item.receivedQuantity ?? new Prisma.Decimal(0)),
    new Prisma.Decimal(0),
  );
  const inTransitTotal = transfer.items.reduce(
    (sum, item) =>
      sum.add(transferItemInTransitQuantity(item, transfer.status)),
    new Prisma.Decimal(0),
  );

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Stock transfer</p>
          <h2>{transfer.transferNumber}</h2>
          <p className="muted">
            {transfer.fromLocation.name} → {transfer.toLocation.name}
          </p>
        </div>
        <Link className="text-link" href="/transfers">
          Back to transfers
        </Link>
      </header>

      {query.error ? (
        <p className="error-message" role="alert">
          {errors[query.error] ?? "The transfer operation failed."}
        </p>
      ) : null}

      {query.success ? (
        <p className="success-message" role="status">
          {successMessages[query.success] ?? "Transfer updated."}
        </p>
      ) : null}

      <section className="summary-grid">
        <article className="summary-card">
          <span>Status</span>
          <strong>{transfer.status}</strong>
          <small>Created {formatNepalDateTime(transfer.createdAt)}</small>
        </article>
        <article className="summary-card">
          <span>Requested / dispatched</span>
          <strong>
            {requestedTotal.toString()} / {dispatchedTotal.toString()}
          </strong>
          <small>Total quantity across transfer lines</small>
        </article>
        <article className="summary-card">
          <span>In transit</span>
          <strong>{inTransitTotal.toString()}</strong>
          <small>
            {transfer.status === TransferStatus.DISPATCHED
              ? "Dispatched and not yet store-received"
              : "No active in-transit quantity"}
          </small>
        </article>
      </section>

      <section className="panel">
        <div className="transfer-meta">
          <div>
            <span>Created by</span>
            <strong>{transfer.createdBy.name}</strong>
          </div>
          <div>
            <span>Dispatched</span>
            <strong>
              {transfer.dispatchedAt
                ? formatNepalDateTime(transfer.dispatchedAt)
                : "—"}
            </strong>
          </div>
          <div>
            <span>Received</span>
            <strong>
              {transfer.receivedAt
                ? formatNepalDateTime(transfer.receivedAt)
                : "—"}
            </strong>
          </div>
          <div>
            <span>Received total</span>
            <strong>{receivedTotal.toString()}</strong>
          </div>
        </div>

        {transfer.notes ? <p className="muted">{transfer.notes}</p> : null}

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Requested</th>
                <th>Dispatched</th>
                <th>Received</th>
                <th>In transit</th>
                <th>Discrepancy</th>
              </tr>
            </thead>
            <tbody>
              {transfer.items.map((item) => {
                const inTransit = transferItemInTransitQuantity(
                  item,
                  transfer.status,
                );
                const discrepancy =
                  item.dispatchedQuantity !== null &&
                  item.receivedQuantity !== null
                    ? item.dispatchedQuantity.sub(item.receivedQuantity)
                    : new Prisma.Decimal(0);

                return (
                  <tr key={item.id}>
                    <td>{item.product.sku}</td>
                    <td>
                      {item.product.name}
                      <small>{item.product.unit}</small>
                    </td>
                    <td>{item.requestedQuantity.toString()}</td>
                    <td>{item.dispatchedQuantity?.toString() ?? "—"}</td>
                    <td>{item.receivedQuantity?.toString() ?? "—"}</td>
                    <td>{inTransit.toString()}</td>
                    <td>
                      {discrepancy.greaterThan(0)
                        ? `${discrepancy.toString()} — ${item.discrepancyReason ?? "No reason"}`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {transfer.status === TransferStatus.DRAFT && canWarehouseAction ? (
        <section className="panel transfer-actions-panel">
          <div>
            <p className="eyebrow">Prepare</p>
            <h3>Draft transfer</h3>
            <p className="muted">
              READY still has no inventory effect. It confirms this request is
              prepared for dispatch.
            </p>
          </div>
          <div className="transfer-action-row">
            <form action={markTransferReadyAction}>
              <input type="hidden" name="transferId" value={transfer.id} />
              <button className="primary-button" type="submit">
                Mark READY
              </button>
            </form>
            <form action={cancelTransferAction}>
              <input type="hidden" name="transferId" value={transfer.id} />
              <button className="secondary-light-button" type="submit">
                Cancel transfer
              </button>
            </form>
          </div>
        </section>
      ) : null}

      {transfer.status === TransferStatus.READY && canWarehouseAction ? (
        <section className="panel transfer-actions-panel">
          <div>
            <p className="eyebrow">Warehouse dispatch</p>
            <h3>Move stock out of warehouse</h3>
            <p className="muted">
              Dispatch deducts the requested quantities from warehouse stock
              exactly once. Store stock remains unchanged.
            </p>
          </div>
          <div className="transfer-action-row">
            <form action={dispatchTransferAction}>
              <input type="hidden" name="transferId" value={transfer.id} />
              <input
                type="hidden"
                name="idempotencyKey"
                value={randomUUID()}
              />
              <button className="primary-button" type="submit">
                Dispatch transfer
              </button>
            </form>
            <form action={cancelTransferAction}>
              <input type="hidden" name="transferId" value={transfer.id} />
              <button className="secondary-light-button" type="submit">
                Cancel transfer
              </button>
            </form>
          </div>
        </section>
      ) : null}

      {transfer.status === TransferStatus.DISPATCHED && canReceive ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Store receipt</p>
              <h3>Count the physical shipment</h3>
              <p className="muted">
                Enter what actually arrived. A shortage requires a discrepancy
                reason. The store receives only the counted quantity.
              </p>
            </div>
          </div>

          <form action={receiveTransferAction} className="receive-form">
            <input type="hidden" name="transferId" value={transfer.id} />
            <input
              type="hidden"
              name="idempotencyKey"
              value={randomUUID()}
            />
            <input
              type="hidden"
              name="lineCount"
              value={transfer.items.length}
            />

            <div className="table-wrap">
              <table className="data-table receive-transfer-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Product</th>
                    <th>Dispatched</th>
                    <th>Received</th>
                    <th>Discrepancy reason</th>
                  </tr>
                </thead>
                <tbody>
                  {transfer.items.map((item, index) => (
                    <tr key={item.id}>
                      <td>
                        {item.product.sku}
                        <input
                          type="hidden"
                          name={`transferItemId_${index}`}
                          value={item.id}
                        />
                      </td>
                      <td>{item.product.name}</td>
                      <td>{item.dispatchedQuantity?.toString() ?? "—"}</td>
                      <td>
                        <input
                          className="table-input"
                          name={`receivedQuantity_${index}`}
                          inputMode="decimal"
                          required
                          defaultValue={
                            item.dispatchedQuantity?.toString() ?? "0"
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="table-input"
                          name={`discrepancyReason_${index}`}
                          placeholder="Required only for shortage"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="receive-submit">
              <p className="muted">
                Completing receipt clears this transfer from in-transit. Any
                shortage remains visible as a recorded discrepancy.
              </p>
              <button className="primary-button" type="submit">
                Complete store receipt
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
