import Link from "next/link";
import { ReturnSourceType, Role } from "@/generated/prisma/client";
import { requirePageRole } from "@/lib/auth/require-role";
import { formatNepalDateTime } from "@/lib/time";
import {
  getReturnPage,
  searchReturnSources,
} from "@/modules/returns/return.service";

const errors: Record<string, string> = {
  INVALID_RETURN_INPUT: "Check the return request and try again.",
  RETURN_OPERATION_FAILED: "The return operation could not be completed.",
};

function pageNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export const dynamic = "force-dynamic";

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; error?: string }>;
}) {
  await requirePageRole([Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const params = await searchParams;
  const q = params.q?.trim() ?? "";

  const [sources, history] = await Promise.all([
    searchReturnSources(q),
    getReturnPage(pageNumber(params.page), 30),
  ]);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Phase 7</p>
          <h2>Returns & refunds</h2>
          <p className="muted">
            Correct completed transactions without rewriting the original sale
            or order.
          </p>
        </div>
        <span className="status-badge">{history.total} returns</span>
      </header>

      {params.error ? (
        <p className="error-message" role="alert">
          {errors[params.error] ?? "Return operation failed."}
        </p>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Original transaction</p>
            <h3>Find sale or COD order</h3>
            <p className="muted">
              Search POS receipt number, COD order number, or COD customer
              phone.
            </p>
          </div>
        </div>

        <form className="search-row" method="get">
          <input
            name="q"
            defaultValue={q}
            placeholder="POS-... / COD-... / customer phone"
          />
          <button className="secondary-light-button" type="submit">
            Search
          </button>
          {q ? (
            <Link className="text-link" href="/returns">
              Clear
            </Link>
          ) : null}
        </form>

        {q ? (
          <div className="return-source-grid">
            <div>
              <h3>POS sales</h3>
              {sources.sales.length === 0 ? (
                <p className="muted">No matching POS receipt.</p>
              ) : (
                sources.sales.map((sale) => (
                  <article className="return-source-card" key={sale.id}>
                    <div>
                      <strong>{sale.receiptNumber}</strong>
                      <small>
                        {sale.customer?.name ??
                          sale.customer?.phoneDisplay ??
                          "Anonymous"}{" "}
                        · {formatNepalDateTime(sale.finalizedAt)}
                      </small>
                    </div>
                    <div>
                      <strong>Rs {sale.total.toFixed(2)}</strong>
                      <Link
                        className="text-link"
                        href={`/returns/new?sourceType=${ReturnSourceType.SALE}&sourceId=${sale.id}`}
                      >
                        Process return
                      </Link>
                    </div>
                  </article>
                ))
              )}
            </div>

            <div>
              <h3>COD orders</h3>
              {sources.orders.length === 0 ? (
                <p className="muted">No matching COD order.</p>
              ) : (
                sources.orders.map((order) => (
                  <article className="return-source-card" key={order.id}>
                    <div>
                      <strong>{order.orderNumber}</strong>
                      <small>
                        {order.customer.name ?? order.phoneSnapshot} ·{" "}
                        {order.status}
                      </small>
                    </div>
                    <div>
                      <strong>Rs {order.total.toFixed(2)}</strong>
                      <Link
                        className="text-link"
                        href={`/returns/new?sourceType=${ReturnSourceType.CUSTOMER_ORDER}&sourceId=${order.id}`}
                      >
                        Return / recover
                      </Link>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">History</p>
            <h3>Completed returns</h3>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Return</th>
                <th>Completed</th>
                <th>Source</th>
                <th>Kind</th>
                <th>Refund</th>
                <th>Items</th>
                <th>User</th>
              </tr>
            </thead>
            <tbody>
              {history.returns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    No completed returns.
                  </td>
                </tr>
              ) : (
                history.returns.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <Link
                        className="text-link"
                        href={`/returns/${record.id}`}
                      >
                        {record.returnNumber}
                      </Link>
                    </td>
                    <td>{formatNepalDateTime(record.completedAt)}</td>
                    <td>
                      {record.sourceType}
                      <small>{record.sourceId}</small>
                    </td>
                    <td>{record.kind}</td>
                    <td>Rs {record.refundAmount.toFixed(2)}</td>
                    <td>{record.items.length}</td>
                    <td>{record.createdBy.name}</td>
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
