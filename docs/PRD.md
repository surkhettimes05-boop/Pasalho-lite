# Pasalho Lite V1 — Product Requirements Document

## 1. Document purpose

This document defines the complete V1 product requirements for Pasalho Lite.

Pasalho Lite is the operating system for Pasalho's first physical retail operation. It is intentionally smaller than the earlier Pasalho platform and exists to reliably run one warehouse, one store, POS sales, WhatsApp/phone COD orders, inventory, loyalty, and daily reconciliation.

This PRD is the source of truth for V1 scope. If a proposed feature is not required to run the flows in this document, it is out of scope unless it fixes a legal, security, financial, inventory-integrity, or launch-blocking issue.

## 2. Product objective

Enable Pasalho to run daily retail operations with one system of record for:

- products and SKUs
- warehouse stock
- store stock
- warehouse receiving
- warehouse-to-store transfers
- POS sales
- customers
- loyalty points
- WhatsApp/phone COD orders
- payments
- returns/cancellations
- expenses/cash movements
- daily cash reconciliation
- users and audit history

The product must prioritize operational correctness over feature breadth.

## 3. V1 operating model

Pasalho Lite supports:

- 1 central warehouse
- 1 physical retail store
- 1 primary store POS operation
- warehouse staff
- store/cashier staff
- owner/admin
- manual WhatsApp/phone order capture
- COD order fulfillment
- cash and QR/non-cash payment recording
- phone-number-based customer identification
- loyalty earning

Future multi-store support may be architecturally possible, but V1 workflows and UI are optimized for one warehouse and one store.

## 4. Architecture constraints

V1 must remain a modular monolith:

- one repository
- one Next.js + TypeScript application
- one API/backend surface
- one PostgreSQL database
- Prisma ORM
- one deployment
- one source of truth

Do not introduce:

- microservices
- Redis unless a proven launch-blocking need appears
- event buses
- a separate commerce backend
- a separate loyalty backend
- a customer mobile app
- a separate customer website checkout engine
- cross-system synchronization
- external workflow engines

## 5. Users

### 5.1 Owner / Admin

Needs to:

- see daily business performance
- control products and pricing
- receive stock
- inspect warehouse/store inventory
- approve or perform adjustments
- create/manage users
- review transfers
- review POS sales
- review COD orders
- review loyalty activity
- review expenses
- close or reopen operating days when authorized
- inspect audit history

### 5.2 Cashier / Store Staff

Needs to:

- search or scan products
- add/remove cart items
- identify customer by phone number
- complete POS sales
- accept cash or QR/non-cash payments
- capture WhatsApp/phone COD orders
- update allowed order fulfillment states
- view store stock
- perform daily cash count
- view their own operational history

### 5.3 Warehouse Staff

Needs to:

- receive supplier stock
- see warehouse stock
- create/prepare transfers to store
- dispatch transfers
- record transfer discrepancies when allowed
- view inventory movements relevant to warehouse activity

## 6. Core product modules

### 6.1 Dashboard

The dashboard should answer, at minimum:

- today's gross sales
- today's net sales
- today's POS sales count
- today's COD delivered value
- cash collected today
- QR/non-cash collected today
- COD still pending
- today's returns/refunds
- today's expenses
- current expected cash
- latest cash variance
- warehouse stock value
- store stock value
- low-stock products
- open transfers
- open COD orders

Dashboard numbers must come from transactional records, not manually maintained summary fields.

### 6.2 Product management

Each product/SKU requires:

- internal SKU
- barcode, optional but strongly encouraged
- product name
- category
- unit of measure
- cost price
- selling price
- optional MRP
- warehouse minimum stock
- store minimum stock
- active/inactive status
- created/updated metadata

Product rules:

- SKU must be unique.
- Barcode, when present, must be unique.
- Inactive products cannot be sold in new POS sales or new orders.
- Historical transactions must continue to display inactive products.
- Selling price cannot be negative.
- Cost price cannot be negative.
- Price changes must not rewrite historical sale prices.

### 6.3 Warehouse receiving

Receiving must:

- record supplier/reference information
- record receipt date/time
- record received items and quantities
- record unit cost
- create warehouse inventory movements
- update warehouse stock projection
- record receiving user
- support notes
- prevent duplicate receipt posting when the same receipt action is retried

A posted receipt must not be editable in a way that silently changes inventory. Corrections should occur through a reversal/adjustment mechanism with an audit trail.

### 6.4 Warehouse inventory

Warehouse inventory must show:

- SKU
- product name
- on-hand quantity
- reserved quantity if V1 uses warehouse reservations
- available quantity
- average/latest cost as defined by implementation
- stock value
- low-stock state
- recent movements

