# Pasalho Lite V1 — Data Model

## 1. Data principles

- PostgreSQL is the single source of truth.
- Prisma is the ORM.
- Money should use a fixed-precision decimal type, never floating point.
- Quantities should support decimal where units may require it; otherwise enforce integer units per product.
- Historical transaction prices must be stored on transaction lines.
- Inventory is movement-ledger driven.
- Loyalty is ledger-driven.
- High-risk writes use database transactions.
- Important commands use idempotency keys or equivalent unique constraints.

## 2. Core entities

### User

Fields:

- id
- name
- email or username
- passwordHash
- role
- active
- createdAt
- updatedAt

Roles:

- OWNER_ADMIN
- CASHIER_STORE
- WAREHOUSE_STAFF

### Location

Fields:

- id
- code
- name
- type
- active

V1 location types:

- WAREHOUSE
- STORE

Seed exactly one active warehouse and one active store for V1.

### Product

Fields:

- id
- sku
- barcode nullable
- name
- category
- unit
- costPrice
- sellingPrice
- mrp nullable
- warehouseMinStock
- storeMinStock
- active
- createdAt
- updatedAt

Constraints:

- sku unique
- barcode unique when present
- prices non-negative

### StockBalance

Purpose: fast projection of inventory state.

Fields:

- id
- productId
- locationId
- onHand
- reserved
- updatedAt

Derived:

- available = onHand - reserved

Constraint:

- unique productId + locationId

StockBalance is not the accounting ledger. It must be updated only in the same transaction that creates the corresponding InventoryMovement or Reservation effect.

### InventoryMovement

Fields:

- id
- productId
- locationId
- type
- quantityDelta
- referenceType
- referenceId
- idempotencyKey
- reason nullable
- actorUserId
- createdAt

Movement types:

- PURCHASE_RECEIPT
- TRANSFER_OUT
- TRANSFER_IN
- POS_SALE
- COD_DISPATCH
- RETURN_IN
- ADJUSTMENT_IN
- ADJUSTMENT_OUT

Constraints:

- idempotencyKey unique where used
- movement quantities are immutable after creation

### Supplier

V1 may keep this light.

Fields:

- id
- name
- phone nullable
- notes nullable
- active
- createdAt
- updatedAt

### PurchaseReceipt

Fields:

- id
- receiptNumber
- supplierId nullable
- supplierReference nullable
- status
- receivedAt
- postedAt nullable
- postedByUserId nullable
- notes nullable
- idempotencyKey
- createdAt

Statuses:

- DRAFT
- POSTED
- REVERSED

### PurchaseReceiptItem

Fields:

- id
- purchaseReceiptId
- productId
- quantity
- unitCost
- lineTotal

### Transfer

Fields:

- id
- transferNumber
- fromLocationId
- toLocationId
- status
- dispatchedAt nullable
- receivedAt nullable
- createdByUserId
- dispatchedByUserId nullable
- receivedByUserId nullable
- notes nullable
- dispatchIdempotencyKey nullable
- receiveIdempotencyKey nullable
- createdAt
- updatedAt

Statuses:

- DRAFT
- READY
- DISPATCHED
- RECEIVED
- CANCELLED

### TransferItem

Fields:

- id
- transferId
- productId
- requestedQuantity
- dispatchedQuantity nullable
- receivedQuantity nullable
- discrepancyReason nullable

### Customer

Fields:

- id
- phoneNormalized
- phoneDisplay
- name nullable
- notes nullable
- active
- createdAt
- updatedAt

Constraint:

- phoneNormalized unique

### LoyaltyAccount

Fields:

- id
- customerId
- pointBalance
- spendRemainder
- updatedAt

Constraint:

- customerId unique

Notes:

- spendRemainder stores eligible spend below the next NPR 500 threshold.
- pointBalance is a projection and must reconcile to LoyaltyTransaction.
- source transactions must remain auditable.

### LoyaltyTransaction

Fields:

- id
- customerId
- type
- pointsDelta
- eligibleSpendDelta
- sourceType
- sourceId
- idempotencyKey
- reason nullable
- actorUserId nullable
- createdAt

Types:

- EARN
- REVERSAL
- ADJUSTMENT

Constraint:

- idempotencyKey unique

### Sale

Fields:

- id
- receiptNumber
- storeLocationId
- customerId nullable
- status
- subtotal
- discountTotal
- total
- paymentStatus
- finalizedAt
- finalizedByUserId
- idempotencyKey
- createdAt

Statuses:

- FINALIZED
- PARTIALLY_RETURNED
- RETURNED
- VOIDED only if a safe pre-settlement void design exists

### SaleItem

Fields:

- id
- saleId
- productId
- skuSnapshot
- productNameSnapshot
- quantity
- unitPrice
- discountAmount
- lineTotal
- unitCostSnapshot nullable

Historical snapshots protect receipts from later product edits.

### Payment

Fields:

- id
- sourceType
- sourceId
- method
- status
- amount
- collectedAt nullable
- refundedAmount
- idempotencyKey
- recordedByUserId
- createdAt
- updatedAt

