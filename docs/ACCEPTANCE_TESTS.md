# Pasalho Lite V1 — Acceptance Tests & Release Gate

## 1. Rule

A feature is not VERIFIED PASS because code exists. It passes only when an automated test, integration test, or documented manual release test proves the required behavior.

Use these statuses:

- VERIFIED PASS
- PARTIAL
- FAILED
- NOT TESTED
- BLOCKED

## 2. Product and pricing

### AT-PROD-001 Unique SKU

Given an existing SKU
When another product is created with the same SKU
Then creation is rejected.

### AT-PROD-002 Unique barcode

Given a barcode assigned to one product
When another product uses the same barcode
Then creation is rejected.

### AT-PROD-003 Historical price integrity

Given a product sold at NPR 100
When selling price later changes to NPR 120
Then the historical sale line remains NPR 100.

### AT-PROD-004 Inactive product

Given an inactive product
When cashier attempts a new POS sale/order
Then it cannot be added/finalized.

## 3. Warehouse receiving

### AT-REC-001 Post receipt

Receive 100 units of SKU A into warehouse.

Expected:

- one posted receipt
- one PURCHASE_RECEIPT movement +100
- warehouse onHand +100
- ledger and projection agree

### AT-REC-002 Retry receipt

Replay the same receipt-post command.

Expected:

- no duplicate movement
- warehouse remains 100
- no duplicate posted receipt effect

## 4. Transfers

### AT-TR-001 Dispatch

Warehouse has 100.

Transfer 20 to store and dispatch.

Expected:

- warehouse onHand = 80
- store onHand unchanged
- transfer = DISPATCHED
- one TRANSFER_OUT movement -20
- 20 represented as in transit

### AT-TR-002 Replay dispatch

Repeat dispatch command.

Expected warehouse stays 80 and no duplicate movement.

### AT-TR-003 Receive

Receive the dispatched transfer.

Expected:

- store onHand increases by 20
- transfer = RECEIVED
- one TRANSFER_IN +20
- in-transit cleared

### AT-TR-004 Replay receive

Repeat receive command.

Expected store quantity does not increase again.

## 5. POS

### AT-POS-001 Cash sale

Store has 20 units.

Sell 3 units for cash.

Expected:

- finalized sale exists
- correct sale lines and total
- payment PAID
- one POS_SALE movement -3
- store onHand = 17

### AT-POS-002 Server pricing

Manipulate client-side item price.

Expected server ignores unauthorized client total and uses server-authoritative product/pricing rules.

### AT-POS-003 Insufficient stock

Store available stock = 2.

Try to sell 3.

Expected sale rejected and no partial records created.

### AT-POS-004 Retry finalization

Replay finalization with same idempotency key.

Expected one sale, one payment effect, one inventory deduction, one loyalty effect.

### AT-POS-005 Anonymous customer

Finalize POS sale without customer.

Expected sale succeeds but no loyalty is earned.

## 6. Loyalty

### AT-LOY-001 First threshold

Identified customer spends NPR 500 eligible amount.

Expected:

- +1 point
- remainder = 0
- one EARN ledger entry

### AT-LOY-002 Remainder carry

Customer spends NPR 300 then NPR 250.

Expected:

- after first: 0 points, remainder 300
- after second: +1 point, remainder 50

### AT-LOY-003 Multi-point earning

Customer with remainder 50 spends NPR 1,450.

Expected total qualifying amount 1,500, +3 points, remainder 0.

### AT-LOY-004 Retry protection

Replay an already finalized eligible sale.

Expected loyalty is not earned twice.

### AT-LOY-005 Return reversal

Customer earns points, then eligible value is refunded.

Expected qualifying spend and points are reversed according to the loyalty ledger and cannot remain incorrectly credited.

### AT-LOY-006 Ledger reconciliation

Expected LoyaltyAccount.pointBalance equals sum of LoyaltyTransaction.pointsDelta.

## 7. COD orders

### AT-COD-001 New order

Create NEW order for 2 units.

Expected:

- no reservation
- no inventory movement
- onHand unchanged

### AT-COD-002 Confirm

Confirm order for 2 with store onHand 17.

Expected:

- reserved = 2
- available = 15
- physical onHand remains 17
- active reservation exists

### AT-COD-003 Pack

Mark PACKED.

Expected no inventory movement and quantities unchanged.

### AT-COD-004 Dispatch

Dispatch order.

Expected:

- reservation CONSUMED
- reserved decreases by 2
- one COD_DISPATCH movement -2
- physical onHand becomes 15
- status DISPATCHED

