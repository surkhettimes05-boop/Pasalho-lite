# Pasalho Lite V1 — Architecture Guardrails

## 1. System shape

Pasalho Lite is a modular monolith.

Logical shape:

Browser/PWA
→ Next.js application
→ server-side modules/services
→ Prisma
→ PostgreSQL

The modules share one database but must keep clear domain boundaries.

## 2. Suggested module boundaries

- auth
- users
- products
- customers
- inventory
- receiving
- transfers
- pos
- orders
- payments
- loyalty
- returns
- cash
- daily-close
- dashboard
- audit

These are code organization boundaries, not separate deployed services.

## 3. Mutation pattern

For high-risk operations:

1. authenticate
2. authorize
3. validate input
4. load server-side truth
5. validate current state
6. begin DB transaction
7. check idempotency
8. create immutable business records/ledger entries
9. update projections/state
10. write audit evidence when required
11. commit
12. return canonical result

Never trust a client-supplied total, balance, stock count, loyalty balance, or state transition.

## 4. Query pattern

Read endpoints should:

- read
- aggregate
- return

They should not create inventory, payment, loyalty, order-state, or audit-changing side effects merely because a page was opened.

## 5. Inventory pattern

InventoryMovement is the durable evidence of physical stock changes.

StockBalance is a projection.

Reservations affect reserved/available quantity but do not change physical onHand until the defined consuming action.

Required invariants:

- available = onHand - reserved
- active reservation quantity cannot exceed onHand under normal workflow
- physical movement effects are retry-safe
- movement ledger and projected balance reconcile

## 6. Loyalty pattern

LoyaltyTransaction is the durable evidence.

LoyaltyAccount is a projection with:

- pointBalance
- spendRemainder

All earning/reversal commands require a deterministic source reference/idempotency strategy.

## 7. Money pattern

Payment and CashMovement records represent money effects.

DailyClose is a reconciliation snapshot derived from those records and sales/orders for a defined operating date.

Do not use DailyClose as a replacement for underlying transaction history.

## 8. Database constraints

Use database constraints wherever possible for:

- unique SKU
- unique barcode when present
- unique normalized customer phone
- unique idempotency keys
- unique StockBalance per product/location
- unique LoyaltyAccount per customer
- controlled daily close uniqueness

Application validation alone is insufficient for concurrency protection.

## 9. Transaction isolation and concurrency

Critical stock operations must prevent overselling under concurrent requests.

Implementation may use:

- row locking
- conditional updates
- serializable/appropriate transaction isolation
- database constraints

The chosen mechanism must be covered by concurrency tests for POS and COD reservation/dispatch.

## 10. Error handling

Business errors should be explicit, such as:

- INSUFFICIENT_STOCK
- INVALID_STATE_TRANSITION
- DUPLICATE_OPERATION
- PRODUCT_INACTIVE
- RETURN_QUANTITY_EXCEEDED
- UNAUTHORIZED_ACTION
- DAILY_CLOSE_ALREADY_EXISTS

Do not expose raw database errors to staff.

## 11. Logging

Production logs should include:

- request/correlation id
- authenticated actor id where safe
- operation
- entity reference
- success/failure
- error category

Do not log passwords, secrets, full authentication tokens, or unnecessary sensitive customer data.

## 12. Backups

Before live launch:

- automated PostgreSQL backups must exist
- retention must be defined
- restore steps must be documented
- at least one restore test must succeed

A backup that has never been restored is not proven.

## 13. Deployment

Prefer one straightforward deployment target for the application and one managed PostgreSQL instance.

Production configuration must include:

- DATABASE_URL
- authentication/session secret
- public base URL
- environment indicator
- any optional printer/media configuration

No secret should be committed.

## 14. CI minimum

On every main change, run:

- dependency install
- Prisma validation
- typecheck
- lint
- unit tests
- integration tests where infrastructure permits
- production build

Migration validation should run against a clean database in CI or release verification.

## 15. Performance priorities

Optimize for:

- fast POS product lookup
- fast barcode lookup
- reliable sale finalization
- fast current-stock reads
- low-complexity daily close

Do not prematurely add caches or distributed infrastructure.

## 16. Future extensibility

Future multi-store growth should be supported by location IDs and clean domain logic, but V1 must not build multi-store orchestration UI or cross-store complexity before it is needed.

The architecture should make the next store possible without making the first store difficult.
