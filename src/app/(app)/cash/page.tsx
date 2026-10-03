import { randomUUID } from "node:crypto";
import {
  CashMovementEffect,
  CashMovementType,
  Role,
} from "@/generated/prisma/client";
import { recordCashMovementAction } from "@/app/(app)/cash/actions";
import { requirePageRole } from "@/lib/auth/require-role";
import {
  formatNepalDateTime,
  getNepalOperatingDateKey,
} from "@/lib/time";
import { getCashMovementPage } from "@/modules/cash/cash.service";

const errors: Record<string, string> = {
  CASH_DAY_CLOSED:
    "This operating day is closed. Owner/Admin must reopen it before recording more cash activity.",
  OPENING_CASH_ALREADY_EXISTS:
    "Opening cash is already recorded for this operating day.",
  FUTURE_OPERATING_DATE:
    "Cash activity cannot be recorded for a future operating date.",
  CASH_EFFECT_REQUIRED:
    "OTHER APPROVED requires an IN or OUT cash direction.",
  IDEMPOTENCY_CONFLICT:
    "This cash command conflicts with an earlier request.",
  INVALID_CASH_MOVEMENT:
    "Check amount, category, reason, date and cash type.",
  CASH_MOVEMENT_FAILED:
    "The cash movement could not be recorded.",
};

export const dynamic = "force-dynamic";

export default async function CashPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string;
    error?: string;
    success?: string;
  }>;
}) {
  await requirePageRole([Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const params = await searchParams;
  const operatingDate = params.date ?? getNepalOperatingDateKey();
  const history = await getCashMovementPage({
    operatingDate,
    page: 1,
    pageSize: 100,
  });

  const inflow = history.movements
    .filter((movement) => movement.effect === CashMovementEffect.IN)
    .reduce((sum, movement) => sum + Number(movement.amount), 0);
  const outflow = history.movements
    .filter((movement) => movement.effect === CashMovementEffect.OUT)
    .reduce((sum, movement) => sum + Number(movement.amount), 0);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Finance</p>
          <h2>Expenses & cash movements</h2>
          <p className="muted">
            Append-only drawer movements used by daily reconciliation.
          </p>
        </div>
        <span className="status-badge">{operatingDate}</span>
      </header>

      {params.error ? (
        <p className="error-message" role="alert">
          {errors[params.error] ?? "Cash movement failed."}
        </p>
      ) : null}
      {params.success === "recorded" ? (
        <p className="success-message" role="status">
          Cash movement recorded.
        </p>
      ) : null}

      <section className="summary-grid">
        <article className="summary-card">
          <span>Manual/system cash in</span>
          <strong>Rs {inflow.toFixed(2)}</strong>
          <small>Includes opening cash and approved additions</small>
        </article>
        <article className="summary-card">
          <span>Cash out</span>
          <strong>Rs {outflow.toFixed(2)}</strong>
          <small>Expenses, payouts and system refund cash-out</small>
        </article>
        <article className="summary-card">
          <span>Ledger entries</span>
          <strong>{history.total}</strong>
          <small>Immutable after posting</small>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Record</p>
            <h3>Cash movement</h3>
          </div>
        </div>

        <form action={recordCashMovementAction} className="form-grid">
          <input
            type="hidden"
            name="idempotencyKey"
            value={randomUUID()}
          />
          <label>
            Operating date
            <input
              type="date"
              name="operatingDate"
              defaultValue={operatingDate}
              required
            />
          </label>
          <label>
            Type
            <select name="type" defaultValue={CashMovementType.EXPENSE}>
              <option value={CashMovementType.OPENING_CASH}>Opening cash</option>
              <option value={CashMovementType.CASH_ADDED}>Cash added</option>
              <option value={CashMovementType.EXPENSE}>Expense</option>
              <option value={CashMovementType.CASH_PAYOUT}>Cash payout</option>
              <option value={CashMovementType.OTHER_APPROVED}>
                Other approved
              </option>
            </select>
          </label>
          <label>
            Direction
            <select name="effect" defaultValue={CashMovementEffect.OUT}>
              <option value={CashMovementEffect.OUT}>OUT</option>
              <option value={CashMovementEffect.IN}>IN</option>
            </select>
            <small>
              Used only for OTHER APPROVED; standard types have a fixed direction.
            </small>
          </label>
          <label>
            Amount (Rs)
            <input
              name="amount"
              inputMode="decimal"
              placeholder="0.00"
              required
            />
          </label>
          <label>
            Category
            <input
              name="category"
              placeholder="Rent, tea, transport, petty cash..."
              required
              maxLength={100}
            />
          </label>
          <label className="span-2">
            Reason
            <input
              name="reason"
              placeholder="Why did cash move?"
              required
              maxLength={500}
            />
          </label>
          <div className="form-actions span-2">
            <button className="primary-button" type="submit">
              Record cash movement
            </button>
          </div>
        </form>

        <p className="pos-phase-note">
          Refund cash-out is generated automatically by the Returns workflow.
          Do not record the same refund again here.
        </p>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Ledger</p>
            <h3>{operatingDate}</h3>
          </div>
          <form method="get" className="date-filter-form">
            <input type="date" name="date" defaultValue={operatingDate} />
            <button className="secondary-light-button" type="submit">
              View date
            </button>
          </form>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Direction</th>
                <th>Amount</th>
                <th>Category</th>
                <th>Reason</th>
                <th>User</th>
              </tr>
            </thead>
            <tbody>
              {history.movements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    No cash movements for this operating date.
                  </td>
                </tr>
              ) : (
                history.movements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{formatNepalDateTime(movement.createdAt)}</td>
                    <td>{movement.type.replaceAll("_", " ")}</td>
                    <td>{movement.effect}</td>
                    <td>Rs {movement.amount.toFixed(2)}</td>
                    <td>{movement.category}</td>
                    <td>
                      {movement.reason}
                      {movement.referenceId ? (
                        <small>
                          {movement.referenceType} · {movement.referenceId}
                        </small>
                      ) : null}
                    </td>
                    <td>{movement.user.name}</td>
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
