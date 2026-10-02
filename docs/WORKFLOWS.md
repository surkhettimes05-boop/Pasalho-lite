# Pasalho Lite V1 — Operational Workflows

## 1. Supplier receipt → warehouse

1. Warehouse staff opens Receive Stock.
2. Selects or enters supplier/source reference.
3. Adds SKUs and received quantities.
4. Confirms unit cost.
5. Reviews the receipt.
6. Posts the receipt.
7. System creates the receipt record.
8. System creates one PURCHASE_RECEIPT inventory movement per SKU.
9. Warehouse stock projection increases.
10. Receipt becomes posted and auditable.

Retrying the same post action must not duplicate stock.

## 2. Warehouse → store transfer

### Create

1. Authorized user creates transfer.
2. Adds SKU quantities.
3. System validates warehouse availability.
4. Transfer remains DRAFT until ready.

### Dispatch

1. Warehouse confirms physical quantities.
2. User dispatches transfer.
3. System atomically:
   - marks transfer DISPATCHED
   - creates TRANSFER_OUT movements
   - reduces warehouse on-hand
   - creates in-transit quantity/state
4. Store stock does not increase yet.

### Receive

1. Store verifies physical goods.
2. Records received quantities.
3. System atomically:
   - marks transfer RECEIVED
   - creates TRANSFER_IN movements
   - increases store on-hand
   - clears in-transit quantity
4. Discrepancies require an explicit reason and correction path.

## 3. POS sale

1. Cashier opens POS.
2. Scans barcode or searches SKU.
3. Adds quantity.
4. Server validates product active status and store availability.
5. Cashier optionally identifies customer by phone.
6. System shows total and projected loyalty earning.
7. Cashier selects payment method.
8. Cashier finalizes sale.
9. Server atomically:
   - recalculates totals
   - creates Sale
   - creates SaleItems
   - creates Payment
   - creates POS_SALE inventory movements
   - decreases store stock
   - creates loyalty transaction when eligible
10. Receipt is shown or printed.

If any critical step fails, the sale must not partially finalize.

## 4. Customer loyalty earning

1. Customer is identified by normalized phone number.
2. Eligible finalized spend is added to qualifying spend.
3. System combines new eligible spend with the carried remainder.
4. Every complete NPR 500 produces 1 point.
5. Remaining amount below NPR 500 carries forward.
6. System creates an EARN loyalty transaction for points earned.
7. Loyalty account projection is updated.

Example:

- existing remainder = NPR 350
- new eligible spend = NPR 900
- total qualifying bucket = NPR 1,250
- earned = 2 points
- new remainder = NPR 250

Returns/refunds reverse qualifying spend and point effects through ledger transactions.

## 5. WhatsApp / phone COD order

### Capture

1. Customer messages or calls.
2. Staff opens New Order.
3. Finds or creates customer.
4. Adds delivery address.
5. Adds SKUs and quantities.
6. Server calculates totals.
7. Order is created as NEW.
8. No stock changes yet.

### Confirm

1. Staff validates customer and order.
2. System checks store available stock.
3. Confirmation atomically:
   - changes order to CONFIRMED
   - creates a reservation per SKU
   - increases reserved quantity
4. Physical on-hand does not change.

### Pack

1. Staff physically picks goods.
2. Marks order PACKED.
3. No stock movement occurs.

### Dispatch

1. Delivery leaves the store.
2. Dispatch atomically:
   - changes status to DISPATCHED
   - consumes reservations
   - creates COD_DISPATCH inventory movements
   - reduces store physical on-hand exactly once
3. Retry must not create another deduction.

### Deliver

1. Staff marks order DELIVERED.
2. If COD cash was collected, payment becomes PAID/COLLECTED.
3. Delivery does not change inventory.
4. Eligible spend is posted to loyalty only after delivery and eligible payment collection.

## 6. COD cancellation

### Before confirmation

- Set CANCELLED.
- No inventory effect.

### After confirmation but before dispatch

- Set CANCELLED.
- Release reservations.
- No physical inventory movement.

### After dispatch

Do not silently change to CANCELLED.

Use a recovery/return flow:

1. Record failed delivery/return initiation.
2. Record physical goods returned.
3. Create RETURN_IN only after goods are physically received back.
4. Resolve payment.
5. Resolve loyalty.
6. Close the order with an auditable reason.

## 7. POS return/refund

1. Search original sale/receipt.
2. Select returnable line items.
3. Enter return quantity.
4. System validates remaining returnable quantity.
5. Staff confirms goods physically returned.
6. System atomically:
   - creates return record
   - creates RETURN_IN inventory movement when accepted
   - records refund/payment correction
   - reverses loyalty effect as required
7. Original sale remains historically unchanged.

## 8. Stock adjustment

1. Authorized user opens product/location stock.
2. Chooses Adjustment In or Adjustment Out.
3. Enters quantity.
4. Enters mandatory reason.
5. Confirms.
6. System creates immutable adjustment movement.
7. Stock projection updates.
8. Audit log records actor and reason.

Never directly edit a balance field.

## 9. Daily close

1. System identifies the operating day.
2. System calculates:
   - opening cash
   - cash POS sales
   - COD cash collected
   - cash added
   - cash refunds
   - cash expenses/payouts
   - expected closing cash
3. Staff enters actual physical cash.
4. System calculates variance.
5. Staff adds a note when variance is non-zero.
6. Close record is persisted.
7. Owner/Admin can review.
8. Reopening requires admin authorization and audit.

## 10. Canonical operating day

Opening
→ receive or transfer stock as needed
→ POS trading
→ WhatsApp/phone orders
→ COD packing/dispatch/delivery
→ record expenses/refunds
→ resolve stock exceptions
→ physical cash count
→ daily close
→ owner review.
