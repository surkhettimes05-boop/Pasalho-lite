import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Role } from "@/generated/prisma/client";
import {
  createSupplierAction,
  postReceiptAction,
} from "@/app/(app)/receiving/actions";
import { ReceiveStockForm } from "@/components/receive-stock-form";
import { requirePageRole } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db";
import { formatNepalDateTime } from "@/lib/time";
import { getReceiptPage } from "@/modules/receiving/receipt.service";

const errors: Record<string, string> = {
  SUPPLIER_NOT_FOUND: "Select an active supplier.",
  WAREHOUSE_NOT_FOUND: "The central warehouse is unavailable.",
  PRODUCT_NOT_AVAILABLE:
    "Every receipt item must use an active catalog product.",
  IDEMPOTENCY_CONFLICT:
    "This receipt request conflicts with an earlier request.",
  INVALID_RECEIVING_INPUT:
    "Check the supplier and receipt item fields.",
  RECEIVING_OPERATION_FAILED:
    "The receiving operation could not be completed.",
};

function pageNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function pageHref(page: number) {
  return `/receiving?page=${page}`;
}

export const dynamic = "force-dynamic";

export default async function ReceivingPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    success?: string;
    page?: string;
  }>;
}) {
  await requirePageRole([Role.OWNER_ADMIN, Role.WAREHOUSE_STAFF]);
  const params = await searchParams;
  const currentPage = pageNumber(params.page);

  const [suppliers, products, history] = await Promise.all([
    prisma.supplier.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
      },
    }),
    prisma.product.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        sku: true,
        barcode: true,
        name: true,
        unit: true,
      },
    }),
    getReceiptPage(currentPage, 30),
  ]);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Inventory</p>
          <h2>Receive stock</h2>
          <p className="muted">
            Post physical supplier deliveries into the central warehouse. A
            posted receipt is historical evidence and cannot be edited.
          </p>
        </div>
        <span className="status-badge">{history.total} receipts</span>
      </header>

      {params.error ? (
        <p className="error-message" role="alert">
          {errors[params.error] ?? "The receiving operation failed."}
        </p>
      ) : null}

      {params.success === "supplier" ? (
        <p className="success-message" role="status">
          Supplier added.
        </p>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Supplier</p>
            <h3>Add supplier</h3>
            <p className="muted">
              V1 supplier records are intentionally minimal and exist only to
              support receiving.
            </p>
          </div>
        </div>

        <form action={createSupplierAction} className="form-grid">
          <label>
            Supplier name
            <input name="name" required placeholder="Supplier / distributor" />
          </label>
          <label>
            Phone
            <input name="phone" placeholder="Optional" />
          </label>
          <label className="span-2">
            Notes
            <input name="notes" placeholder="Optional" />
          </label>
          <div className="form-actions span-2">
            <button className="secondary-light-button" type="submit">
              Add supplier
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        {suppliers.length === 0 ? (
          <div className="empty-state">
            <h3>Add a supplier first</h3>
            <p className="muted">
              At least one active supplier is required before stock can be
              received.
            </p>
          </div>
        ) : products.length === 0 ? (
          <div className="empty-state">
            <h3>Add products first</h3>
            <p className="muted">
              Receiving can only post against active catalog SKUs.
            </p>
          </div>
        ) : (
          <ReceiveStockForm
            suppliers={suppliers}
            products={products}
            idempotencyKey={randomUUID()}
            action={postReceiptAction}
          />
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">History</p>
            <h3>Posted receipts</h3>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Received</th>
                <th>Supplier</th>
                <th>Reference</th>
                <th>Items</th>
                <th>Total cost</th>
                <th>Posted by</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.receipts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-cell">
                    No purchase receipts posted yet.
                  </td>
                </tr>
              ) : (
                history.receipts.map((receipt) => (
                  <tr key={receipt.id}>
                    <td>
                      <Link
                        className="text-link"
                        href={`/receiving/${receipt.id}`}
                      >
                        {receipt.receiptNumber}
                      </Link>
                    </td>
                    <td>{formatNepalDateTime(receipt.receivedAt)}</td>
                    <td>{receipt.supplier?.name ?? "—"}</td>
                    <td>{receipt.supplierReference ?? "—"}</td>
                    <td>{receipt.items.length}</td>
                    <td>
                      Rs{" "}
                      {receipt.items
                        .reduce(
                          (sum, item) => sum + Number(item.lineTotal),
                          0,
                        )
                        .toFixed(2)}
                    </td>
                    <td>{receipt.postedBy?.name ?? "—"}</td>
                    <td>
                      <span className="type-pill">{receipt.status}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <span>
            Page {history.page} of {history.totalPages} · {history.total} receipt
            {history.total === 1 ? "" : "s"}
          </span>
          <div>
            {history.page > 1 ? (
              <Link className="text-link" href={pageHref(history.page - 1)}>
                Previous
              </Link>
            ) : null}
            {history.page < history.totalPages ? (
              <Link className="text-link" href={pageHref(history.page + 1)}>
                Next
              </Link>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
