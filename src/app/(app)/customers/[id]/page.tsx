import Link from "next/link";
import { notFound } from "next/navigation";
import { Role } from "@/generated/prisma/client";
import { linkCustomerMembershipIdentityAction } from "@/app/(app)/customers/actions";
import { requirePageRole } from "@/lib/auth/require-role";
import { formatNepalDateTime } from "@/lib/time";
import { getCustomerById } from "@/modules/customers/customer.service";
import { isLoyaltyEarningEnabled } from "@/modules/loyalty/loyalty.service";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const user = await requirePageRole([Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const { id } = await params;
  const query = await searchParams;
  const customer = await getCustomerById(id);
  const loyaltyEnabled = isLoyaltyEarningEnabled();

  if (!customer) {
    notFound();
  }

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

      {query.success === "membership-link-updated" ? (
        <p className="success-message" role="status">
          The modern-trade membership identity link was updated.
        </p>
      ) : null}

      {query.error ? (
        <p className="error-message" role="alert">
          Membership link could not be updated ({query.error}).
        </p>
      ) : null}

      {query.success === "created" ? (
        <p className="success-message" role="status">
          Customer created with a zero-balance loyalty account.
        </p>
      ) : null}

      {user.role === Role.OWNER_ADMIN ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Authoritative pricing</p>
              <h3>Modern-trade membership identity</h3>
              <p className="muted">
                The link is verified against the customer phone by modern-trade.
                Lite does not store a membership tier or status.
              </p>
            </div>
          </div>
          {customer.membershipIdentityId ? (
            <p className="muted">
              Linked customer reference: {customer.membershipIdentityId}
            </p>
          ) : (
            <p className="muted">No modern-trade identity is linked.</p>
          )}
          {!customer.membershipIdentityId ? (
            <form
              action={linkCustomerMembershipIdentityAction}
              className="form-grid"
            >
              <input type="hidden" name="customerId" value={customer.id} />
              <label className="span-2">
                Modern-trade customer reference
                <input
                  name="membershipIdentityId"
                  inputMode="text"
                  autoComplete="off"
                  placeholder="Customer UUID"
                />
              </label>
              <div className="form-actions span-2">
                <button className="primary-button" type="submit">
                  Verify and link customer
                </button>
              </div>
            </form>
          ) : null}
          {customer.membershipIdentityId ? (
            <form action={linkCustomerMembershipIdentityAction}>
              <input type="hidden" name="customerId" value={customer.id} />
              <input type="hidden" name="membershipIdentityId" value="" />
              <button className="link-button danger-link" type="submit">
                Unlink modern-trade customer
              </button>
            </form>
          ) : null}
        </section>
      ) : null}

      <section className="summary-grid">
        <article className="summary-card">
          <span>{loyaltyEnabled ? "Points" : "Historical points"}</span>
          <strong>{customer.loyaltyAccount?.pointBalance ?? 0}</strong>
          <small>
            {loyaltyEnabled
              ? "No redemption in V1"
              : "Historical balance preserved; new earning is disabled."}
          </small>
        </article>
        <article className="summary-card">
          <span>Spend remainder</span>
          <strong>
            Rs {customer.loyaltyAccount?.spendRemainder.toFixed(2) ?? "0.00"}
          </strong>
          <small>
            {loyaltyEnabled
              ? "Carried toward the next Rs 500 threshold"
              : "Historical remainder is read-only"}
          </small>
        </article>
        <article className="summary-card">
          <span>Net eligible spend</span>
          <strong>Rs {customer.loyaltyEligibleSpendTotal.toFixed(2)}</strong>
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
            <h3>Recent transactions</h3>
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
