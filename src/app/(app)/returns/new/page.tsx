import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CustomerOrderStatus,
  PaymentStatus,
  ReturnSourceType,
  Role,
} from "@/generated/prisma/client";
import { processReturnAction } from "@/app/(app)/returns/actions";
import { requirePageRole } from "@/lib/auth/require-role";
import {
  getReturnSourceDetails,
} from "@/modules/returns/return.service";

const errors: Record<string, string> = {
  INVALID_RETURN_INPUT: "Select at least one valid return quantity and enter a reason.",
  RETURN_SOURCE_NOT_FOUND: "Original transaction was not found.",
  RETURN_LINE_NOT_FOUND: "One selected item does not belong to this transaction.",
  RETURN_QUANTITY_EXCEEDED: "Return quantity exceeds the remaining returnable quantity.",
  RETURN_PRICING_INTEGRITY_ERROR: "The original pricing cannot be safely prorated for this item return.",
  REFUND_AMOUNT_EXCEEDED: "Refund would exceed the original collected payment.",
  INVALID_PAYMENT_STATE: "This payment is not in a refundable state.",
  PAYMENT_INTEGRITY_ERROR: "The original payment failed an integrity check.",
  INVALID_RETURN_SOURCE_STATE: "This COD order is not eligible for this return flow.",
  UNUSUAL_REFUND_REQUIRES_ADMIN: "Cashiers can only refund goods that were physically returned.",
  RECOVERY_REQUIRES_PHYSICAL_RETURN: "Failed-delivery recovery requires the goods to be physically returned.",
  PARTIAL_RECOVERY_NOT_SUPPORTED: "V1 failed-delivery recovery must recover every remaining dispatched item.",
  IDEMPOTENCY_CONFLICT: "This return conflicts with an earlier request.",
  RETURN_OPERATION_FAILED: "The return could not be completed.",
};

export const dynamic = "force-dynamic";

export default async function NewReturnPage({
  searchParams,
}: {
  searchParams: Promise<{
    sourceType?: string;
    sourceId?: string;
    error?: string;
  }>;
}) {
  const user = await requirePageRole([Role.OWNER_ADMIN, Role.CASHIER_STORE]);
  const params = await searchParams;

  if (
    (params.sourceType !== ReturnSourceType.SALE &&
      params.sourceType !== ReturnSourceType.CUSTOMER_ORDER) ||
    !params.sourceId
  ) {
    notFound();
  }

  const details = await getReturnSourceDetails(
    params.sourceType,
    params.sourceId,
  ).catch(() => null);

  if (!details) notFound();

  const { source, payment, lines } = details;
  const isRecovery =
    source.sourceType === ReturnSourceType.CUSTOMER_ORDER &&
    source.status === CustomerOrderStatus.DISPATCHED &&
    payment.status === PaymentStatus.PENDING;

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">
            {isRecovery ? "COD recovery" : "Return / refund"}
          </p>
          <h2>{source.reference}</h2>
          <p className="muted">
            {source.sourceType.replaceAll("_", " ")} · Payment{" "}
            {payment.status} · Rs {payment.amount.toFixed(2)}
          </p>
        </div>
        <Link className="text-link" href="/returns">
          Back to returns
        </Link>
      </header>

      {params.error ? (
        <p className="error-message" role="alert">
          {errors[params.error] ?? "The return could not be completed."}
        </p>
      ) : null}

      {isRecovery ? (
        <p className="info-message">
          This order left the store but was not delivered/collected. Recovery
          must include every remaining dispatched item. Only physically accepted
          restock quantity will increase store stock; no refund or loyalty
          reversal is created because COD was never collected.
        </p>
      ) : (
        <p className="info-message">
          Refund amounts are calculated by the server from the historical line
          price. Delivery fees are not automatically refunded. Stock increases
          only by the accepted restock quantity.
        </p>
      )}

      <form action={processReturnAction} className="panel return-form">
        <input type="hidden" name="sourceType" value={source.sourceType} />
        <input type="hidden" name="sourceId" value={source.id} />
        <input
          type="hidden"
          name="idempotencyKey"
          value={randomUUID()}
        />
        <input type="hidden" name="lineCount" value={lines.length} />

        <div className="table-wrap">
          <table className="data-table return-entry-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Sold / sent</th>
                <th>Already returned</th>
                <th>Remaining</th>
                <th>Return now</th>
                <th>Physically returned</th>
                <th>Restock qty</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={line.id}>
                  <td>
                    <strong>{line.productNameSnapshot}</strong>
                    <small>{line.skuSnapshot}</small>
                    <input
                      type="hidden"
                      name={`originalLineId_${index}`}
                      value={line.id}
                    />
                  </td>
                  <td>{line.quantity.toString()}</td>
                  <td>{line.alreadyReturned.toString()}</td>
                  <td>{line.remainingQuantity.toString()}</td>
                  <td>
                    <input
                      className="table-input"
                      name={`quantity_${index}`}
                      defaultValue={
                        isRecovery ? line.remainingQuantity.toString() : "0"
                      }
                      inputMode="decimal"
                      disabled={!line.remainingQuantity.greaterThan(0)}
                    />
                  </td>
                  <td>
                    {user.role === Role.OWNER_ADMIN ? (
                      <input
                        type="checkbox"
                        name={`physicallyReturned_${index}`}
                        defaultChecked
                        disabled={!line.remainingQuantity.greaterThan(0)}
                      />
                    ) : (
                      <>
                        <input
                          type="checkbox"
                          checked
                          readOnly
                          disabled={!line.remainingQuantity.greaterThan(0)}
                        />
                        {line.remainingQuantity.greaterThan(0) ? (
                          <input
                            type="hidden"
                            name={`physicallyReturned_${index}`}
                            value="on"
                          />
                        ) : null}
                      </>
                    )}
                  </td>
                  <td>
                    <input
                      className="table-input"
                      name={`restockQuantity_${index}`}
                      defaultValue={
                        isRecovery ? line.remainingQuantity.toString() : "0"
                      }
                      inputMode="decimal"
                      disabled={!line.remainingQuantity.greaterThan(0)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <label>
          Reason
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={500}
            placeholder={
              isRecovery
                ? "Example: customer unavailable; goods returned to store"
                : "Why is this return/refund being processed?"
            }
          />
        </label>

        <div className="receive-submit">
          <p className="muted">
            {user.role === Role.OWNER_ADMIN
              ? "Owner/Admin may authorize refund without physical goods; such cases are audited and never restock stock."
              : "Cashier returns require physical goods. Set restock quantity to 0 when returned goods are damaged/non-sellable."}
          </p>
          <button className="primary-button" type="submit">
            {isRecovery ? "Complete recovery" : "Complete return + refund"}
          </button>
        </div>
      </form>
    </div>
  );
}
