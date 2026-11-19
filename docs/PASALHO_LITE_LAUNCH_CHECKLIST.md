# Pasalho Lite Launch Checklist

## Status

Launch readines status: **BLOCKED**

The core journey is implemented and passes automated tests, but launch should remain blocked until environment, staging, hardware, backup/restore, and purchase-receiving scope decisions are resolved.

## Branch and delivery

- Branch: `codex/pasalho-lite-launch-completion`
- Main merge: not performed
- Production deployment: not performed
- CEO Dashboard: unchanged

## Core operating journey

Canonical journey result: **VERIFIED PASS**

Verified sequence:

1. Purchase receipt 100 units
2. Warehouse onHand 100
3. Dispatch transfer 20
4. Warehouse onHand 80
5. Receive transfer 20 at store
6. Store onHand 20
7. POS sale 3
8. Store onHand 17
9. COD confirm/reserve 2
10. COD dispatch
11. Store onHand 15
12. COD deliver/payment
13. Loyalty and cash reconciliation remain consistent

## Verification evidence

| Check | Result | Evidence |
|---|---|---|
| Prisma schema validate | VERIFIED PASS | `npm run prisma:validate` |
| Migration from empty PostgreSQL | VERIFIED PASS | 17 migrations applied successfully |
| Seed operating locations and owner | VERIFIED PASS | one warehouse, one store, owner/admin |
| Vitest pristine serial suite | VERIFIED PASS | 24 files, 135 tests |
| Canonical E2E | VERIFIED PASS | warehouse 80, store 15, loyalty 1, close expected/actual/variance output |
| Migration test database | VERIFIED PASS | local PostgreSQL 18 |
| Parallel Windows suite | PARTIAL | 23/24 suites passed in one run; one worker crashed; serial rerun passed |
| CI workflow | NOT TESTED LOCALLY | Docker unavailable |
| Backup/restore test | PARTIAL | scripts and CI step exist; Docker local restore not executed |
| Staging deployment | NOT TESTED | no staging target or credentials provided |
| Hardware validation | NOT TESTED | barcode scanner and receipt printer not supplied |

## Schema and migration safety

- No schema changes were required for this audit completion
- No migration was added
- Existing 17 migrations are ordered and apply from empty PostgreSQL
- Do not use `prisma db push` for release deployment
- Use `prisma migrate deploy`

## Implemented operational features

- Supplier receipt support
- Goods receiving with unit cost and idempotency
- Inventory movement ledger and projections
- Owner/Admin stock adjustments
- Transfer create, ready, dispatch, receive, cancel and discrepancy history
- POS search/cart/payment/receipt
- Authoritative modern-trade quotes
- Historical cost snapshots and COGS evidence
- Store reservations for COD
- COD lifecycle and one-time dispatch deduction
- POS/COD returns
- Cash movements
- Daily close and reopen
- Loyalty ledger
- Audit and reporting

## Remaining blockers

1. Purchase order model, supplier product mapping, purchase terms, PO history, and PO partial receive workflow are outside the locked V1 docs and absent from the repository.
2. Damaged-goods receiving and batch/expiry fields are absent.
3. Formal stock-count/reconciliation workflow is absent.
4. Staging environment is untested.
5. Production PostgreSQL backup and restore has not been proven in this environment.
6. Barcode scanner and receipt printer hardware has not been proven.
7. Modern-trade pricing service staging credentials/endpoints are not available locally.
8. Full Windows parallel test stability should be investigated before relying on default execution in local releases.

## Deployment checklist

- [ ] Obtain staging database and environment secrets
- [ ] Apply migrations to staging copy
- [ ] Run CI migration, test, E2E, and restore stages
- [ ] Verify modern-trade POS/COD pricing in staging
- [ ] Verify backup restore
- [ ] Verify receipt printer
- [ ] Verify barcode scanner
- [ ] Complete one pilot-day simulation
- [ ] Review opening owner and staff accounts
- [ ] Confirm no fake sales/orders exist
- [ ] Run readiness endpoint
- [ ] Obtain owner approval
- [ ] Do not merge to `main` unless approved
- [ ] Do not deploy to production
