# Pasalho Lite V1 — Feature Specifications & Limits

This document is the implementation contract for every V1 feature.

A coding agent must treat the behavior, limits, state transitions, and non-goals below as authoritative unless a later explicitly approved decision updates this file.

The goal is to eliminate ambiguity during implementation.

---

# 1. Global Product Limits

Pasalho Lite V1 supports exactly:

- 1 warehouse
- 1 physical store
- 1 POS operation
- manual WhatsApp/phone order capture
- COD order fulfillment
- customer identification by phone number
- loyalty earning
- returns/refunds
- daily cash reconciliation

V1 must NOT add:

- customer mobile app
- public ecommerce checkout
- franchise management
- multiple warehouses
- multiple active stores in UI/workflows
- supplier portal
- sales representative app
- loyalty redemption
- coupon engine
- promotional campaign engine
- automated WhatsApp API
- eSewa/Khalti API integration
- route optimization
- manufacturing
- complex accounting/general ledger
- microservices
- event bus
- Redis unless explicitly approved after a proven requirement
- AI features

Do not build future features "just in case."

---

# 2. Dashboard

## Purpose

Give Owner/Admin a reliable operational summary of the current business.

## Must show

- today's gross sales
- today's net sales
- today's POS sales count
- today's COD delivered value
- cash collected today
- QR/non-cash collected today
- pending COD amount
- today's refunds
- today's expenses
- expected cash
- most recent cash variance
- warehouse inventory value
- store inventory value
- low-stock products
- open transfers
- open COD orders

## Limits

- Dashboard is read-only.
- No hidden writes or synchronization.
- No manual KPI editing.
- No charts required for initial V1.
- No forecasting.
- No AI insights.
- No multi-store comparison.

## Data rule

Every number must be derived from transactional source tables.

Do not create manually editable dashboard totals.

## Empty state

If there is no data, show zero or an explicit empty state. Do not show fake/sample business numbers in production.

---

# 3. Products

## Purpose

Maintain the master SKU catalog used by warehouse, store, POS, and COD orders.

## Required fields

- SKU
- product name
- category
- unit
- cost price
- selling price
- active/inactive status

## Optional fields

- barcode
- MRP
- warehouse minimum stock
- store minimum stock

## Validation

- SKU unique
- barcode unique when present
- SKU cannot be blank
- product name cannot be blank
- cost price >= 0
- selling price >= 0
- MRP >= 0 when present
- stock thresholds >= 0

## Limits

- Do not support product variants unless represented as separate SKUs.
- Do not support bundles/kits in V1.
- Do not support dynamic pricing.
- Do not support customer-specific pricing.
- Do not support scheduled price changes.
- Do not modify historical transaction line prices after a product price change.

## Inactive products

Inactive products:

- remain visible in historical transactions
- cannot be added to new POS sales
- cannot be added to new COD orders
- should not be deleted if referenced by history

---

# 4. Supplier Records

## Purpose

Provide minimal supplier identity for purchase receipts.

## Required

- supplier name

## Optional

- phone
- notes

## Limits

Do not build:

- supplier portal
- supplier ledger
- supplier payments
- credit terms engine
- purchase order approval workflow

Supplier functionality exists only to support receiving records in V1.

---

# 5. Warehouse Receiving

## Purpose

Record physical goods received into the warehouse.

## Input

- supplier/source
- reference number optional
- receipt date
- SKU
- quantity
- unit cost
- notes optional

## Rules

Posting a receipt must atomically:

1. validate items
2. create PurchaseReceipt
3. create PurchaseReceiptItems
4. create PURCHASE_RECEIPT InventoryMovements
5. increase warehouse StockBalance.onHand
6. record actor
7. mark receipt POSTED

## Limits

- Quantity must be > 0.
- Posted receipt cannot be casually edited.
- Posted receipt cannot be deleted.
- Retry must not add stock twice.
- Store stock must not change.
- Loyalty must not change.
- Cash/POS records must not change.

## Correction

If a posted receipt is wrong, use a documented reversal/adjustment path.

Never directly edit warehouse stock to "fix" the receipt.

---

# 6. Warehouse Inventory

## Purpose

Show the warehouse's current recorded stock.

## Must display

- SKU
- product
- on-hand
- minimum stock
- low-stock indicator
- recent movement history