Methods:

- CASH
- QR_NON_CASH
- COD

Statuses:

- PENDING
- PAID
- PARTIALLY_REFUNDED
- REFUNDED

### CustomerOrder

Fields:

- id
- orderNumber
- customerId
- storeLocationId
- status
- addressText
- subtotal
- discountTotal
- deliveryCharge
- total
- paymentMethod
- paymentStatus
- notes nullable
- confirmedAt nullable
- packedAt nullable
- dispatchedAt nullable
- deliveredAt nullable
- cancelledAt nullable
- createdByUserId
- createdAt
- updatedAt

Statuses:

- NEW
- CONFIRMED
- PACKED
- DISPATCHED
- DELIVERED
- CANCELLED

### CustomerOrderItem

Fields:

- id
- customerOrderId
- productId
- skuSnapshot
- productNameSnapshot
- quantity
- unitPrice
- discountAmount
- lineTotal

### InventoryReservation

Fields:

- id
- productId
- locationId
- sourceType
- sourceId
- quantity
- status
- idempotencyKey
- createdAt
- consumedAt nullable
- releasedAt nullable

Statuses:

- ACTIVE
- CONSUMED
- RELEASED

For V1, reservations are primarily for confirmed COD orders.

### Return

Fields:

- id
- returnNumber
- sourceType
- sourceId
- status
- refundAmount
- reason
- createdByUserId
- createdAt
- completedAt nullable

### ReturnItem

Fields:

- id
- returnId
- productId
- originalLineId
- quantity
- restockQuantity
- refundAmount

### CashMovement

Fields:

- id
- operatingDate
- type
- amount
- category
- reason
- referenceType nullable
- referenceId nullable
- userId
- createdAt

Types:

- OPENING_CASH
- CASH_ADDED
- EXPENSE
- CASH_PAYOUT
- REFUND_OUT
- OTHER_APPROVED

### DailyClose

Fields:

- id
- storeLocationId
- operatingDate
- openingCash
- cashPosSales
- codCashCollected
- cashAdded
- cashRefunds
- cashExpenses
- expectedCash
- actualCash
- variance
- qrNonCashSales
- pendingCodAmount
- notes nullable
- status
- closedByUserId
- closedAt
- reopenedByUserId nullable
- reopenedAt nullable

Statuses:

- CLOSED
- REOPENED

Constraint:

- only one active/final close per store + operatingDate, with controlled reopen behavior

### AuditLog

Fields:

- id
- actorUserId nullable
- action
- entityType
- entityId
- beforeData nullable JSON
- afterData nullable JSON
- metadata nullable JSON
- createdAt

AuditLog is append-only in normal application behavior.

## 3. Key relationships

- Product 1→many InventoryMovement
- Product 1→many StockBalance
- Location 1→many StockBalance
- PurchaseReceipt 1→many PurchaseReceiptItem
- Transfer 1→many TransferItem
- Sale 1→many SaleItem
- Customer 1→many Sale
- Customer 1→many CustomerOrder
- Customer 1→1 LoyaltyAccount
- Customer 1→many LoyaltyTransaction
- CustomerOrder 1→many CustomerOrderItem
- CustomerOrder 1→many InventoryReservation
- Sale/Order 1→many Payment as needed by policy
- Sale/Order 1→many Return as needed

## 4. Required transaction boundaries

Use one database transaction for:

### Post purchase receipt

- validate
- create inventory movements
- update warehouse StockBalance
- mark receipt POSTED

### Dispatch transfer

- validate state/stock
- create TRANSFER_OUT movements
- update warehouse StockBalance
- set DISPATCHED

### Receive transfer

- validate state
- create TRANSFER_IN movements
- update store StockBalance
- set RECEIVED

### Finalize POS sale

- validate stock/prices
- create Sale/SaleItems
- create Payment
- create POS_SALE movements
- update store StockBalance
- create loyalty ledger effect
- update LoyaltyAccount

### Confirm COD order

- validate stock
- create reservations
- increase StockBalance.reserved
- set CONFIRMED

### Dispatch COD order

- validate state/reservations
- consume reservations
- decrease onHand and reserved correctly
- create COD_DISPATCH movements
- set DISPATCHED

### Deliver + collect COD

- set DELIVERED
- update payment to PAID
- apply loyalty once
- do not mutate inventory

### Return/refund

- create Return/ReturnItems
- create RETURN_IN where physically accepted
- update StockBalance
- create refund effect
- reverse loyalty effect
- update source state

### Daily close

- calculate server-side totals
- persist calculated values
- persist physical cash
- compute variance
- mark CLOSED

## 5. Reconciliation invariants

For every Product + Location:

projected onHand must equal opening/imported baseline plus sum of physical InventoryMovement deltas.

For store availability:

available = onHand - active reservations.

For loyalty:

pointBalance must equal the sum of pointsDelta in LoyaltyTransaction.

For cash close:

expectedCash = openingCash + eligible cash inflows - eligible cash outflows.

These invariants must have automated tests.
