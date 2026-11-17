# Creator Attribution POS Integration

Pasalho Lite remains the source of truth for physical POS sales, payment collection, customer identity and returns. It does not calculate creator rewards.

## Approved integration
- A finalized, paid POS sale with an identified customer writes one `CreatorAttributionOutbox` row in the same Prisma transaction as sale/payment/inventory/loyalty.
- Anonymous sales do not create an outbox event.
- Outbox event key is stable: `pos-sale:<sale UUID>`.
- Payload contains POS sale ID, receipt number, normalized customer phone hash, eligible merchandise spend (NPR), finalized timestamp and schema version. Do not include customer name or raw phone.
- A background/dispatch action sends the event to the central commerce attribution endpoint over HTTPS with HMAC-SHA256 request signing.
- Delivery is at-least-once; central commerce API deduplicates by source system + transaction ID.
- Failed delivery increments attempt count and schedules exponential retry. It must never roll back or block a finalized POS sale.
- Returns/reversals are **not implemented in this PR**. Do not approve or settle creator rewards for returned/refunded sales until a separate signed return-adjustment outbox and central reward-reversal flow is shipped.
- The outbox is operational integration evidence, not a second reward ledger.

## Required configuration
- `CREATOR_ATTRIBUTION_API_URL`
- `CREATOR_ATTRIBUTION_HMAC_SECRET`

If either is missing, POS sales continue normally and outbox events remain pending with an explicit operational warning. Do not log the secret or customer identifiers.

## Acceptance tests
- Customer sale creates exactly one outbox row in the sale transaction.
- Anonymous sale creates none.
- Sale replay creates no duplicate outbox row.
- Commerce API timeout does not fail POS sale.
- Retry sends same event key and payload.
- Server rejects invalid HMAC, stale timestamp and altered payload.
- Refund/reversal handling is a required follow-up acceptance gate before creator reward settlement is enabled in production.

## POS COGS evidence

POS COGS is calculated from the store location's moving weighted-average unit cost at the time of sale. Purchase receipts update the warehouse average; dispatch snapshots that average onto each transfer item; receiving updates the store average. The POS sale snapshots the store average onto each sale item and multiplies it by quantity.

If any sold item has no verified location average cost, the outbox sends `costEvidenceStatus: "MISSING_COST"` and a null cost. The central profitability dashboard must not infer cost from the product's catalog `costPrice`.
