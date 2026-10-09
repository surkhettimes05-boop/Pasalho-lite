import { requireCurrentUser } from "@/lib/auth/current-user";
import { getNepalOperatingDateKey } from "@/lib/time";
import { getDashboardReport } from "@/modules/reports/report.service";

export const dynamic = "force-dynamic";

function safeMoney(value: { toString: () => string }) {
  const numeric = Number(value.toString());
  return Number.isFinite(numeric) ? `Rs ${numeric.toFixed(2)}` : value.toString();
}

export default async function DashboardDebugPage() {
  const user = await requireCurrentUser();
  const today = getNepalOperatingDateKey();
  const report = await getDashboardReport(user.role, today);

  return (
    <div className="page-stack">
      <h2>Dashboard render diagnostic OK</h2>
      <p>Date: {today}</p>
      <p>Gross sales: {safeMoney(report.grossSales)}</p>
      <p>Net sales: {safeMoney(report.netSales)}</p>
      <p>Cash collected: {safeMoney(report.cashCollected)}</p>
      <p>Low-stock rows: {String(report.lowStockCount)}</p>
      <p>Open transfers: {String(report.openTransferCount)}</p>
      <p>Open COD orders: {String(report.openCodCount)}</p>
    </div>
  );
}
