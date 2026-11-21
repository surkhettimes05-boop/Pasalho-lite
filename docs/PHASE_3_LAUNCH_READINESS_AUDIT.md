# Phase 3 launch-readiness audit

Scope: authentication, inventory, POS, staff-entered COD orders, returns, and
cash checkout. This audit used the existing V1 decisions and acceptance tests.
All integration reproduction used only the disposable `pasalho_lite_test`
database on localhost.

## Reproduced defects

### COD order creation ignored the production kill switch

- Evidence before the fix: no `ENABLE_REAL_CUSTOMER_ORDERS` setting or check
  existed in `src/lib/env.ts`, `src/modules/orders/order.service.ts`, or the
  order screen/action. A direct service call proceeded to quote pricing and
  committed a `NEW` order plus its pending COD payment.
- Reproduction: set `ENABLE_REAL_CUSTOMER_ORDERS=false`, then call
  `createCustomerOrder` as an authorized cashier with a valid test customer and
  SKU. The expected `CUSTOMER_ORDERS_DISABLED` rejection did not occur; the
  disposable database contained the new order and payment.
- Impact: production configuration could not reliably disable creation of
  real customer orders.
- Status: fixed with a default-off server-side gate and a hidden creation form
  when disabled. Existing order fulfillment and recovery remain available.

## Baseline verification

- Clean disposable database: 17 existing migrations applied successfully.
- Before adding the kill-switch regression test: all 24 test files passed,
  135 tests passed.
- The new regression test failed against the pre-fix service and confirmed the
  committed `NEW` order behavior above.

## Workflow review notes

- Authentication uses adaptive password hashes, generic invalid-credential
  responses, database-backed expiring sessions, HTTP-only strict cookies, and
  server-side role checks. An infrastructure failure during login was not
  translated into a safe staff message; this is addressed in this phase.
- POS, inventory, COD reservation/dispatch/delivery, return/refund, and cash
  operations have focused integration coverage for transactional effects and
  replay protection. The clean baseline suite passed those existing checks.
- Post-dispatch failed-delivery recovery exists as a return record with
  `RECOVERY`, requires all remaining goods physically returned, and does not
  support partial recovery. No broader recovery behavior is inferred here.

## Checks after changes

- **VERIFIED PASS** — Focused environment, authentication, and COD lifecycle
  tests: 15 passed.
- **VERIFIED PASS** — Full integration/unit suite after a clean reset of the
  disposable test database: 24 files, 139 tests passed.
- **VERIFIED PASS** — Canonical operating-day E2E with the modern-pricing mock:
  warehouse 100 → store 20 → POS 17 → COD dispatch 15; one loyalty point;
  expected cash Rs 2,150.00, counted cash Rs 2,100.00, variance Rs -50.00.
- **VERIFIED PASS** — TypeScript typecheck, ESLint, Prisma schema validation,
  and production build.
- **VERIFIED PASS** — All 17 existing migrations applied to the clean,
  disposable PostgreSQL test database. No schema change was required.
- **NOT RUN** — Live modern-trade pricing endpoint, live customer creation,
  production settings/data, and deployment. The canonical E2E used only the
  repository mock; no live customer order or payment was created.

## Remaining constraints

- `ENABLE_REAL_CUSTOMER_ORDERS` defaults to false. Keep it false in every
  production environment until credentialed end-to-end verification passes and
  the owner explicitly approves controlled order enablement. Production
  security validation runs when `APP_ENV` is production, or when
  `NODE_ENV` is production and `APP_ENV` is omitted.
- Post-dispatch COD recovery is supported only when all remaining items are
  physically returned together; partial failed-delivery recovery remains
  unsupported as specified by the existing V1 workflow.
- Production POS/COD pricing still depends on the configured authoritative
  modern-trade service. A live pricing integration was not exercised here.
