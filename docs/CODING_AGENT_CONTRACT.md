# Pasalho Lite V1 — Coding Agent Contract

This file is mandatory reading for any coding agent before modifying the repository.

The coding agent's job is to implement the approved product, not redesign it.

---

# 1. Source-of-truth order

When deciding what to build, follow this precedence:

1. DECISIONS.md
2. FEATURE_SPECIFICATIONS.md
3. PRD.md
4. WORKFLOWS.md
5. DATA_MODEL.md
6. ROLES_PERMISSIONS.md
7. ACCEPTANCE_TESTS.md
8. ARCHITECTURE.md
9. IMPLEMENTATION_PLAN.md

If two documents conflict, stop expanding scope and choose the interpretation that preserves:

- money correctness
- inventory correctness
- simpler architecture
- existing locked decisions

Document the conflict in the implementation report.

Do not silently invent behavior.

---

# 2. Mandatory pre-coding checklist

Before coding a phase:

- read the relevant docs
- inspect current git status
- inspect existing schema/migrations
- inspect current tests
- identify exact acceptance tests for the phase
- identify files that will change
- preserve unrelated user work

Do not begin by rewriting architecture.

---

# 3. Scope control

The agent must NOT:

- add unrequested features
- add "future-ready" services
- add Redis
- add message queues
- add microservices
- add event buses
- add second database
- add customer app
- add public ecommerce
- add loyalty redemption
- add payment gateway APIs
- add automated WhatsApp API
- add franchise/multi-store UI
- add complex accounting
- add AI features
- add design systems unrelated to V1 operation

If a library is proposed, it must solve a current V1 requirement.

---

# 4. Architecture rule

Use:

Next.js + TypeScript + Prisma + PostgreSQL

as one modular monolith.

Do not create a separate backend repository/service.

Server logic may be organized into modules/services, but deploy as one application.

---

# 5. Database rule

Never implement inventory or loyalty as only a mutable balance.

Inventory:

- InventoryMovement = durable evidence
- StockBalance = projection

Loyalty:

- LoyaltyTransaction = durable evidence
- LoyaltyAccount = projection

Money:

- Payment/CashMovement = durable evidence

Do not write helper functions that bypass these ledgers.

---

# 6. Transaction rule

Use database transactions for multi-record business operations.

Required transactional commands include:

- receipt posting
- transfer dispatch
- transfer receive
- POS finalize
- COD confirm/reserve
- COD dispatch
- COD delivery/payment/loyalty posting
- return/refund
- daily close where needed

Partial commits are unacceptable for these flows.

---

# 7. Idempotency rule

All high-risk commands must be retry-safe.

Use deterministic idempotency keys or database uniqueness constraints.

A replay must not duplicate:

- sale
- payment
- inventory movement
- reservation
- transfer movement
- loyalty transaction
- return
- daily close

Tests must replay critical commands.

---

# 8. State-machine rule

Do not update statuses with arbitrary strings.

Implement explicit allowed transitions.

Reject invalid transitions server-side.

Do not allow state regression unless an explicitly documented recovery/reopen action exists.

---

# 9. Server-authority rule

Never trust client values for:

- product price
- total
- stock
- reservation quantity validity
- payment status
- loyalty points
- loyalty balance
- daily close expected cash
- role/permission

The server recomputes and validates all critical values.

---

# 10. Read-path rule

GET/read operations must not mutate:

- inventory
- order status
- payment
- loyalty
- cash close
- audit state

Business writes must use explicit commands/actions.

---

# 11. Deletion rule

Do not hard-delete transactional history.

Avoid deleting:

- posted receipts
- transfers
- finalized sales
- payments
- orders
- inventory movements
- loyalty transactions
- returns
- daily closes
- audit logs

Use status/correction/reversal patterns.

---

# 12. Historical snapshot rule

Transaction lines must preserve historical values such as:

- SKU
- product name
- unit price
- quantity
- discount
- cost snapshot where required

Later catalog edits must not rewrite history.

---

# 13. Money rule

Use fixed-precision Decimal for money.

Never use JavaScript floating-point math as the final source for persisted money calculations.

