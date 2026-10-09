import Link from "next/link";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { getNepalOperatingDateKey } from "@/lib/time";
import { getDashboardReport } from "@/modules/reports/report.service";

export const dynamic = "force-dynamic";

function money(value: { toString: () => string }) {
  const numeric = Number(value.toString());
  return Number.isFinite(numeric)
    ? `Rs ${numeric.toFixed(2)}`
    : `Rs ${value.toString()}`;
}

export default async function DashboardPage() {
  const user = await requireCurrentUser();
  const today = getNepalOperatingDateKey();
  const report = await getDashboardReport(user.role, today);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h2>Operations dashboard</h2>
          <p className="muted">
            Live operating summary for {today}.
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
            <small>After completed refunds</small>
          </article>
          <article className="summary-card">
            <span>POS sales</span>
            <strong>{money(report.posSalesValue)}</strong>
            <small>{String(report.posSalesCount)} finalized receipt(s)</small>
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
            <span>Pending COD</span>
            <strong>{money(report.codPendingAmount)}</strong>
            <small>{String(report.openCodCount)} open order(s)</small>
          </article>
        </section>
      ) : null}

      <section className="summary-grid">
        {report.visibility.cash ? (
          <>
            <article className="summary-card">
              <span>Expected drawer cash</span>
              <strong>{money(report.expectedCash)}</strong>
              <small>Expected cash position today</small>
            </article>
            <article className="summary-card">
              <span>Expenses today</span>
              <strong>{money(report.expensesToday)}</strong>
              <small>Recorded cash outflow</small>
            </article>
          </>
        ) : null}

        {report.visibility.warehouseInventory ? (
          <article className="summary-card">
            <span>Warehouse stock value</span>
            <strong>{money(report.warehouseStockValue)}</strong>
            <small>Current on-hand value</small>
          </article>
        ) : null}

        {report.visibility.storeInventory ? (
          <article className="summary-card">
            <span>Store stock value</span>
            <strong>{money(report.storeStockValue)}</strong>
            <small>Current on-hand value</small>
          </article>
        ) : null}

        <article className="summary-card">
          <span>Low-stock rows</span>
          <strong>{String(report.lowStockCount)}</strong>
          <small>Available at or below minimum</small>
        </article>

        {report.visibility.transfers ? (
          <article className="summary-card">
            <span>Open transfers</span>
            <strong>{String(report.openTransferCount)}</strong>
            <small>Draft, ready or dispatched</small>
          </article>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Quick actions</p>
            <h3>Continue operations</h3>
            <p className="muted">
              Open the operational screen you need. Detailed tables remain available
              in their dedicated modules and reports.
            </p>
          </div>
        </div>
        <div className="action-row">
          <Link className="primary-button" href="/pos">
            Open POS
          </Link>
          <Link className="secondary-light-button" href="/inventory">
            Inventory
          </Link>
          <Link className="secondary-light-button" href="/orders">
            Orders
          </Link>
          <Link className="secondary-light-button" href="/transfers">
            Transfers
          </Link>
          <Link className="secondary-light-button" href="/daily-close">
            Daily Close
          </Link>
        </div>
      </section>
    </div>
  );
}
