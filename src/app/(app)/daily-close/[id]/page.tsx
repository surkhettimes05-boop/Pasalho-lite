import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DailyCloseStatus, Role } from "@/generated/prisma/client";
import { reopenDailyCloseAction } from "@/app/(app)/daily-close/actions";
import { requirePageRole } from "@/lib/auth/require-role";
import { formatNepalDateTime } from "@/lib/time";
import { getDailyCloseById } from "@/modules/daily-close/daily-close.service";

const errors: Record<string, string> = {
  DAILY_CLOSE_NOT_FOUND: "Daily close was not found.",
  DAILY_CLOSE_ALREADY_REOPENED: "This close has already been reopened.",
  DAILY_CLOSE_FAILED: "The close operation failed.",
};

export const dynamic = "force-dynamic";

export default async function DailyCloseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const user = await requirePageRole([Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const { id } = await params;
  const query = await searchParams;
  const close = await getDailyCloseById(id);

  if (!close) notFound();

  const dateKey = close.operatingDate.toISOString().slice(0, 10);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Daily close</p>
          <h2>{dateKey}</h2>
          <p className="muted">
            {close.status} · closed {formatNepalDateTime(close.closedAt)}
          </p>
        </div>
        <Link className="text-link" href={`/daily-close?date=${dateKey}`}>
          Back to daily close
        </Link>
      </header>

      {query.error ? (
        <p className="error-message" role="alert">
          {errors[query.error] ?? "Daily close operation failed."}
        </p>
      ) : null}
      {query.success === "closed" ? (
        <p className="success-message" role="status">
          Operating day closed and cash snapshot persisted.
        </p>
      ) : null}
      {query.success === "reopened" ? (
        <p className="success-message" role="status">
          Close reopened. Its original snapshot remains preserved; a later
          re-close will create a new CLOSED record.
        </p>
      ) : null}

      <section className="summary-grid">
        <article className="summary-card">
          <span>Expected</span>
          <strong>Rs {close.expectedCash.toFixed(2)}</strong>
        </article>
        <article className="summary-card">
          <span>Actual</span>
          <strong>Rs {close.actualCash.toFixed(2)}</strong>
        </article>
        <article className="summary-card">
          <span>Variance</span>
          <strong>Rs {close.variance.toFixed(2)}</strong>
        </article>
      </section>

      <section className="panel">
        <div className="close-breakdown">
          <div><span>Opening cash</span><strong>Rs {close.openingCash.toFixed(2)}</strong></div>
          <div><span>Cash POS sales</span><strong>Rs {close.cashPosSales.toFixed(2)}</strong></div>
          <div><span>COD cash collected</span><strong>Rs {close.codCashCollected.toFixed(2)}</strong></div>
          <div><span>Cash added</span><strong>Rs {close.cashAdded.toFixed(2)}</strong></div>
          <div><span>Cash refunds</span><strong>Rs {close.cashRefunds.toFixed(2)}</strong></div>
          <div><span>Cash expenses / payouts</span><strong>Rs {close.cashExpenses.toFixed(2)}</strong></div>
          <div><span>QR / non-cash sales</span><strong>Rs {close.qrNonCashSales.toFixed(2)}</strong></div>
          <div><span>Pending COD</span><strong>Rs {close.pendingCodAmount.toFixed(2)}</strong></div>
        </div>

        <div className="return-reason">
          <span>Close note</span>
          <strong>{close.notes ?? "No variance note required."}</strong>
          <small>Closed by {close.closedBy.name}</small>
        </div>

        {close.status === DailyCloseStatus.REOPENED ? (
          <div className="return-reason">
            <span>Reopened</span>
            <strong>
              {close.reopenedAt
                ? formatNepalDateTime(close.reopenedAt)
                : "—"}
            </strong>
            <small>{close.reopenedBy?.name ?? "—"}</small>
          </div>
        ) : null}
      </section>

      {user.role === Role.OWNER_ADMIN &&
      close.status === DailyCloseStatus.CLOSED ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Owner/Admin only</p>
              <h3>Reopen operating day</h3>
              <p className="muted">
                Reopening preserves this close as history and permits new cash
                activity before a new close is created.
              </p>
            </div>
          </div>
          <form action={reopenDailyCloseAction} className="form-grid">
            <input type="hidden" name="closeId" value={close.id} />
            <input
              type="hidden"
              name="idempotencyKey"
              value={randomUUID()}
            />
            <label className="span-2">
              Reopen reason
              <input
                name="reason"
                required
                minLength={3}
                maxLength={500}
                placeholder="Why must this closed day be reopened?"
              />
            </label>
            <div className="form-actions span-2">
              <button className="secondary-light-button" type="submit">
                Reopen day
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
