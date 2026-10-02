# Pasalho Lite V1 — Locked Product Decisions

This file records decisions that should not be reopened casually during V1 implementation.

## D-001 Product scope

Pasalho Lite V1 supports:

- one warehouse
- one physical store
- POS
- warehouse receiving
- warehouse-to-store transfers
- store inventory
- WhatsApp/phone COD orders
- customer records
- loyalty earning
- returns/refunds
- expenses/cash movements
- daily close/reconciliation
- owner/admin, cashier/store, and warehouse roles

Status: LOCKED

## D-002 Architecture

Use a modular monolith:

- one repository
- one Next.js + TypeScript application
- one backend/API surface
- one PostgreSQL database
- Prisma ORM

Do not split V1 into separate services.

Status: LOCKED

## D-003 Inventory source of truth

Inventory is movement-ledger driven.

StockBalance may exist as a projection for fast reads, but physical stock changes must always have a matching InventoryMovement.

Status: LOCKED

## D-004 Transfer timing

Warehouse stock reduces at transfer dispatch.

Store stock increases only when transfer is received.

Status: LOCKED

## D-005 POS stock timing

POS stock is deducted when a sale is finalized.

Status: LOCKED

## D-006 COD inventory timing

- NEW: no inventory effect
- CONFIRMED: reserve store stock
- PACKED: no new inventory effect
- DISPATCHED: consume reservation and deduct physical stock once
- DELIVERED: no additional inventory deduction

Status: LOCKED

## D-007 Customer identity

Phone number is the primary customer identifier for V1.

Anonymous POS sales remain allowed, but anonymous sales do not earn loyalty.

Status: LOCKED

## D-008 Loyalty earning rule

Every cumulative NPR 500 of eligible finalized spend earns 1 point.

Spend below the threshold carries forward as remainder.

Examples:

- 300 + 250 = 1 point, remainder 50
- 1,250 = 2 points, remainder 250

Status: LOCKED

## D-009 Loyalty redemption

Point redemption is not included in V1.

A redemption value must not be invented until Pasalho deliberately defines the economics.

Status: LOCKED

## D-010 Loyalty timing

POS: earn after successful sale finalization.

COD: earn only after DELIVERED and eligible payment collection.

Returns/refunds reverse eligible loyalty effects.

Status: LOCKED

## D-011 WhatsApp

WhatsApp is a communication/order-origin channel only.

The Pasalho Lite database is the source of truth.

Automated WhatsApp API integration is not required for V1.

Status: LOCKED

## D-012 Payments

V1 records:

- CASH
- QR/NON_CASH
- COD

Live eSewa/Khalti API integration is not required for V1.

Status: LOCKED

## D-013 Daily reconciliation

Every operating day must support a DailyClose with:

- expected cash
- physical cash counted
- variance
- supporting sales/payment/expense information

Status: LOCKED

## D-014 Read paths

GET/read operations should not create hidden business mutations.

Stock, money, order state, and loyalty effects must occur through explicit commands.

Status: LOCKED

## D-015 Idempotency

All money-, inventory-, reservation-, loyalty-, and close-changing commands must be retry-safe.

Status: LOCKED

## D-016 No direct stock edits

Users cannot directly overwrite a stock number.

Corrections require an adjustment movement and reason.

Status: LOCKED

## D-017 No historical rewriting

Changes to product name, price, cost, or customer data must not rewrite historical transaction snapshots.

Status: LOCKED

## D-018 V1 feature freeze

The following are deferred:

- customer mobile app
- advanced ecommerce website
- franchise system
- sales rep app
- supplier portal
- campaign/coupon engine
- loyalty redemption
- automated WhatsApp API
- route optimization
- manufacturing/production
- advanced accounting/general ledger
- AI features
- microservices
- event bus
- Redis unless proven necessary

Status: LOCKED

## D-019 First 30 days

After live launch, prioritize correctness and operational problems.

Do not add non-essential features during the first 30 days unless they address:

- inventory correctness
- money correctness
- security
- legal/compliance
- staff-blocking workflow failure
- repeated critical operational failure

Status: LOCKED

## D-020 Definition of launch readiness

Launch readiness is evidence-based.

The canonical end-to-end acceptance flow and critical replay/idempotency tests must pass before the system is called ready.

Status: LOCKED
