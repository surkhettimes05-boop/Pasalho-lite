import Link from "next/link";
import { requireCurrentUser } from "@/lib/auth/current-user";
import {
  formatNepalDateTime,
  getNepalOperatingDateKey,
} from "@/lib/time";
import { getReportsData } from "@/modules/reports/report.service";

export const dynamic = "force-dynamic";

function money(value: { toFixed: (digits: number) => string }) {
  return `Rs ${value.toFixed(2)}`;
}

function validDate(value: string | undefined, fallback: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const user = await requireCurrentUser();
  const params = await searchParams;
  const today = getNepalOperatingDateKey();
  const start = validDate(params.start, today);
  const end = validDate(params.end, today);

  let data;
  let rangeError = "";

  try {
    data = await getReportsData(user.role, {
      startDateKey: start,
      endDateKey: end,
    });
  } catch (error) {
    rangeError =
      error instanceof Error ? error.message : "Invalid report date range.";
    data = await getReportsData(user.role, {
      startDateKey: today,
      endDateKey: today,
    });
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Management</p>
          <h2>Reports</h2>
          <p className="muted">
            Read-only operational reports. Maximum V1 range: 31 days.
          </p>
        </div>
        <form method="get" className="report-range-form">
          <label>
            Start
            <input type="date" name="start" defaultValue={data.startDateKey} />
          </label>
          <label>
            End
            <input type="date" name="end" defaultValue={data.endDateKey} />
          </label>
          <button className="secondary-light-button" type="submit">
            Run report
          </button>
        </form>
      </header>

      {rangeError ? (
        <p className="error-message" role="alert">
          {rangeError} Showing today instead.
        </p>
      ) : null}

      {data.visibility.sales ? (
        <>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Sales</p>
                <h3>Daily gross and net sales</h3>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>POS gross</th>
                    <th>COD delivered</th>
                    <th>Gross</th>
                    <th>Refunds</th>
                    <th>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dailySales.map((row) => (
                    <tr key={row.date}>
                      <td>{row.date}</td>
                      <td>{money(row.posGross)}</td>
                      <td>{money(row.codGross)}</td>
                      <td>{money(row.gross)}</td>
                      <td>{money(row.refunds)}</td>
                      <td><strong>{money(row.net)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="report-two-column">
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Collections</p>
                  <h3>Payment method</h3>
                </div>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Method</th>
                      <th>Count</th>
                      <th>Collected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.paymentSplit.map((row) => (
                      <tr key={row.method}>
                        <td>{row.method.replaceAll("_", " ")}</td>
                        <td>{row.count}</td>
                        <td>{money(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">SKU performance</p>
                  <h3>Top-selling SKUs</h3>
                </div>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Qty</th>
                      <th>Gross</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.skuSales.slice(0, 20).map((row) => (
                      <tr key={row.productId}>
                        <td>
                          <strong>{row.sku}</strong>
                          <small>{row.name}</small>
                        </td>
                        <td>{row.quantity.toString()}</td>
                        <td>{money(row.gross)}</td>
                      </tr>
                    ))}
                    {data.skuSales.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="empty-cell">
                          No sales in this range.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        </>
      ) : null}

      <section className="report-two-column">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Inventory</p>
              <h3>Current low stock</h3>
            </div>
            <Link className="text-link" href="/inventory">
              Inventory
            </Link>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Location</th>
                  <th>SKU</th>
                  <th>Available</th>
                  <th>Minimum</th>
                </tr>
              </thead>
              <tbody>
                {data.lowStock.slice(0, 30).map((row) => (
                  <tr key={`${row.productId}-${row.locationId}`}>
                    <td>{row.locationCode}</td>
                    <td>
                      <strong>{row.sku}</strong>
                      <small>{row.productName}</small>
                    </td>
                    <td>{row.available.toString()}</td>
                    <td>{row.minimum.toString()}</td>
                  </tr>
                ))}
                {data.lowStock.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty-cell">
                      No low-stock rows.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Inventory value</p>
              <h3>Current physical stock</h3>
            </div>
          </div>
          <div className="report-value-list">
            {data.visibility.warehouseInventory ? (
              <div>
                <span>Warehouse</span>
                <strong>{money(data.warehouseStockValue)}</strong>
              </div>
            ) : null}
            <div>
              <span>Store</span>
              <strong>{money(data.storeStockValue)}</strong>
            </div>
            <div>
              <span>Inventory rows</span>
              <strong>{data.inventoryRows.length}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Ledger</p>
            <h3>Inventory movement history</h3>
          </div>
          <Link className="text-link" href="/inventory/movements">
            Full movement history
          </Link>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>SKU</th>
                <th>Location</th>
                <th>Movement</th>
                <th>Qty</th>
                <th>Actor</th>
              </tr>
            </thead>
            <tbody>
              {data.movements.slice(0, 30).map((movement) => (
                <tr key={movement.id}>
                  <td>{formatNepalDateTime(movement.createdAt)}</td>
                  <td>{movement.product.sku}</td>
                  <td>{movement.location.code}</td>
                  <td>{movement.type.replaceAll("_", " ")}</td>
                  <td>{movement.quantityDelta.toString()}</td>
                  <td>{movement.actor.name}</td>
                </tr>
              ))}
              {data.movements.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    No inventory movements in this range.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {data.visibility.transfers ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Transfers</p>
              <h3>Warehouse → store activity</h3>
            </div>
            <Link className="text-link" href="/transfers">
              Transfers
            </Link>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Transfer</th>
                  <th>Created</th>
                  <th>Route</th>
                  <th>Status</th>
                  <th>Items</th>
                </tr>
              </thead>
              <tbody>
                {data.transfers.map((transfer) => (
                  <tr key={transfer.id}>
                    <td>{transfer.transferNumber}</td>
                    <td>{formatNepalDateTime(transfer.createdAt)}</td>
                    <td>
                      {transfer.fromLocation.code} → {transfer.toLocation.code}
                    </td>
                    <td>{transfer.status}</td>
                    <td>{transfer.items.length}</td>
                  </tr>
                ))}
                {data.transfers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-cell">
                      No transfers in this range.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data.visibility.cod ? (
        <section className="report-two-column">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">COD</p>
                <h3>Order status</h3>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Orders</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.codStatus.map((row) => (
                    <tr key={row.status}>
                      <td>{row.status}</td>
                      <td>{row.count}</td>
                      <td>{money(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Collections</p>
                <h3>Pending COD</h3>
              </div>
            </div>
            <div className="report-value-list">
              <div>
                <span>Outstanding amount</span>
                <strong>{money(data.pendingCodAmount)}</strong>
              </div>
              <div>
                <span>Open collections</span>
                <strong>{data.pendingCodCount}</strong>
              </div>
            </div>
          </article>
        </section>
      ) : null}

      {data.visibility.cash ? (
        <section className="report-two-column">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Expenses</p>
                <h3>Cash expense history</h3>
              </div>
              <Link className="text-link" href="/cash">
                Cash ledger
              </Link>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Category</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.expenses.map((movement) => (
                    <tr key={movement.id}>
                      <td>{movement.operatingDate.toISOString().slice(0, 10)}</td>
                      <td>{movement.type.replaceAll("_", " ")}</td>
                      <td>{movement.category}</td>
                      <td>{money(movement.amount)}</td>
                    </tr>
                  ))}
                  {data.expenses.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="empty-cell">
                        No expenses in this range.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Reconciliation</p>
                <h3>Daily close / cash variance</h3>
              </div>
              <Link className="text-link" href="/daily-close">
                Daily close
              </Link>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Expected</th>
                    <th>Actual</th>
                    <th>Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dailyCloses.map((close) => (
                    <tr key={close.id}>
                      <td>{close.operatingDate.toISOString().slice(0, 10)}</td>
                      <td>{close.status}</td>
                      <td>{money(close.expectedCash)}</td>
                      <td>{money(close.actualCash)}</td>
                      <td>{money(close.variance)}</td>
                    </tr>
                  ))}
                  {data.dailyCloses.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="empty-cell">
                        No daily close records in this range.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      ) : null}

      {data.visibility.sales ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Returns</p>
              <h3>Refund history</h3>
            </div>
            <Link className="text-link" href="/returns">
              Returns
            </Link>
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
                </tr>
              </thead>
              <tbody>
                {data.returns.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <Link className="text-link" href={`/returns/${record.id}`}>
                        {record.returnNumber}
                      </Link>
                    </td>
                    <td>{formatNepalDateTime(record.completedAt)}</td>
                    <td>{record.sourceType}</td>
                    <td>{record.kind}</td>
                    <td>{money(record.refundAmount)}</td>
                  </tr>
                ))}
                {data.returns.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-cell">
                      No returns in this range.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data.visibility.customers ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Customers + loyalty</p>
              <h3>Customers who purchased in range</h3>
            </div>
            <Link className="text-link" href="/customers">
              Customer ledger
            </Link>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Purchases</th>
                  <th>POS</th>
                  <th>COD</th>
                  <th>Points</th>
                  <th>Remainder</th>
                </tr>
              </thead>
              <tbody>
                {data.customerHistory.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <Link
                        className="text-link"
                        href={`/customers/${customer.id}`}
                      >
                        {customer.name ?? customer.phoneDisplay}
                      </Link>
                      <small>{customer.phoneDisplay}</small>
                    </td>
                    <td>{customer.purchaseCount}</td>
                    <td>{money(customer.posValue)}</td>
                    <td>{money(customer.codValue)}</td>
                    <td>{customer.pointBalance}</td>
                    <td>{money(customer.spendRemainder)}</td>
                  </tr>
                ))}
                {data.customerHistory.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty-cell">
                      No identified customer purchases in this range.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
