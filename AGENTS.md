# AGENTS.md — Pasalho Lite V1

Any coding agent working in this repository must read the product documentation before making changes.

## Mandatory reading order

1. `docs/DECISIONS.md`
2. `docs/FEATURE_SPECIFICATIONS.md`
3. `docs/PRD.md`
4. `docs/WORKFLOWS.md`
5. `docs/DATA_MODEL.md`
6. `docs/ROLES_PERMISSIONS.md`
7. `docs/ACCEPTANCE_TESTS.md`
8. `docs/ARCHITECTURE.md`
9. `docs/IMPLEMENTATION_PLAN.md`
10. `docs/CODING_AGENT_CONTRACT.md`

These files define the product. Do not redesign Pasalho Lite from assumptions.

## Product boundary

Pasalho Lite V1 is:

**1 warehouse → 1 store → POS → customers/loyalty → WhatsApp/phone COD orders → returns → expenses → daily close.**

Architecture:

**one repository + one Next.js/TypeScript application + Prisma + one PostgreSQL database.**

## Non-negotiable rules

- Do not add microservices.
- Do not add a second database.
- Do not add Redis unless explicitly approved after a proven need.
- Do not add a customer app.
- Do not add ecommerce checkout.
- Do not add automated WhatsApp integration.
- Do not add payment gateway APIs.
- Do not add loyalty redemption.
- Do not add franchise/multi-store product scope.
- Do not add AI.
- Do not build speculative future features.

## Correctness priorities

In order:

1. inventory correctness
2. money correctness
3. idempotency
4. authorization/security
5. data integrity
6. operational usability
7. visual polish

## Inventory

Every physical stock change must have an immutable InventoryMovement.

Never directly overwrite stock balances.

## Loyalty

Every loyalty effect must have a LoyaltyTransaction.

Locked earning rule:

**1 point for every cumulative NPR 500 of eligible spend, with spend remainder carried forward.**

V1 has no redemption.

## COD stock behavior

- NEW: no stock effect
- CONFIRMED: reserve
- PACKED: no stock effect
- DISPATCHED: consume reservation + deduct physical stock exactly once
- DELIVERED: no stock effect

Do not change this lifecycle without an approved documentation change.

## Reads

GET/read paths must not mutate business state.

## Transactions

Use database transactions for multi-record operations involving stock, money, reservations, loyalty, returns, or daily close.

## Idempotency

Retries must not duplicate:

- stock movements
- sales
- payments
- reservations
- loyalty
- returns
- daily close

## Server authority

Never trust browser-supplied totals, prices, stock, balances, loyalty points, roles, or payment state.

## Git

Before changes:

- inspect git status
- preserve unrelated work

Do not force-push or rewrite history.

Do not push unless explicitly asked.

## Completion

A feature is not complete because the UI exists.

It must satisfy the relevant acceptance tests in `docs/ACCEPTANCE_TESTS.md`.

When reporting work, distinguish:

- VERIFIED PASS
- PARTIAL
- FAILED
- NOT TESTED
- BLOCKED