Manual stock corrections require:

- adjustment type
- quantity
- reason
- user
- timestamp

Every correction creates an inventory movement.

### 6.5 Warehouse-to-store transfers

Transfer lifecycle:

- DRAFT
- READY
- DISPATCHED
- RECEIVED
- CANCELLED

Core rules:

- Draft does not change inventory.
- Dispatch reduces warehouse physical stock.
- Dispatch creates in-transit quantity.
- Receive increases store physical stock.
- Receive clears in-transit quantity.
- Store stock must not increase before receipt.
- Replaying dispatch must not deduct warehouse stock twice.
- Replaying receive must not increase store stock twice.
- A received transfer cannot be casually deleted.
- Any discrepancy must be recorded explicitly.

### 6.6 Store inventory

Store inventory must show:

- on-hand quantity
- reserved quantity
- available quantity
- low-stock status
- recent movements

Definitions:

- on-hand = physical quantity recorded at the store
- reserved = quantity committed to confirmed COD orders and not yet consumed/released
- available = on-hand - reserved

The system must prevent available quantity from becoming negative during normal sale/order flows.

### 6.7 POS

POS must support:

- barcode scanning
- product search
- cart
- quantity changes
- item removal
- automatic price calculation
- customer lookup by phone
- optional customer creation
- cash payment
- QR/non-cash payment
- sale finalization
- printable/displayable receipt
- loyalty earning
- return/refund linkage

Finalizing a POS sale must be atomic:

1. create sale
2. create sale items with historical unit prices
3. record payment
4. create store inventory deduction movements
5. update stock projection
6. calculate loyalty effect
7. create loyalty transaction when eligible
8. persist all or none

The system must reject normal sales with insufficient available stock.

### 6.8 Customers

Customer record:

- id
- phone number
- name, optional
- notes, optional
- loyalty account
- created/updated timestamps

Rules:

- phone number is the customer identity key for V1
- normalized phone number must be unique
- anonymous POS sale is allowed
- loyalty requires an identified customer
- customer deletion should be soft/inactive when history exists

### 6.9 Loyalty

V1 loyalty is earn-only.

Locked rule:

**1 loyalty point is earned for every cumulative NPR 500 of eligible finalized spend.**

Spend remainder carries forward.

Example:

- Sale 1: NPR 300 -> 0 points, remainder NPR 300
- Sale 2: NPR 250 -> 1 point, remainder NPR 50
- Sale 3: NPR 950 -> 2 points, remainder NPR 0

The system must not use simple per-sale floor(total/500) if that would discard valid customer spend remainder.

Eligible spend:

- finalized POS sales
- delivered and paid COD orders

Not eligible:

- cancelled sales/orders
- unpaid COD
- refunded/returned value
- admin adjustments unless explicitly marked

Loyalty transactions must be ledger-based:

- EARN
- REVERSAL
- ADJUSTMENT

V1 does not include point redemption.

Returns must reverse the loyalty impact so the customer cannot keep points for refunded spend.

### 6.10 WhatsApp / phone COD orders

WhatsApp is not the source of truth.

Staff manually enters the customer order into Pasalho Lite.

Required order data:

- customer
- phone
- delivery address
- order items
- quantity
- unit price
- subtotal
- discount if supported
- delivery charge
- total
- payment method
- notes

Lifecycle:

- NEW
- CONFIRMED
- PACKED
- DISPATCHED
- DELIVERED
- CANCELLED

Inventory rules:

- NEW: no stock mutation
- CONFIRMED: reserve store inventory
- PACKED: no additional stock deduction
- DISPATCHED: consume reservation and deduct physical store stock exactly once
- DELIVERED: no additional stock deduction
- CANCELLED before dispatch: release reservation
- cancellation after dispatch requires a return-to-stock/recovery flow, not a silent status change

Payment rules:

- COD starts PENDING
- delivery + successful collection marks COD PAID/COLLECTED
- failed collection must remain unresolved and visible
- loyalty is credited only when the order is delivered and eligible payment is collected

### 6.11 Returns and refunds

POS returns must:

- reference an original sale
- reference original sale item(s)
- record quantity returned
- prevent return quantity from exceeding quantity sold minus prior returns
- add stock back only when stock is physically returned and accepted
- record refund/payment reversal
- reverse loyalty effect as required
- create audit records

COD return/cancellation after dispatch must explicitly record whether goods came back, quantity returned, stock restored, and payment/refund outcome.

### 6.12 Payments

V1 payment methods:

- CASH
- QR/NON_CASH
- COD

Payment status should support at minimum:

- PENDING
- PAID
- REFUNDED
- PARTIALLY_REFUNDED if partial returns are supported