## Limits

- No arbitrary inline stock editing.
- Warehouse staff cannot type a new stock balance directly.
- Any manual correction requires adjustment movement + reason.
- Normal V1 does not require warehouse reservations for POS/COD.

## Source of truth

InventoryMovement is the durable stock evidence.

StockBalance is a projection for fast reads.

---

# 7. Warehouse → Store Transfer

## Purpose

Move physical stock from central warehouse to the store with traceable dispatch and receipt.

## States

Only:

- DRAFT
- READY
- DISPATCHED
- RECEIVED
- CANCELLED

## Allowed transitions

- DRAFT → READY
- DRAFT → CANCELLED
- READY → DISPATCHED
- READY → CANCELLED
- DISPATCHED → RECEIVED

No reverse state transitions.

## DRAFT

- no stock effect

## READY

- no stock effect
- means transfer is approved/prepared

## DISPATCHED

Atomically:

- validate warehouse stock
- create TRANSFER_OUT movement
- reduce warehouse onHand
- record dispatched quantity
- record dispatch actor/time
- represent stock as in-transit
- set status DISPATCHED

## RECEIVED

Atomically:

- create TRANSFER_IN movement
- increase store onHand
- record received quantity
- clear in-transit state
- record actor/time
- set RECEIVED

## Limits

- Store stock must not increase at dispatch.
- Warehouse stock must not decrease at receipt.
- Dispatch retry must not duplicate deduction.
- Receive retry must not duplicate addition.
- RECEIVED transfer cannot be deleted.
- Do not automatically receive on behalf of store.

## Discrepancy

If received quantity differs from dispatched quantity:

- record actual received quantity
- require discrepancy reason
- do not silently force equality
- keep audit evidence

---

# 8. Store Inventory

## Purpose

Represent sellable physical stock at the store.

## Required quantities

- onHand
- reserved
- available

## Formula

available = onHand - reserved

## Rules

- POS sale reduces onHand.
- Confirmed COD order increases reserved.
- COD dispatch reduces onHand and consumes reserved.
- COD delivery does not change inventory.
- Return increases onHand only after physical goods are accepted back.

## Limits

- Do not allow normal operations to create negative available stock.
- Do not allow direct quantity overwrite.
- Do not allow customer order to reserve more than available.

---

# 9. POS

## Purpose

Complete in-store sales quickly and safely.

## POS screen must support

- barcode scan
- product search
- cart
- quantity change
- item removal
- customer phone lookup
- optional new customer creation
- visible subtotal
- visible discount total if discounts are enabled
- visible final total
- payment method
- finalize sale
- receipt view/print
- loyalty earned display

## Payment methods

V1 supports:

- CASH
- QR_NON_CASH

COD is for customer orders, not normal counter POS sale.

## Limits

- No split payments in V1.
- No credit sales in V1.
- No employee discounts engine.
- No coupon engine.
- No gift cards.
- No store credit.
- No offline sync engine in initial V1.
- No negative quantity sale lines.

## Server authority

The server must recalculate:

- item price
- quantity validity
- subtotal
- discount
- total
- available stock
- loyalty effect

Never trust totals sent by the browser.

## Finalization transaction

Must atomically:

1. validate active products
2. validate available stock
3. create Sale
4. create SaleItems
5. create Payment
6. create POS_SALE movements
7. reduce store onHand
8. create loyalty effect when customer is identified
9. return completed receipt

All succeed or all fail.

## Duplicate protection

Finalization must accept/use an idempotency key.

The same command replay must never create:

- second sale
- second payment
- second stock deduction
- second loyalty earning

---

# 10. Customer Records

## Purpose

Identify repeat customers for history and loyalty.

## Required

- phone number

## Optional

- name
- notes

## Phone rules

- normalize before persistence
- normalized phone must be unique
- preserve a display version if useful
- prevent duplicate customer creation due to spacing/country-code formatting differences where reasonably possible

## Limits

- No complex CRM.
- No customer segmentation engine.
- No marketing automation.
- No email requirement.
- Anonymous POS sales remain allowed.

---

# 11. Loyalty

## Purpose

Reward repeat spending without adding redemption complexity.

## Locked earning rule

**Every cumulative NPR 500 of eligible spend earns 1 point.**

