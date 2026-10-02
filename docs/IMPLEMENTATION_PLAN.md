# Pasalho Lite V1 — Implementation Plan

## Principle

Build vertical operating flows, not isolated screens.

Each phase should end with something testable against the database, not only UI.

## Phase 0 — Foundation

Build:

- Next.js + TypeScript project
- PostgreSQL
- Prisma
- environment validation
- authentication
- roles
- basic layout/navigation
- test framework
- CI for lint/typecheck/tests
- seed one warehouse and one store

Exit gate:

- app boots
- DB migration from empty database succeeds
- owner can log in
- unauthorized roles are rejected server-side
- CI is green

## Phase 1 — Products + inventory ledger

Build:

- Product
- Location
- StockBalance
- InventoryMovement
- product management UI
- inventory query
- inventory movement history
- admin adjustment flow

Exit gate:

- SKU/barcode uniqueness tested
- adjustment creates movement
- balance reconciles to movements
- no direct stock mutation path exists

## Phase 2 — Warehouse receiving

Build:

- Supplier
- PurchaseReceipt
- PurchaseReceiptItem
- receive-stock UI
- posting transaction
- idempotency

Exit gate:

- receive 100 -> warehouse 100
- retry -> remains 100
- ledger/projection agree

## Phase 3 — Warehouse → store transfer

Build:

- Transfer
- TransferItem
- DRAFT/READY/DISPATCHED/RECEIVED/CANCELLED
- transfer screens
- in-transit representation
- dispatch and receive idempotency

Exit gate:

- warehouse 100 → dispatch 20 = warehouse 80
- store remains unchanged until receive
- receive = store +20
- retries have zero duplicate effect

## Phase 4 — POS

Build:

- Sale
- SaleItem
- Payment
- POS cart
- barcode/search
- server-side pricing
- stock validation
- cash + QR/non-cash
- receipt
- finalize transaction/idempotency

Exit gate:

- store 20 → sell 3 → store 17
- exactly one payment
- exactly one inventory effect
- manipulated client total cannot alter server truth
- insufficient stock rejected

## Phase 5 — Customers + loyalty

Build:

- Customer
- normalized phone
- LoyaltyAccount
- LoyaltyTransaction
- customer lookup/create inside POS
- cumulative NPR 500 threshold
- spend remainder
- loyalty display

Exit gate:

- 300 + 250 spend = 1 point and NPR 50 remainder
- retry does not duplicate points
- ledger reconciles to balance

## Phase 6 — WhatsApp/phone COD orders

Build:

- CustomerOrder
- CustomerOrderItem
- InventoryReservation
- NEW → CONFIRMED → PACKED → DISPATCHED → DELIVERED
- cancellation before dispatch
- COD payment
- customer/order screens

Exit gate:

- confirmation reserves without physical deduction
- dispatch consumes reservation and deducts once
- delivery never deducts again
- delivery + payment posts loyalty once
- retries are idempotent

## Phase 7 — Returns/refunds

Build:

- Return
- ReturnItem
- POS original-sale lookup
- return quantity validation
- stock restore
- payment refund
- loyalty reversal
- post-dispatch COD return/recovery

Exit gate:

- no over-return
- stock restored only when physically accepted
- refund/loyalty/inventory effects are atomic
- retry-safe

## Phase 8 — Expenses + daily close

Build:

- CashMovement
- DailyClose
- opening cash
- expense/payout
- expected cash computation
- physical count
- variance
- close/reopen controls

Exit gate:

- canonical cash calculation passes
- duplicate close prevented
- reopen admin-only and audited

## Phase 9 — Dashboard + reports

Only after transactional truth works.

Build:

- today's sales
- payment split
- COD status
- low stock
- stock values
- open transfers
- expenses
- daily close variance
- basic SKU sales report
- movement history
- loyalty/customer history

Exit gate:

- dashboard totals reconcile to underlying records

## Phase 10 — Production hardening

Build/verify:

- production environment validation
- restricted access
- secure cookies/session
- rate limiting on login where practical
- request validation
- error handling
- structured logs
- DB backup
- restore procedure
- migration from empty DB
- migration against staging copy
- dependency audit
- printer/scanner tests
- seed/import procedure

Exit gate:

- full acceptance suite passes
- canonical end-to-end test passes
- backup restore proven
- no unresolved critical launch blocker

## UI build order

Build screens in this order:

1. Login
2. Dashboard shell/navigation
3. Products
4. Inventory
5. Receive Stock
6. Transfers
7. POS
8. Customers
9. Orders
10. Returns
11. Expenses
12. Daily Close
13. Reports
14. Users/Audit

## Rule for changes

Before accepting any new V1 feature ask:

1. Does it directly enable the locked one-warehouse/one-store operating flow?
2. Does it protect money, inventory, security, or legal correctness?
3. Does it solve a repeated real-store failure?

If all answers are no, defer it until after the first 30 days of live operation.
