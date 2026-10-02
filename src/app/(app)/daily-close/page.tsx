import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Role } from "@/generated/prisma/client";
import { closeOperatingDayAction } from "@/app/(app)/daily-close/actions";
import { requirePageRole } from "@/lib/auth/require-role";
import {
  getNepalOperatingDateKey,
} from "@/lib/time";
import {
  getDailyClosePage,
  getDailyClosePreview,
} from "@/modules/daily-close/daily-close.service";

const errors: Record<string, string> = {
  DAILY_CLOSE_ALREADY_EXISTS:
    "This operating date already has an active CLOSED record.",
  VARIANCE_NOTE_REQUIRED:
    "A non-zero cash variance requires an explanation note.",
  FUTURE_OPERATING_DATE:
    "A future operating date cannot be closed.",
  INVALID_DAILY_CLOSE:
    "Check the operating date, physical cash count and note.",
  DAILY_CLOSE_FAILED:
    "The daily close could not be completed.",
};

export const dynamic = "force-dynamic";

export default async function DailyClosePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; error?: string }>;
}) {
  await requirePageRole([Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const params = await searchParams;
  const operatingDate = params.date ?? getNepalOperatingDateKey();
  const [preview, history] = await Promise.all([
    getDailyClosePreview(operatingDate),
    getDailyClosePage(1, 30),
  ]);
  const s = preview.snapshot;

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Phase 8</p>
          <h2>Daily close</h2>
          <p className="muted">
            Reconcile the Pasalho Store physical drawer against system cash.
          </p>
        </div>
        <form method="get" className="date-filter-form">
          <input type="date" name="date" defaultValue={operatingDate} />
          <button className="secondary-light-button" type="submit">
            Preview date
          </button>
        </form>
      </header>

      {params.error ? (
        <p className="error-message" role="alert">
          {errors[params.error] ?? "Daily close failed."}
        </p>
      ) : null}

      {preview.activeClose ? (
        <p className="info-message">
          This day is already CLOSED.{" "}
          <Link
            className="text-link"
            href={`/daily-close/${preview.activeClose.id}`}
          >
            Open the persisted close
          </Link>
          .
        </p>
      ) : null}

      <section className="close-equation">
        <article className="summary-card">
          <span>Opening cash</span>
          <strong>Rs {s.openingCash.toFixed(2)}</strong>
        </article>
        <article className="summary-card">
          <span>Cash POS sales</span>
          <strong>+ Rs {s.cashPosSales.toFixed(2)}</strong>
        </article>
        <article className="summary-card">
          <span>COD collected</span>
          <strong>+ Rs {s.codCashCollected.toFixed(2)}</strong>
        </article>
        <article className="summary-card">
          <span>Cash added</span>
          <strong>+ Rs {s.cashAdded.toFixed(2)}</strong>
        </article>
        <article className="summary-card">
          <span>Cash refunds</span>
          <strong>− Rs {s.cashRefunds.toFixed(2)}</strong>
        </article>
        <article className="summary-card">
          <span>Expenses / payouts</span>
          <strong>− Rs {s.cashExpenses.toFixed(2)}</strong>
        </article>
      </section>

      <section className="panel close-total-panel">
        <div>
          <p className="eyebrow">System expected physical cash</p>
          <strong className="close-expected">
            Rs {s.expectedCash.toFixed(2)}
          </strong>
        </div>
        <div className="close-noncash">
          <span>QR / non-cash sales</span>
          <strong>Rs {s.qrNonCashSales.toFixed(2)}</strong>
          <small>Shown separately; never added to drawer cash.</small>
        </div>
        <div className="close-noncash">
          <span>Pending COD</span>
          <strong>Rs {s.pendingCodAmount.toFixed(2)}</strong>
          <small>Outstanding snapshot; not drawer cash.</small>
        </div>
      </section>

      {!preview.activeClose ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Physical count</p>
              <h3>Close {operatingDate}</h3>
            </div>
          </div>

          <form action={closeOperatingDayAction} className="form-grid">
            <input type="hidden" name="operatingDate" value={operatingDate} />
            <input
              type="hidden"
              name="idempotencyKey"
              value={randomUUID()}
            />
            <label>
              Actual physical cash (Rs)
              <input
                name="actualCash"
                inputMode="decimal"
                required
                placeholder={s.expectedCash.toFixed(2)}
              />
            </label>
            <label className="span-2">
              Variance note
              <textarea
                name="notes"
                maxLength={1000}
                placeholder="Required if actual cash differs from expected cash."
              />
            </label>
            <div className="form-actions span-2">
              <button className="primary-button" type="submit">
                Close operating day
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">History</p>
            <h3>Daily close records</h3>
          </div>
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
                <th>Closed by</th>
              </tr>
            </thead>
            <tbody>
              {history.closes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    No daily closes yet.
                  </td>
                </tr>
              ) : (
                history.closes.map((close) => (
                  <tr key={close.id}>
                    <td>
                      <Link
                        className="text-link"
                        href={`/daily-close/${close.id}`}
                      >
                        {close.operatingDate.toISOString().slice(0, 10)}
                      </Link>
                    </td>
                    <td>{close.status}</td>
                    <td>Rs {close.expectedCash.toFixed(2)}</td>
                    <td>Rs {close.actualCash.toFixed(2)}</td>
                    <td>Rs {close.variance.toFixed(2)}</td>
                    <td>{close.closedBy.name}</td>
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
