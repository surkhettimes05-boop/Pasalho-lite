# Pasalho Lite Launch Completion Audit

Audit date: 2026-11-19

## Scope and baseline

- Repository: `surkhettimes05-boop/Pasalho-lite`
- Branch audited: `codex/pasalho-lite-launch-completion`
- Baseline worktree: clean on `main` before work began
- No changes were made to the CEO Dashboard
- No production deployment was performed

## Architecture

The repository is a Next.js 16 modular monolith using TypeScript, Prisma 7, PostgreSQL, and React. It uses one application and one database. Redis, microservices, payment gateway APIs, automated WhatsApp, loyalty redemption, and a separate customer application are not present.

The authoritative modern-trade pricing integration is present for POS and COD quoting; it is server-to-server and blocks sale or order creation when unavailable or invalid.

## Database and migrations

The Prisma schema is valid. The repository contains 17 migrations from foundation through COD pricing. A fresh PostgreSQL database completed `prisma migrate deploy`, and the test seed completed successfully.

Main entities include:

- User, Session, Location
- Product, StockBalance, InventoryMovement
- Supplier, PurchaseReceipt, PurchaseReceiptItem
- Transfer, TransferItem
- Customer, LoyaltyAccount, LoyaltyTransaction
- Sale, SaleItem, Payment
- CustomerOrder, CustomerOrderItem, InventoryReservation
- ReturnRecord, ReturnItem
- CashMovement, DailyClose
- AuditLog
- ProductImportBatch
- CreatorAttributionOutbox

There is no PurchaseOrder or purchase-order-line entity. Batch/expiry entities and damaged-goods receive fields are absent.

## Authentication and authorization

Completed:

- Owner/Admin, Cashier/Store, and Warehouse/Staff roles
- Password hashing
- Database-backed sessions
- Server-side role checks in mutation services
- Active-user authentication
- Login rate limiting
- Audit coverage for privileged operations

## Operational module status

| Area | Status | Evidence |
|---|---|---|
| Products and SKUs | Implemented and verified | Unique SKU/barcode, activation, historical snapshots, bulk import |
| Supplier records | Partial | Supplier name, phone, notes, active status, and receiving linkage exist |
| Supplier product mapping | Missing | No supplier-product mapping model or UI |
| Purchase terms | Missing | Locked V1 specifications do not include supplier terms |
| Purchase orders | Missing | No PO model, status, lines, history, or approval flow |
| Goods receiving | Implemented and verified | Posted receipts, partial receipt quantities, unit costs, audit trail, idempotency |
| Damaged-goods receiving | Missing | No damaged quantity or damaged-stock movement fields |
| Batch/expiry | Missing | No batch or expiry fields |
| Warehouse stock | Implemented | Movement ledger, stock projection, moving average cost, reconciliation |
| Stock adjustments | Implemented | Owner/Admin-only movement with reason and audit |
| Stock count/reconciliation | Partial | Inventory reconciliation and ledger movement checks exist; no count workflow |
| Warehouse-to-store transfers | Implemented and verified | DRAFT/READY/DISPATCHED/RECEIVED/CANCELLED, discrepancies, replay protection |
| POS | Implemented and verified | Search/barcode, cart, stock checks, authoritative pricing, cash/QR payment, receipt |
| COGS | Implemented | Historical sale unit cost snapshot and moving-average cost support |
| Gross profit | Implemented in reporting/outbox logic | Line and sale reporting is based on sale and cost snapshots |
| COD orders | Implemented and verified | Reservation/dispatch/delivery lifecycle and replay protection |
| Cash movements | Implemented and verified | Opening, added, expense, payout, refund, other approved movements |
| Daily close | Implemented and verified | Server-calculated snapshot, physical count, variance, reopen authorization |
| Returns/refunds | Implemented and verified | Sale/COD return handling, restock, refund, loyalty reversal, idempotency |
| Reporting | Implemented | Sales, stock, COD, expenses, close and movement views exist |
| Audit history | Implemented | Append-only application audit log and transactional histories |
| CI | Implemented | Schema validation, migration, seed, tests, restore, E2E, build and boot smoke |

## Completed and broken audit findings

### Completed

- The end-to-end canonical flow passes against PostgreSQL
- Receiving increases stock exactly once and retries do not duplicate
- Transfer dispatch and receive are idempotent
- POS stock, payment, COGS snapshots, and loyalty are transactional
- COD reservation and dispatch preserve physical stock invariants
- Returns restore stock and reverse payment/loyalty atomically where applicable
- Cash movements and daily close are replay-safe
- Server-side role enforcement and audit logging exist
- 135 automated tests pass in a pristine serial run
- 17 migrations apply cleanly from an empty database

### Incomplete

- Supplier management is receipt-only and does not include product mapping or purchase terms
- Transfer UI does not expose separate source-warehouse/destination-store selectors; V1 is intentionally fixed to `WAREHOUSE_MAIN` and `STORE_MAIN`
- A formal physical stock-count workflow is not implemented
- Damaged receiving and batch/expiry tracking are not implemented
- Return UI and status handling should continue to be tested against operational edge cases
- Backup/restore scripts exist, but Docker-based local restore verification was not runnable in this environment

### Broken or not proven

- The default parallel Vitest run crashed one Windows worker during one pass, although a pristine serial run passed 135/135
- Local Docker tooling was unavailable, so GitHub Actions backup/restore and boot smoke stages were not reproduced locally
- There is no local evidence of a deployed staging environment or live hardware receipt/barcode test

## Scope blockers

The mandatory product documents state that V1 suppliers exist only to support receiving and that supplier purchasing details, purchase orders, and supplier payment/ledger features are outside the locked scope. The user’s supplier/PO extension is therefore intentionally not invented beyond that contract.

No purchase-order implementation was added because doing so would create an incompatible feature model while receiving remains the approved goods-entry transaction.

## CEO Dashboard

No CEO Dashboard files were changed or inspected as an implementation target. The existing dashboard routes outside this area remain unchanged.