Round consistently according to NPR operational requirements.

Tests must include decimal/rounding behavior where relevant.

---

# 14. Time rule

Persist timestamps safely.

Operational UI and daily-close boundaries must use Nepal business time.

Do not use client browser timezone as the sole source of operating date.

---

# 15. Authorization rule

Every mutation requires server-side role checks.

UI visibility is not security.

Tests must include denied-role cases.

---

# 16. Validation rule

Validate every mutation payload.

Reject:

- missing identifiers
- zero/negative quantities where invalid
- negative prices
- malformed phone values
- invalid status transitions
- excessive return quantities
- insufficient stock
- duplicate identifiers
- unauthorized commands

---

# 17. Inventory concurrency rule

The implementation must protect against simultaneous attempts to sell/reserve the same last units.

Use a database-safe strategy such as:

- transaction + row lock
- conditional update
- appropriate isolation level

Do not solve concurrency only with a browser check.

Add at least one concurrency test before launch.

---

# 18. UI rule

Operational UI should optimize for speed and clarity.

Do not prioritize decorative visuals over:

- barcode scanning
- fast product lookup
- stock clarity
- large totals
- clear payment buttons
- obvious order status
- obvious daily variance

No animation is required for V1.

---

# 19. Testing rule

For every implemented phase:

- add unit tests for pure business logic
- add integration tests for DB transaction behavior
- add route/action tests for permissions and validation
- run relevant acceptance tests

Do not mark a requirement complete without evidence.

---

# 20. Migration rule

Every schema change requires:

- Prisma schema update
- migration
- migration validation from empty database
- no manual production-only SQL dependency

Never use prisma db push as the production migration strategy.

---

# 21. Seed rule

Seed data may include:

- one warehouse
- one store
- initial Owner/Admin user in development/test only
- minimal reference data

Do not seed fake sales/orders into production.

---

# 22. Environment rule

Use environment variables for:

- DATABASE_URL
- auth/session secret
- base URL
- environment name
- optional printer/media config

Never commit secrets.

Provide .env.example with placeholders only.

---

# 23. Git rule

Before modifying:

- inspect git status
- preserve unrelated changes

When committing:

- commit only task-related files
- use descriptive commit messages
- do not rewrite user history
- do not force push
- do not push unless explicitly requested

---

# 24. Dependency rule

Prefer fewer dependencies.

Before adding a package, ask:

- Can current stack do this?
- Is the package maintained?
- Does it materially simplify a current requirement?

Do not add infrastructure libraries for hypothetical scale.

---

# 25. Error-handling rule

Business errors must be typed/structured enough for UI to show a useful message.

Do not convert every business failure into generic 500.

Do not expose raw SQL/Prisma errors to users.

---

# 26. Observability rule

At minimum log:

- request/correlation id
- business command name
- actor id
- entity id
- success/failure
- error category

Never log:

- passwords
- session secrets
- full auth tokens
- unnecessary customer-sensitive data

---

# 27. Performance rule

Optimize first for:

- POS search
- barcode lookup
- stock lookup
- sale finalization
- order lookup
- daily close

Use database indexes before adding caches.

---

# 28. Feature completion report

After completing a phase, report:

## Git

- branch
- git status --short
- files changed
- commit hash if committed

## Database

- migrations added
- migration-from-empty result

## Tests

For each command:

- exact command
- pass/fail
- number of tests

## Acceptance matrix

Use:

| Requirement | Result | Evidence |
|---|---|---|

Only use VERIFIED PASS when evidence exists.

## Remaining risks

List anything not proven.

---

# 29. Stop conditions

The coding agent should stop expanding the task if:

- required behavior is not documented
- a requested change conflicts with locked V1 decisions
- implementation would require a new service/database
- implementation would silently change inventory or money semantics
- current tests reveal a broader integrity issue

In that case, preserve the working code and report the exact conflict.

---

# 30. Final principle

Pasalho Lite is successful when store staff can operate it reliably.

The target is not the most sophisticated architecture.

The target is:

**correct stock + correct money + fast POS + reliable COD + correct loyalty + daily reconciliation.**