### AT-COD-005 Dispatch replay

Replay dispatch.

Expected:

- onHand stays 15
- one deduction movement only
- reservation is not consumed twice

### AT-COD-006 Deliver

Mark delivered and record COD collected.

Expected:

- status DELIVERED
- payment PAID
- no new inventory movement
- onHand remains 15
- loyalty posted once

### AT-COD-007 Delivery replay

Replay delivery/collection command.

Expected no duplicate payment or loyalty.

### AT-COD-008 Cancel confirmed order

Confirm order, then cancel before dispatch.

Expected reservation RELEASED, reserved decreases, physical stock unchanged.

### AT-COD-009 Cancel after dispatch

Attempt silent cancellation after dispatch.

Expected operation rejected or redirected into explicit return/recovery flow.

## 8. Returns/refunds

### AT-RET-001 POS return

Return one unit from an original sale.

Expected:

- linked return record
- quantity does not exceed sale quantity
- accepted returned stock creates RETURN_IN +1
- refund recorded
- loyalty adjusted

### AT-RET-002 Excess return

Try returning more than remaining returnable quantity.

Expected rejected with no inventory/payment mutation.

### AT-RET-003 Retry return

Replay same return command.

Expected no duplicate restock/refund/loyalty reversal.

## 9. Stock adjustments

### AT-ADJ-001 Authorized adjustment

Owner performs +5 adjustment with reason.

Expected:

- ADJUSTMENT_IN +5
- balance changes by 5
- audit log exists

### AT-ADJ-002 Unauthorized adjustment

Cashier attempts direct adjustment.

Expected authorization denied.

### AT-ADJ-003 Direct balance mutation protection

No normal application command can alter StockBalance without matching ledger/reservation logic.

## 10. Daily close

### AT-CLOSE-001 Expected cash

Given:

- opening cash 5,000
- cash POS sales 37,500
- COD cash collected 8,000
- cash expense 2,500

Expected cash = 48,000.

### AT-CLOSE-002 Variance

Actual counted cash = 47,850.

Expected variance = -150 and persisted.

### AT-CLOSE-003 Reopen authorization

Cashier tries to reopen closed day.

Expected denied.

Owner/Admin reopens.

Expected success plus audit record.

### AT-CLOSE-004 Duplicate close

Repeated close request for same operating day must not create duplicate active/final closes.

## 11. Permissions

Verify every permission in ROLES_PERMISSIONS.md with server-side tests for allowed and denied roles.

Client-side hiding alone is insufficient.

## 12. Security

Release must verify:

- passwords are hashed
- secrets are not committed
- production cookies/session settings are secure
- mutation payloads are validated
- unauthorized routes return correct denial
- database is not publicly exposed
- production backup and restore procedure exists
- dependency audit has no unresolved critical issues

## 13. Canonical end-to-end release test

Start with zero stock for SKU A.

1. Post purchase receipt +100 to warehouse.
2. Verify warehouse = 100.
3. Create transfer 20.
4. Dispatch transfer.
5. Verify warehouse = 80 and store still 0.
6. Receive transfer.
7. Verify store = 20.
8. POS sell 3.
9. Verify store = 17.
10. Create identified customer with loyalty remainder 0.
11. Create COD order for 2.
12. Confirm.
13. Verify onHand 17, reserved 2, available 15.
14. Pack.
15. Verify no stock change.
16. Dispatch.
17. Verify onHand 15, reserved 0 and exactly one -2 movement.
18. Deliver and collect COD.
19. Verify onHand remains 15.
20. Verify payment state.
21. Verify loyalty earning according to total eligible spend.
22. Record a cash expense.
23. Close day.
24. Verify expected cash.
25. Enter physical cash.
26. Verify variance.
27. Restart/reload application.
28. Verify all persisted values remain correct.
29. Reconcile movement ledger to stock projection.
30. Reconcile loyalty ledger to point balance.

V1 cannot be called launch-ready until this test passes.

## 14. Pilot release gate

Before live use:

- all critical acceptance tests pass
- no known path creates duplicate stock/money/loyalty effects
- owner account exists
- warehouse/store locations seeded
- product import or product entry path proven
- receipt printer path tested if used
- barcode scanner tested if used
- database backup created
- restore procedure tested
- daily close tested with realistic sample transactions
- one full operating-day simulation completed

## 15. First 30 days

During the first 30 days, track:

- stock discrepancies
- cash variance
- failed POS transactions
- duplicate/retry incidents
- COD failed delivery
- loyalty complaints
- staff workflow confusion
- high-frequency manual workarounds

Fix correctness issues before adding features.