Payment records must be correction-based and auditable.

### 6.13 Expenses and cash movements

Authorized users may record:

- operating expense
- cash paid out
- cash added
- refund cash out
- other approved cash movement

Each record needs amount, type, reason/category, note, user, timestamp, and optional reference.

### 6.14 Daily close / reconciliation

Daily close is mandatory.

Expected closing cash is calculated from:

- opening cash
- cash POS sales
- COD cash collected
- cash added
- minus cash refunds
- minus cash expenses/payouts

Staff enters actual physical cash. System calculates variance.

Daily close also summarizes POS sales, QR/non-cash sales, COD delivered, COD collected, pending COD, returns/refunds, expenses, stock adjustments, and unresolved exceptions.

Reopening a closed day is admin-only and audited.

### 6.15 Audit log

Audit high-risk actions including:

- price changes
- product activation/deactivation
- stock adjustments
- receipt posting/reversal
- transfer dispatch/receive/cancel
- POS void/return/refund
- COD state transitions
- payment corrections
- loyalty adjustments
- daily close/reopen
- user/role changes

Entries should include actor, action, entity type/id, before/after data where useful, and timestamp.

## 7. Inventory accounting principles

Every physical stock change creates an immutable movement such as:

- PURCHASE_RECEIPT
- TRANSFER_OUT
- TRANSFER_IN
- POS_SALE
- COD_DISPATCH
- RETURN_IN
- ADJUSTMENT_IN
- ADJUSTMENT_OUT

A stock balance table may be used for fast reads, but it must reconcile with movements.

No application path may change stock balance without a corresponding movement.

## 8. Idempotency and duplicate protection

Stock-changing and money-changing commands must be retry-safe, including:

- receive stock
- dispatch transfer
- receive transfer
- finalize POS sale
- confirm/reserve COD order
- dispatch COD order
- deliver/collect COD
- process return/refund
- apply loyalty earn/reversal
- daily close

Retries must not create duplicate movements, payments, loyalty points, sales, or state effects.

## 9. Security requirements

- authenticated users only
- secure password hashing
- secure session handling
- role-based authorization
- server-side permission checks
- validation on every mutation
- no trust in client-calculated totals
- server recalculates sale/order totals
- secrets in environment variables
- production database not exposed publicly
- audit high-risk actions
- login rate limiting where practical
- backup strategy before launch

## 10. UX requirements

POS priorities:

- minimal clicks
- keyboard/barcode friendly
- clear stock warnings
- large total/payment controls
- customer phone lookup visible
- loyalty earned visible
- no unnecessary dashboard clutter during checkout

Warehouse priorities:

- SKU clarity
- quantity clarity
- transfer status clarity
- movement history visibility

Daily close priorities:

- expected cash obvious
- actual cash entry obvious
- variance impossible to miss

## 11. Reporting requirements

V1 reports:

- daily sales
- sales by payment method
- sales by SKU
- top-selling SKUs
- low stock
- inventory movement history
- current inventory by location
- transfers
- COD order status
- pending COD collections
- customer purchase history
- loyalty balance and ledger
- returns/refunds
- daily close history
- cash variance history
- expense history

Advanced BI is out of scope.

## 12. Non-goals for V1

Not included:

- customer mobile app
- full ecommerce website checkout
- franchise management
- multi-warehouse optimization
- sales representative app
- supplier portal
- loyalty redemption
- coupons/campaign engine
- eSewa/Khalti API integration
- automated WhatsApp API
- route optimization
- production/manufacturing
- complex accounting/general ledger
- microservices
- AI features
- recommendation engine
- advanced CRM
- marketplace

## 13. Success metrics

- 100% of stock-changing actions represented by inventory movements
- no duplicate stock deduction on retry
- no negative available stock through normal workflows
- POS finalization reliable
- COD dispatch deducts exactly once
- delivery does not deduct again
- loyalty balances reconcile to loyalty ledger
- daily close completed every operating day
- cash variance visible every day
- warehouse/store stock reconcilable with physical counts

## 14. V1 launch gate

Pasalho Lite is launch-ready only when the acceptance suite passes, including:

Receive 100 warehouse units
→ transfer 20
→ receive 20 at store
→ sell 3 POS
→ confirm COD order for 2
→ reserve 2
→ dispatch COD
→ store physical stock 15
→ deliver COD
→ stock remains 15
→ collect payment
→ loyalty correct
→ daily close correct
→ next-day persisted values remain correct.

## 15. Scope freeze

After launch, keep V1 scope frozen for the first 30 days of real store operation.

New requests should be logged but not built unless they fix incorrect money, incorrect inventory, security, legal/compliance risk, store-blocking failure, or repeated critical daily operational failure.