Remainder carries forward.

## Correct examples

- NPR 499 total eligible spend → 0 points, 499 remainder
- + NPR 1 → 1 point, 0 remainder
- NPR 300 + NPR 250 → 1 point, 50 remainder
- NPR 1,250 → 2 points, 250 remainder

## Eligible transactions

- finalized identified-customer POS sale
- delivered and paid identified-customer COD order

## Not eligible

- anonymous sale
- unpaid COD
- cancelled order
- refunded portion
- return value
- admin-created fake spend

## Ledger

Every loyalty effect must create LoyaltyTransaction.

Types:

- EARN
- REVERSAL
- ADJUSTMENT

## Limits

- No point redemption in V1.
- No point expiry.
- No tiers.
- No birthday bonuses.
- No bonus campaigns.
- No SKU-specific earning multiplier.
- No manual cashier point grant.
- Only Owner/Admin may make manual adjustment, with reason and audit.

## Return behavior

Refunded eligible spend must remove the corresponding loyalty benefit.

The implementation must preserve a mathematically correct remainder and point balance.

Do not simply subtract floor(refund/500) without considering prior spend state.

Tests must prove the chosen reversal algorithm.

---

# 12. WhatsApp / Phone Orders

## Purpose

Allow staff to record customer orders received outside the POS.

WhatsApp itself is not integrated in V1.

## Required data

- customer
- phone
- address
- items
- quantity
- price snapshot
- subtotal
- delivery charge
- total
- payment method
- notes optional

## States

Only:

- NEW
- CONFIRMED
- PACKED
- DISPATCHED
- DELIVERED
- CANCELLED

## Allowed normal transitions

- NEW → CONFIRMED
- NEW → CANCELLED
- CONFIRMED → PACKED
- CONFIRMED → CANCELLED
- PACKED → DISPATCHED
- PACKED → CANCELLED
- DISPATCHED → DELIVERED

Do not allow state skipping in normal UI.

## NEW

- no reservation
- no inventory mutation

## CONFIRMED

Atomically:

- validate store available stock
- create ACTIVE reservation
- increase reserved
- set CONFIRMED

## PACKED

- no additional reservation
- no inventory deduction

## DISPATCHED

Atomically:

- validate ACTIVE reservation
- consume reservation
- reduce onHand
- reduce reserved
- create COD_DISPATCH movement
- set DISPATCHED

Exactly one physical stock deduction.

## DELIVERED

- no inventory deduction
- record delivered time
- record COD collection/payment outcome
- apply loyalty once if eligible

## CANCELLED before dispatch

- release ACTIVE reservation
- no physical inventory movement

## After dispatch

Do not use simple cancellation.

Use return/recovery workflow.

## Limits

- No automatic WhatsApp messaging required.
- No delivery routing.
- No rider app.
- No live map tracking.
- No automated serviceability engine.
- No online payment API.

---

# 13. Payments

## Purpose

Record money received/refunded for sales and orders.

## Methods

- CASH
- QR_NON_CASH
- COD

## Statuses

- PENDING
- PAID
- PARTIALLY_REFUNDED
- REFUNDED

## Rules

- POS payment normally becomes PAID during finalization.
- COD starts PENDING.
- COD becomes PAID only when collection is confirmed.
- Refunds create explicit refund effects.
- Do not silently overwrite payment history.

## Limits

- No eSewa/Khalti API integration.
- No payment gateway reconciliation.
- No credit ledger.
- No BNPL.
- No stored wallet.

---

# 14. Returns & Refunds

## Purpose

Correct completed transactions without rewriting history.

## Requirements

A return must reference:

- original Sale or CustomerOrder
- original item
- quantity
- refund amount
- reason
- whether goods physically returned
- whether returned goods are restocked

## Limits

- return quantity cannot exceed sold quantity minus previous returns
- refund cannot exceed eligible paid amount
- no stock increase until goods are physically accepted
- no deleting original sale/order
- no direct modification of original sale line

## Atomic effect

When applicable:

- create Return
- create ReturnItems
- create RETURN_IN movement
- update StockBalance
- create refund/payment effect
- reverse loyalty effect
- update source transaction state

Retry must not duplicate any effect.

---

# 15. Stock Adjustments

## Purpose

