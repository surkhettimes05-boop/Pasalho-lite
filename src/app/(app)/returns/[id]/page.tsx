import Link from "next/link";
import { notFound } from "next/navigation";
import { ReturnSourceType, Role } from "@/generated/prisma/client";
import { requirePageRole } from "@/lib/auth/require-role";
import { formatNepalDateTime } from "@/lib/time";
import { getReturnById } from "@/modules/returns/return.service";

export const dynamic = "force-dynamic";

export default async function ReturnDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string }>;
}) {
  await requirePageRole([Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const { id } = await params;
  const query = await searchParams;
  const record = await getReturnById(id);

  if (!record) notFound();

  const sourceHref =
    record.sourceType === ReturnSourceType.SALE
      ? `/pos/${record.sourceId}`
      : `/orders/${record.sourceId}`;

  const totalRestocked = record.items.reduce(
    (sum, item) => sum + Number(item.restockQuantity),
    0,
  );

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Completed return</p>
          <h2>{record.returnNumber}</h2>
          <p className="muted">
            {record.kind} · {formatNepalDateTime(record.completedAt)}
          </p>
        </div>
        <div className="receipt-actions">
          <Link className="text-link" href={sourceHref}>
            Original transaction
          </Link>
          <Link className="text-link" href="/returns">
            Return history
          </Link>
        </div>
      </header>

      {query.success === "completed" ? (
        <p className="success-message" role="status">
          Return completed atomically. Inventory, payment and loyalty effects
          were applied only where required.
        </p>
      ) : null}

      <section className="summary-grid">
        <article className="summary-card">
          <span>Refund</span>
          <strong>Rs {record.refundAmount.toFixed(2)}</strong>
          <small>{record.refundMethod?.replaceAll("_", " ") ?? "No money collected"}</small>
        </article>
        <article className="summary-card">
          <span>Restocked</span>
          <strong>{totalRestocked}</strong>
          <small>Only accepted stock</small>
        </article>
        <article className="summary-card">
          <span>Source</span>
          <strong>{record.sourceType.replaceAll("_", " ")}</strong>
          <small>{record.sourceId}</small>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Return evidence</p>
            <h3>Items</h3>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Returned qty</th>
                <th>Physically returned</th>
                <th>Restocked</th>
                <th>Refund</th>
              </tr>
            </thead>
            <tbody>
              {record.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.product.sku}</td>
                  <td>{item.product.name}</td>
                  <td>{item.quantity.toString()}</td>
                  <td>{item.physicallyReturned ? "YES" : "NO"}</td>
                  <td>{item.restockQuantity.toString()}</td>
                  <td>Rs {item.refundAmount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="return-reason">
          <span>Reason</span>
          <strong>{record.reason}</strong>
          <small>
            Completed by {record.createdBy.name} · {record.createdBy.email}
          </small>
        </div>
      </section>
    </div>
  );
}
