# Pasalho Lite

Pasalho Lite is the deliberately small operating system for Pasalho's first physical retail operation.

Its purpose is not to reproduce the larger Pasalho platform. It exists to run one real business flow reliably:

**1 warehouse → 1 physical store → POS / WhatsApp-COD orders → inventory control → loyalty → daily reconciliation.**

## Product principle

Pasalho Lite must remain a **modular monolith** for V1:

- one repository
- one Next.js/TypeScript application
- one backend/API surface
- one PostgreSQL database
- Prisma ORM
- one source of truth for inventory, sales, customers, loyalty and daily closing

No microservices, Redis, event bus, separate commerce backend, separate loyalty backend, customer mobile app or system-to-system synchronization is required for V1.

## V1 modules

1. Dashboard
2. Products
3. Warehouse receiving
4. Warehouse → store transfers
5. Store inventory
6. POS
7. Customers
8. Loyalty earning
9. WhatsApp/phone COD orders
10. Returns/cancellations
11. Expenses and cash movements
12. Daily close/reconciliation
13. Users, roles and audit history

## Locked operating model

### Inventory

Inventory is movement-ledger driven. Stock-changing operations create immutable inventory movements. A stock balance may be maintained as a projection/cache, but staff must never directly overwrite stock without an adjustment movement and reason.

### POS

A finalized POS sale records the sale, payment, sale items, inventory deduction and loyalty effect atomically.

### WhatsApp/COD orders

WhatsApp is a communication channel only. Staff enter the order into Pasalho Lite. Confirmed orders reserve store inventory. Dispatch consumes the reservation and deducts physical store inventory once. Delivery does not deduct inventory again.

### Loyalty

Customers are identified by phone number. The earning rule is **1 point for every cumulative NPR 500 of eligible finalized spend**. Spend remainder carries forward across purchases. Returns reduce qualifying spend and loyalty is recalculated/reversed accordingly.

V1 earns and displays points only. **Point redemption is intentionally not enabled until Pasalho defines a redemption value and unit economics.**

### Daily close

Every operating day must end with a reconciliation showing expected cash, physical cash counted, variance, QR/non-cash sales, COD collected, expenses/refunds and unresolved exceptions.

## Documentation

The product specification is split into focused documents:

- [Product Requirements Document](docs/PRD.md)
- [Operational Workflows](docs/WORKFLOWS.md)
- [Data Model](docs/DATA_MODEL.md)
- [Roles & Permissions](docs/ROLES_PERMISSIONS.md)
- [Acceptance Tests & Release Gate](docs/ACCEPTANCE_TESTS.md)
- [Implementation Plan](docs/IMPLEMENTATION_PLAN.md)
- [Locked Product Decisions](docs/DECISIONS.md)

## V1 definition of done

Pasalho Lite is launch-ready only when this sequence passes repeatedly:

1. Receive 100 units into warehouse.
2. Warehouse on-hand becomes 100.
3. Dispatch 20 to store.
4. Warehouse on-hand becomes 80.
5. Receive transfer at store.
6. Store on-hand becomes 20.
7. POS sells 3.
8. Store on-hand becomes 17.
9. Customer orders 2 through WhatsApp/phone.
10. Confirmation reserves 2.
11. Dispatch consumes the reservation and store physical stock becomes 15.
12. Delivery does not change stock again.
13. COD collection is recorded correctly.
14. Loyalty points are correct.
15. Daily close calculates expected cash.
16. Staff enter actual cash.
17. Variance is displayed and persisted.
18. All values remain correct the next day.

## Scope discipline

For the first 30 days of real store operation, new features should be rejected unless they fix a legal, financial, inventory-integrity, security or store-blocking problem.

The goal is to operate the business reliably, not to maximize software features.