Correct real-world stock mismatches.

## Allowed users

Owner/Admin only in V1.

## Required

- product
- location
- direction IN or OUT
- quantity > 0
- reason

## Rules

Create:

- ADJUSTMENT_IN or ADJUSTMENT_OUT movement
- matching StockBalance change
- AuditLog

## Limits

- Cashier cannot adjust stock.
- Warehouse staff cannot arbitrarily adjust without Owner/Admin.
- Adjustment cannot be used as a shortcut for purchase receiving, transfer, sale, dispatch, or return.

---

# 16. Expenses & Cash Movements

## Purpose

Capture cash movements that affect daily cash reconciliation.

## Supported types

- OPENING_CASH
- CASH_ADDED
- EXPENSE
- CASH_PAYOUT
- REFUND_OUT
- OTHER_APPROVED

## Required

- amount > 0
- category/type
- reason
- user
- timestamp

## Limits

- No full accounting chart of accounts.
- No payable/receivable ledger.
- No journal entries.
- No depreciation.
- No tax accounting engine.

---

# 17. Daily Close

## Purpose

Reconcile the physical cash drawer against system-calculated cash.

## Inputs

System-calculated:

- opening cash
- cash POS sales
- COD cash collected
- cash added
- cash refunds
- cash expenses/payouts
- expected cash
- QR/non-cash sales
- pending COD

User-entered:

- actual physical cash
- note

## Formula

expectedCash =
openingCash
+ cashPosSales
+ codCashCollected
+ cashAdded
- cashRefunds
- cashExpensesOrPayouts

variance = actualCash - expectedCash

## Rules

- system calculations are server-side
- physical cash is manually entered
- variance always shown
- non-zero variance requires note
- close is persisted
- reopen is Owner/Admin only
- reopen is audited

## Limits

- No automatic bank reconciliation.
- No general ledger.
- No accounting-period close.
- No multi-register close in V1.

---

# 18. Users & Permissions

## Roles

Exactly:

- OWNER_ADMIN
- CASHIER_STORE
- WAREHOUSE_STAFF

Do not create additional roles without approved PRD update.

## Limits

Client-side hidden buttons are not authorization.

Every mutation requires server-side authorization.

Refer to ROLES_PERMISSIONS.md for exact permissions.

---

# 19. Audit Log

## Purpose

Make high-risk manual changes traceable.

## Audit at minimum

- user/role changes
- product price change
- product activation/deactivation
- stock adjustment
- receipt reversal/correction
- transfer correction
- refund override
- loyalty adjustment
- daily close reopen

## Limits

- Audit entries are append-only in normal application behavior.
- No user-facing delete audit action.

---

# 20. Search, Pagination & Lists

## Rules

For large product/order/movement lists:

- use server-side pagination
- provide search where operationally necessary
- avoid loading entire inventory history into browser

## V1 required search

- product by name
- product by SKU
- product by barcode
- customer by phone
- sale by receipt number
- order by order number/customer phone

Do not build global Elasticsearch-style search.

---

# 21. Time & Currency

## Currency

All business money is NPR.

Display should use NPR / Rs consistently.

Use Decimal/fixed precision in database/application.

## Time

Store timestamps in a standard timezone-safe form.

Display operational dates/times in Nepal time for Pasalho operations.

Daily close operatingDate must not depend on browser timezone alone.

---

# 22. Error Behavior

Use explicit business errors.

Examples:

- INSUFFICIENT_STOCK
- PRODUCT_INACTIVE
- INVALID_STATE_TRANSITION
- DUPLICATE_OPERATION
- RETURN_QUANTITY_EXCEEDED
- UNAUTHORIZED_ACTION
- DAILY_CLOSE_ALREADY_EXISTS
- CUSTOMER_PHONE_EXISTS
- INVALID_PAYMENT_STATE

Staff-facing UI must show understandable messages.

Do not expose raw stack traces or database errors.

---

# 23. Definition of Feature Complete

A feature is complete only when:

1. database schema exists
2. migrations run from empty DB
3. server-side business logic exists
4. authorization exists
5. validation exists
6. idempotency exists where required
7. UI flow exists
8. error states are handled
9. automated tests cover core rules
10. acceptance tests pass
11. no unrelated feature was added

UI alone is never considered feature complete.
