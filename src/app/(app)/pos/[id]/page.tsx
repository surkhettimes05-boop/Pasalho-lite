import Link from "next/link";
import { notFound } from "next/navigation";
import { Role } from "@/generated/prisma/client";
import { PrintReceiptButton } from "@/components/print-receipt-button";
import { requirePageRole } from "@/lib/auth/require-role";
import { formatNepalDateTime } from "@/lib/time";
import { isLoyaltyEarningEnabled } from "@/modules/loyalty/loyalty.service";
import { getSaleById } from "@/modules/pos/pos.service";

export const dynamic = "force-dynamic";

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return `****${digits.slice(-4)}`;
}

function membershipTierLabel(tier: string | null) {
  if (tier === "FOUNDING_1000") return "Founding 1,000";
  if (tier === "REGISTERED_MEMBER") return "Registered member";
  return "No membership";
}

function membershipStatusLabel(status: string) {
  return status === "NOT_MEMBER" ? "not a member" : status.toLowerCase();
}

function promotionLabel(snapshot: unknown, reference: string | null) {
  if (
    snapshot &&
    typeof snapshot === "object" &&
    "name" in snapshot &&
    typeof snapshot.name === "string"
  ) {
    return snapshot.name;
  }
  return reference;
}

export default async function PosReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string }>;
}) {
  await requirePageRole([Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const { id } = await params;
  const query = await searchParams;
  const result = await getSaleById(id);
  const loyaltyEnabled = isLoyaltyEarningEnabled();

  if (!result || !result.payment) {
    notFound();
  }

  const { sale, payment, loyaltyTransaction } = result;

  return (
    <div className="page-stack receipt-page">
      <header className="page-header no-print">
        <div>
          <p className="eyebrow">POS receipt</p>
          <h2>{sale.receiptNumber}</h2>
        </div>
        <div className="receipt-actions">
          <Link
            className="text-link"
            href={`/returns/new?sourceType=SALE&sourceId=${sale.id}`}
          >
            Process return
          </Link>
          <Link className="text-link" href="/pos">
            New sale
          </Link>
          <PrintReceiptButton />
        </div>
      </header>

      {query.success === "finalized" ? (
        <p className="success-message no-print" role="status">
          Sale finalized, payment recorded, stock deducted
          {sale.customerId && loyaltyEnabled
            ? ", and loyalty updated."
            : "."}
        </p>
      ) : null}

      <section className="receipt-paper">
        <div className="receipt-brand">
          <p className="eyebrow">Pasalho</p>
          <h2>Sales Receipt</h2>
          <p>{sale.storeLocation.name}</p>
        </div>

        <div className="receipt-info">
          <div>
            <span>Receipt</span>
            <strong>{sale.receiptNumber}</strong>
          </div>
          <div>
            <span>Date</span>
            <strong>{formatNepalDateTime(sale.finalizedAt)}</strong>
          </div>
          <div>
            <span>Cashier</span>
            <strong>{sale.finalizedBy.name}</strong>
          </div>
          <div>
            <span>Customer</span>
            <strong>
              {sale.customer?.name ??
                (sale.customer ? maskPhone(sale.customer.phoneDisplay) : "Anonymous")}
            </strong>
            {sale.customer ? (
              <small>{maskPhone(sale.customer.phoneDisplay)}</small>
            ) : null}
          </div>
          {sale.customer ? (
            <div>
              <span>Membership</span>
              <strong>
                {membershipTierLabel(sale.membershipTierSnapshot)}
                {sale.membershipNumberSnapshot
                  ? ` · Membership #${sale.membershipNumberSnapshot}`
                  : ""}
              </strong>
              <small>
                {membershipStatusLabel(
                  sale.membershipStatusSnapshot ?? "NOT_MEMBER",
                )}
              </small>
            </div>
          ) : null}
          <div>
            <span>Currency</span>
            <strong>{sale.currency}</strong>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table receipt-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Regular unit</th>
                <th>Applied unit</th>
                <th>Saving</th>
                <th>Total</th>
                <th>Promotion</th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.productNameSnapshot}</strong>
                    <small>{item.skuSnapshot}</small>
                  </td>
                  <td>{item.quantity.toString()}</td>
                  <td>
                    Rs {(item.regularUnitPrice ?? item.unitPrice).toFixed(2)}
                  </td>
                  <td>
                    Rs {(item.appliedUnitPrice ?? item.unitPrice).toFixed(2)}
                  </td>
                  <td>Rs {item.discountAmount.toFixed(2)}</td>
                  <td>
                    Rs {item.lineTotal.sub(item.discountAmount).toFixed(2)}
                  </td>
                  <td>
                    {promotionLabel(
                      item.promotionSnapshot,
                      item.promotionReference,
                    ) ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="receipt-totals">
          <div>
            <span>Subtotal</span>
            <strong>Rs {sale.subtotal.toFixed(2)}</strong>
          </div>
          <div>
            <span>Discount</span>
            <strong>Rs {sale.discountTotal.toFixed(2)}</strong>
          </div>
          <div className="receipt-total">
            <span>Final amount</span>
            <strong>Rs {sale.total.toFixed(2)}</strong>
          </div>
          <div>
            <span>Final amount paid</span>
            <strong>Rs {payment.amount.toFixed(2)}</strong>
          </div>
          <div>
            <span>Payment</span>
            <strong>{payment.method.replaceAll("_", " ")}</strong>
          </div>
          <div>
            <span>Payment status</span>
            <strong>{payment.status}</strong>
          </div>
          {loyaltyTransaction ? (
            <div>
              <span>Loyalty earned</span>
              <strong>+{loyaltyTransaction.pointsDelta} point(s)</strong>
            </div>
          ) : null}
        </div>

        {sale.customer?.loyaltyAccount ? (
          <p className="receipt-loyalty-note">
            {loyaltyEnabled
              ? `Current loyalty: ${sale.customer.loyaltyAccount.pointBalance} point(s) · Rs ${sale.customer.loyaltyAccount.spendRemainder.toFixed(2)} carried toward the next point.`
              : "Historical loyalty points are preserved in read-only form; new earning is disabled under the launch cutover."}
          </p>
        ) : null}

        <p className="receipt-footer">
          Thank you for shopping at Pasalho.
        </p>
      </section>
    </div>
  );
}
