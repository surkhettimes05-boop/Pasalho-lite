import Link from "next/link";
import { Role } from "@/generated/prisma/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { formatNepalDateTime, getNepalOperatingDateKey } from "@/lib/time";
import { getDashboardReport } from "@/modules/reports/report.service";

export const dynamic = "force-dynamic";

function money(value: { toFixed: (digits: number) => string }) {
  return `Rs ${value.toFixed(2)}`;
}

export default async function DashboardPage() {
  const user = await requireCurrentUser();
  const today = getNepalOperatingDateKey();
  const report = await getDashboardReport(user.role, today);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Phase 9</p>
          <h2>Operations dashboard</h2>
          <p className="muted">
            Live read-only view from Pasalho&apos;s transaction records for{" "}
            {today}.
          </p>
        </div>
        <Link className="secondary-light-button" href="/reports">
          Open reports
        </Link>
      </header>

      {report.visibility.sales ? (
        <section className="summary-grid dashboard-kpis">
          <article className="summary-card">
            <span>Gross sales today</span>
            <strong>{money(report.grossSales)}</strong>
            <small>POS finalized + COD delivered</small>
          </article>
          <article className="summary-card">
            <span>Net sales today</span>
            <strong>{money(report.netSales)}</strong>
            <small>Gross sales − completed refunds</small>
          </article>
          <article className="summary-card">
            <span>POS sales</span>
            <strong>{money(report.posSalesValue)}</strong>
            <small>{report.posSalesCount} finalized receipt(s)</small>
          </article>
          <article className="summary-card">
            <span>COD delivered</span>
            <strong>{money(report.codDeliveredValue)}</strong>
            <small>Delivered today</small>
          </article>
          <article className="summary-card">
            <span>Cash collected</span>
            <strong>{money(report.cashCollected)}</strong>
            <small>Cash POS + COD collections</small>
          </article>
          <article className="summary-card">
            <span>QR / non-cash</span>
            <strong>{money(report.qrCollected)}</strong>
            <small>Collected today, outside drawer cash</small>
          </article>
          <article className="summary-card">
            <span>Returns / refunds</span>
            <strong>{money(report.refunds)}</strong>
            <small>Completed refund value today</small>
          </article>
          <article className="summary-card">
            <span>Pending COD</span>
            <strong>{money(report.codPendingAmount)}</strong>
            <small>{report.openCodCount} open order(s)</small>
          </article>
        </section>
      ) : null}

      {report.visibility.cash ? (
        <section className="summary-grid">
          <article className="summary-card">
            <span>Expected drawer cash</span>
            <strong>{money(report.expectedCash)}</strong>
            <small>Current Phase 8 close formula</small>
          </article>
          <article className="summary-card">
            <span>Expenses today</span>
            <strong>{money(report.expensesToday)}</strong>
            <small>Expenses, payouts and approved cash-out</small>
          </article>
          <article className="summary-card">
            <span>Latest cash variance</span>
            <strong>
              {report.latestDailyClose
                ? money(report.latestDailyClose.variance)
                : "No close yet"}
            </strong>
            <small>
              {report.latestDailyClose
                ? `${report.latestDailyClose.operatingDate
                    .toISOString()
                    .slice(0, 10)} · ${report.latestDailyClose.status}`
                : "Daily close history is empty"}
            </small>
          </article>
        </section>
      ) : null}

      <section className="summary-grid">
        {report.visibility.warehouseInventory ? (
          <article className="summary-card">
            <span>Warehouse stock value</span>
            <strong>{money(report.warehouseStockValue)}</strong>
            <small>Physical on-hand × current cost price</small>
          </article>
        ) : null}
        {report.visibility.storeInventory ? (
          <article className="summary-card">
            <span>Store stock value</span>
            <strong>{money(report.storeStockValue)}</strong>
            <small>Physical on-hand × current cost price</small>
          </article>
        ) : null}
        <article className="summary-card">
          <span>Low-stock rows</span>
          <strong>{report.lowStockCount}</strong>
          <small>Available ≤ configured minimum</small>
        </article>
        {report.visibility.transfers ? (
          <article className="summary-card">
            <span>Open transfers</span>
            <strong>{report.openTransferCount}</strong>
            <small>Draft, ready or dispatched</small>
          </article>
        ) : null}
      </section>

      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Inventory attention</p>
              <h3>Low stock</h3>
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
                {report.lowStock.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty-cell">
                      No low-stock rows.
                    </td>
                  </tr>
                ) : (
                  report.lowStock.map((row) => (
                    <tr key={`${row.productId}-${row.locationId}`}>
                      <td>{row.locationCode}</td>
                      <td>
                        <strong>{row.sku}</strong>
                        <small>{row.productName}</small>
                      </td>
                      <td>{row.available.toString()}</td>
                      <td>{row.minimum.toString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>

        {report.visibility.cod ? (
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Fulfillment</p>
                <h3>Open COD orders</h3>
              </div>
              <Link className="text-link" href="/orders">
                Orders
              </Link>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Status</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {report.openCodOrders.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="empty-cell">
                        No open COD orders.
                      </td>
                    </tr>
                  ) : (
                    report.openCodOrders.map((order) => (
                      <tr key={order.id}>
                        <td>
                          <Link className="text-link" href={`/orders/${order.id}`}>
                            {order.orderNumber}
                          </Link>
                        </td>
                        <td>
                          {order.customer.name ?? order.customer.phoneDisplay}
                        </td>
                        <td>{order.status}</td>
                        <td>{money(order.total)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </article>
        ) : null}

        {report.visibility.transfers ? (
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Warehouse flow</p>
                <h3>Open transfers</h3>
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
                    <th>Route</th>
                    <th>Status</th>
                    <th>Items</th>
                  </tr>
                </thead>
                <tbody>
                  {report.openTransfers.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="empty-cell">
                        No open transfers.
                      </td>
                    </tr>
                  ) : (
                    report.openTransfers.map((transfer) => (
                      <tr key={transfer.id}>
                        <td>{transfer.transferNumber}</td>
                        <td>
                          {transfer.fromLocation.code} → {transfer.toLocation.code}
                        </td>
                        <td>{transfer.status}</td>
                        <td>{transfer.items.length}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </article>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Reporting</p>
            <h3>Need the detail behind these numbers?</h3>
            <p className="muted">
              Daily sales, payment split, SKU sales, inventory, movements,
              transfers, COD, returns, cash variance, expenses and customers.
            </p>
          </div>
          <Link className="primary-button" href="/reports">
            View reports
          </Link>
        </div>
      </section>
    </div>
  );
}
