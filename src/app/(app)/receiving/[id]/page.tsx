import Link from "next/link";
import { notFound } from "next/navigation";
import { Role } from "@/generated/prisma/client";
import { requirePageRole } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db";
import { formatNepalDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function ReceiptDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string }>;
}) {
  await requirePageRole([Role.OWNER_ADMIN, Role.WAREHOUSE_STAFF]);
  const { id } = await params;
  const query = await searchParams;

  const receipt = await prisma.purchaseReceipt.findUnique({
    where: { id },
    include: {
      supplier: true,
      postedBy: {
        select: {
          name: true,
          email: true,
        },
      },
      items: {
        include: {
          product: {
            select: {
              sku: true,
              name: true,
              unit: true,
            },
          },
        },
      },
    },
  });

  if (!receipt) {
    notFound();
  }

  const totalCost = receipt.items.reduce(
    (sum, item) => sum + Number(item.lineTotal),
    0,
  );

  return (
    <div className="page-stack narrow-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Purchase receipt</p>
          <h2>{receipt.receiptNumber}</h2>
          <p className="muted">
            Posted receipts are immutable receiving evidence.
          </p>
        </div>
        <Link className="text-link" href="/receiving">
          Back to receiving
        </Link>
      </header>

      {query.success === "posted" ? (
        <p className="success-message" role="status">
          Receipt posted and warehouse inventory updated.
        </p>
      ) : null}

      <section className="summary-grid">
        <article className="summary-card">
          <span>Supplier</span>
          <strong className="summary-text">
            {receipt.supplier?.name ?? "—"}
          </strong>
          <small>{receipt.supplierReference ?? "No supplier reference"}</small>
        </article>
        <article className="summary-card">
          <span>Received</span>
          <strong className="summary-text">
            {formatNepalDateTime(receipt.receivedAt)}
          </strong>
          <small>Nepal operational time</small>
        </article>
        <article className="summary-card">
          <span>Total received cost</span>
          <strong>Rs {totalCost.toFixed(2)}</strong>
          <small>{receipt.items.length} item line(s)</small>
        </article>
      </section>

      <section className="panel">
        <div className="receipt-meta">
          <div>
            <span>Status</span>
            <strong>{receipt.status}</strong>
          </div>
          <div>
            <span>Posted by</span>
            <strong>{receipt.postedBy?.name ?? "—"}</strong>
          </div>
          <div>
            <span>Notes</span>
            <strong>{receipt.notes ?? "—"}</strong>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Quantity</th>
                <th>Unit cost</th>
                <th>Line total</th>
              </tr>
            </thead>
            <tbody>
              {receipt.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.product.sku}</td>
                  <td>{item.product.name}</td>
                  <td>
                    {item.quantity.toString()} {item.product.unit}
                  </td>
                  <td>Rs {item.unitCost.toFixed(2)}</td>
                  <td>Rs {item.lineTotal.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
