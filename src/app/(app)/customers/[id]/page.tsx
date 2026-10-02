import Link from "next/link";
import { notFound } from "next/navigation";
import { Role } from "@/generated/prisma/client";
import { requirePageRole } from "@/lib/auth/require-role";
import { formatNepalDateTime } from "@/lib/time";
import { getCustomerById } from "@/modules/customers/customer.service";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string }>;
}) {
  await requirePageRole([Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const { id } = await params;
  const query = await searchParams;
  const customer = await getCustomerById(id);

  if (!customer) {
    notFound();
  }

  const eligibleSpend = customer.loyaltyTransactions.reduce(
    (sum, transaction) => sum + Number(transaction.eligibleSpendDelta),
    0,
  );

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Customer</p>
          <h2>{customer.name ?? customer.phoneDisplay}</h2>
          <p className="muted">
            {customer.phoneDisplay} · {customer.phoneNormalized}
          </p>
        </div>
        <Link className="text-link" href="/customers">
          Back to customers
        </Link>
      </header>

      {query.success === "created" ? (
        <p className="success-message" role="status">
          Customer created with a zero-balance loyalty account.
        </p>
      ) : null}

      <section className="summary-grid">
        <article className="summary-card">
          <span>Points</span>
          <strong>{customer.loyaltyAccount?.pointBalance ?? 0}</strong>
          <small>No redemption in V1</small>
        </article>
        <article className="summary-card">
          <span>Spend remainder</span>
          <strong>
            Rs {customer.loyaltyAccount?.spendRemainder.toFixed(2) ?? "0.00"}
          </strong>
          <small>Carried toward the next Rs 500 threshold</small>
        </article>
        <article className="summary-card">
          <span>Net eligible spend</span>
          <strong>Rs {eligibleSpend.toFixed(2)}</strong>
          <small>Sum of loyalty ledger spend deltas</small>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Purchase history</p>
            <h3>Recent POS sales</h3>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Time</th>
                <th>Items</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {customer.sales.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-cell">
                    No identified POS sales yet.
                  </td>
                </tr>
              ) : (
                customer.sales.map((sale) => (
                  <tr key={sale.id}>
                    <td>
                      <Link className="text-link" href={`/pos/${sale.id}`}>
                        {sale.receiptNumber}
                      </Link>
                    </td>
                    <td>{formatNepalDateTime(sale.finalizedAt)}</td>
                    <td>{sale.items.length}</td>
                    <td>Rs {sale.total.toFixed(2)}</td>
                    <td>{sale.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Loyalty ledger</p>
            <h3>Transactions</h3>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Points</th>
                <th>Eligible spend</th>
                <th>Source</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {customer.loyaltyTransactions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    No loyalty transactions yet.
                  </td>
                </tr>
              ) : (
                customer.loyaltyTransactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{formatNepalDateTime(transaction.createdAt)}</td>
                    <td>{transaction.type}</td>
                    <td>
                      {transaction.pointsDelta >= 0 ? "+" : ""}
                      {transaction.pointsDelta}
                    </td>
                    <td>
                      {Number(transaction.eligibleSpendDelta) >= 0 ? "+" : ""}
                      Rs {transaction.eligibleSpendDelta.toFixed(2)}
                    </td>
                    <td>
                      {transaction.sourceType}
                      <small>{transaction.sourceId}</small>
                    </td>
                    <td>{transaction.reason ?? "—"}</td>
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
