import Link from "next/link";
import { Role } from "@/generated/prisma/client";
import { createCustomerAction } from "@/app/(app)/customers/actions";
import { requirePageRole } from "@/lib/auth/require-role";
import { getCustomerPage } from "@/modules/customers/customer.service";

const errors: Record<string, string> = {
  CUSTOMER_EXISTS: "A customer with that phone already exists.",
  INVALID_CUSTOMER_PHONE: "Enter a valid Nepal phone number.",
  INVALID_CUSTOMER: "Check the customer fields and try again.",
  CUSTOMER_OPERATION_FAILED: "The customer could not be created.",
};

function pageNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function href(page: number, q: string) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  if (q) params.set("q", q);
  return `/customers?${params.toString()}`;
}

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; error?: string }>;
}) {
  await requirePageRole([Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const result = await getCustomerPage({
    search: q,
    page: pageNumber(params.page),
    pageSize: 40,
  });

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Phase 5</p>
          <h2>Customers</h2>
          <p className="muted">
            Phone-based customer identity, purchase history and loyalty ledger.
          </p>
        </div>
        <span className="status-badge">{result.total} customers</span>
      </header>

      {params.error ? (
        <p className="error-message" role="alert">
          {errors[params.error] ?? "Customer operation failed."}
        </p>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">New customer</p>
            <h3>Create customer</h3>
          </div>
        </div>

        <form action={createCustomerAction} className="form-grid">
          <label>
            Phone
            <input name="phone" required placeholder="98XXXXXXXX or +977..." />
          </label>
          <label>
            Name
            <input name="name" placeholder="Optional" />
          </label>
          <label className="span-2">
            Notes
            <input name="notes" placeholder="Optional" />
          </label>
          <div className="form-actions span-2">
            <button className="primary-button" type="submit">
              Create customer
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <form className="search-row" method="get">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search phone or customer name"
          />
          <button className="secondary-light-button" type="submit">
            Search
          </button>
          {q ? (
            <Link className="text-link" href="/customers">
              Clear
            </Link>
          ) : null}
        </form>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Phone</th>
                <th>Points</th>
                <th>Spend remainder</th>
                <th>POS sales</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {result.customers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    No matching customers.
                  </td>
                </tr>
              ) : (
                result.customers.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <Link
                        className="text-link"
                        href={`/customers/${customer.id}`}
                      >
                        {customer.name ?? "Unnamed customer"}
                      </Link>
                    </td>
                    <td>
                      {customer.phoneDisplay}
                      <small>{customer.phoneNormalized}</small>
                    </td>
                    <td>{customer.loyaltyAccount?.pointBalance ?? 0}</td>
                    <td>
                      Rs{" "}
                      {customer.loyaltyAccount?.spendRemainder.toFixed(2) ??
                        "0.00"}
                    </td>
                    <td>{customer._count.sales}</td>
                    <td>
                      <span
                        className={
                          customer.active
                            ? "type-pill"
                            : "type-pill type-pill-muted"
                        }
                      >
                        {customer.active ? "ACTIVE" : "INACTIVE"}
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
            Page {result.page} of {result.totalPages} · {result.total} customer
            {result.total === 1 ? "" : "s"}
          </span>
          <div>
            {result.page > 1 ? (
              <Link className="text-link" href={href(result.page - 1, q)}>
                Previous
              </Link>
            ) : null}
            {result.page < result.totalPages ? (
              <Link className="text-link" href={href(result.page + 1, q)}>
                Next
              </Link>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
