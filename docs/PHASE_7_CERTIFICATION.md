# Phase 7 — Staging Certification and Controlled Rollout

**Assessment date:** 2026-11-17
**Decision:** **NO-GO**
**Scope:** Pasalho Lite and Modern Trade membership and product-specific pricing candidate

## Decision

Do not deploy or enable production member pricing. This is a local certification of the current worktrees, not a staging or production certification. Critical real-world evidence is absent, and the candidate has no server-enforced member-pricing-off rollout control. `ENABLE_PROMOTION_ENGINE=false` does not disable the membership/pricing routes or calculator.

No staging or production configuration was changed. No deployment was performed. No production release approval was given or inferred.

## Candidate identity and evidence limits

| Repository | HEAD observed | Candidate status |
|---|---|---|
| Pasalho Lite | `69a38ee2395534697398c7079bb31741ccffbd2b` | Worktree already dirty; HEAD is not the tested candidate revision |
| Modern Trade | `bf554d21193ba04cba5d9bab3fdb815518280c94` | Worktree already dirty; HEAD is not the tested candidate revision |

Both repositories contained extensive pre-existing candidate changes. The hashes above identify only the base HEADs, not an immutable release. There are no deployment IDs, staging release hashes, or production migration records to report.

## Database certification

| Check | Result | Evidence / limitation |
|---|---|---|
| Lite migrations from empty database | **VERIFIED PASS** | All 13 migrations applied in order to a fresh disposable PostgreSQL database; the test seed completed. |
| Lite existing-schema/data copy | **PARTIAL** | A local development database backup (276,652 bytes) restored to a separate disposable database. `prisma migrate deploy` found no pending migrations. All 13 recorded migration checksums matched the current SQL files. Table-by-table historical row-count parity was not established. This was not a staging/production backup. |
| Modern Trade migrations from empty database | **VERIFIED PASS** | The isolated Jest PostgreSQL harness applied the manifest through migration 046. |
| Modern Trade existing-schema/data copy | **NOT TESTED** | No staging/production database copy or restore was available. |
| Migration ordering | **VERIFIED PASS, disposable databases only** | Lite's 13 migrations and Modern Trade's manifest through 046 were applied in manifest order. No production ordering evidence exists. |
| Foreign keys and indexes | **PARTIAL** | Fresh migration application and schema validation succeeded. No complete catalog-level constraint/index comparison against a staging or production schema was performed. |
| Historical data compatibility | **PARTIAL** | Lite restored and migrated a local development copy, but row-count/data parity was not established. Modern Trade historical-data compatibility was not tested. |
| No applied migration edited | **PARTIAL** | Lite's 13 migration checksums matched its local database migration records. Modern Trade has no available staging/production migration records against which to certify this condition. |
| Backup/restore | **PARTIAL** | Lite local development backup/restore succeeded. No production-like backup, restore rehearsal, or Modern Trade restore proof exists. |

Lite migration IDs and SHA-256 of each current `migration.sql`:

| Migration | SHA-256 |
|---|---|
| `20261002143000_phase_0_foundation` | `d93cb2b5f82db419952901c7e815b40ad68dbb37ec20d8149ed340ca3f6d7de0` |
| `20261002150000_phase_1_products_inventory` | `9d524011bf4d7f0bc614cc98954c3517745964cedd8c75988fa768fe99a187e1` |
| `20261002153000_phase_2_warehouse_receiving` | `6a829b012291e99fe4b2bed53bf9fb7bc34a45600da1e5eb5c9f96ac6e71d6aa` |
| `20261002160000_phase_3_warehouse_store_transfer` | `a5446e0ff6c6baedfcee501e750876bd64860b597bb9048e858e085128da3440` |
| `20261002163000_phase_4_pos` | `a3831f0e04729e55df90c41e53ea90d49a2a6de60b3aa7a03676282e79b8cc3f` |
| `20261002170000_phase_5_customers_loyalty` | `2c9443d109807f9caff3c1f500a87a4256669af8b630d2ac3331995ada808c9b` |
| `20261002173000_phase_6_cod_orders` | `a473d2a608935e14f3cdf241884398340f0b263f6efcc72ff312329c3388a2d4` |
| `20261002180000_phase_7_returns_refunds` | `2f3a6615a058e033f9b10fb222afdc6d674205443318d44a379bbb29a02190b8` |
| `20261002183000_phase_8_expenses_daily_close` | `549a140797737d2e0aa707159b596c958f19cb70f68a87b7d2dec11c182e31d` |
| `20261003100000_product_import_batch` | `1c100867792ae3109cb5c67218be449c55c91a6d65696590c5d82e27368f8036` |
| `20261116100000_membership_identity_mapping` | `9eb7fd86bef0543a264c40c3e7ea3ef6944fcf94c06621a131003a6d462ba524` |
| `20261117090000_authoritative_member_pricing` | `292dc6944911316912997cfe5bb61f09cf478d2c32db805b22f583f344c7fe7c` |
| `20261118100000_membership_number_snapshot` | `77745e2a974c75803dfcc1605a7cd92d945991d4eebf8d1a404449f153150f7b` |

Modern Trade membership migration IDs were applied after the existing manifest entries through `041_payment_evidence_engine`, in this order:

| Migration | SHA-256 |
|---|---|
| `042_membership_foundation.sql` | `1fd441977f284f0b462a2a21b5005f2cce42e676101d5406dc07019a98675f87` |
| `043_membership_integrity.sql` | `70f4d6503514f31783f2d2c372a36ca3a09b6fb2714b6e9d4b3d8b1a1c541932` |
| `044_member_pricing_engine.sql` | `2d30628c268ef76773d79dbbc7bcdb2031edfdc3f78f64e04deb98e5e8869127` |
| `045_member_pricing_quotes.sql` | `39d701b5bd08721832ad8057e4e246fde1dd5d984f652281ee81ced8f3631427` |
| `046_web_order_member_pricing_snapshots.sql` | `3871b78b4c93635ab38c815d6f8d65cd99a289cc8e778db717a7baac85cffa0f` |

These are hashes of the current worktree files, not proof of what is deployed in any external environment.
The Lite migration ID `20261118100000_membership_number_snapshot` is dated one day after this assessment; confirm that timestamp is intentional before cutting an immutable release.

## Automated command/output record

| Repository command | Recorded output |
|---|---|
| Lite `npm test` (`vitest run`) | 24 test files passed; 130 tests passed. |
| Lite pricing-module Vitest run | 7 tests passed. |
| Lite `npm run typecheck` | Passed. |
| Lite `npm run prisma:validate` | Passed. |
| Lite `prisma migrate deploy` on a fresh disposable database | 13 migrations applied successfully. |
| Lite `prisma migrate deploy` on the restored copy | No pending migrations. |
| Modern Trade backend `npm test` | 56 suites passed; 367 tests passed. |
| Modern Trade backend `npm run test:unit` | 33 suites passed; 176 tests passed. |
| Modern Trade backend `npm run type-check` | Passed. |

## Integration certification

| Required journey | Result |
|---|---|
| Verified OTP, enrollment, membership creation | **PARTIAL** — automated service tests passed; no real OTP delivery or live staging journey was run. |
| Admin creates/activates product-specific promotion | **PARTIAL** — automated coverage ran, but admin UI/API behavior was not certified in staging. |
| POS quote, sale, receipt saving, and return using paid amount | **PARTIAL** — Lite integration tests passed using a pricing-service mock; no live cross-repository sale/receipt/return journey was demonstrated. |
| Same eligible price on website and app | **PARTIAL** — shared Web/App pricing service tests passed; no browser test or physical/mobile-device evidence exists. |
| COD preserves accepted price | **PARTIAL** — relevant automated checkout/service tests ran; no staging COD order was completed and reconciled. |
| Suspended member receives regular price on next quote | **NOT TESTED** — no retained evidence demonstrates this exact state transition end to end. |

## Security certification

**PARTIAL.** Modern Trade's automated unit/security subset passed (33 suites, 176 tests), and the complete suite passed. Automated coverage includes quote authentication, expiry/replay behavior, membership service behavior, and protected-resource scope. This is not a complete security certification of the following production invariants:

- cashier override and manual-discount API bypass resistance;
- arbitrary tier selection and cross-customer access resistance;
- quote tampering/replay resistance across real services;
- production secret/signing-key exposure checks;
- unauthenticated promotion mutation resistance;
- complete organisation/store-scope enforcement and audit-event verification.

No production secrets were supplied, and no production environment or live service was probed.

## Performance and reliability

| Scenario | Result |
|---|---|
| Concurrent Founding 1,000 allocation | **VERIFIED PASS** in automated tests. |
| Concurrent pricing quote load | **NOT TESTED** as a load test. |
| Quote authentication, expiry, replay | **VERIFIED PASS** in automated tests; not a live-service drill. |
| Pricing service timeout / database interruption | **NOT TESTED** as failure drills. |
| Invalid quote and checkout fail-safe behavior | **PARTIAL** — quote validation tests passed; no complete live checkout fault-injection proof. |
| Duplicate checkout submission / idempotency under retry | **NOT TESTED** as a production-like retry drill. |

## Deployment preparation

### Configuration inventory

Use the repositories' example templates as the source of truth; configure real values only in each environment's secret manager:

- **Pasalho Lite:** `APP_ENV`, `DATABASE_URL`, `AUTH_SECRET`, `APP_URL`, `MODERN_PRICING_API_URL`, `MODERN_PRICING_SERVICE_TOKEN`, `MODERN_PRICING_STORE_REFERENCE`.
- **Modern Trade API:** `DATABASE_URL`, `MIGRATION_DATABASE_URL` when separately configured, `DATABASE_RUNTIME_ROLE`, `DATABASE_MIGRATION_ROLE`, `CORS_ORIGIN`, `APP_URL`, `JWT_SECRET`, `COOKIE_SECRET`, `ENCRYPTION_KEY`, `SIGNATURE_SECRET`, `MEMBER_PRICING_SERVICE_TOKEN`, `MEMBER_PRICING_QUOTE_SECRET`, `OTP_HASH_SECRET`, `PAYMENT_ENCRYPTION_KEY`, `PROXY_AUTH_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`, `SMS_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID`. The production runtime template also requires its configured data-service values, including `REDIS_URL` outside the worker runtime.

Generate unique random secrets for each secret field; keep quote-signing and service-authentication secrets separate. The Lite/Modern Trade service token must be provisioned consistently at both ends. Never put real values in source control, browser/mobile bundles, logs, or this evidence report. Use HTTPS for the service URL and least-privilege database roles.

### Required release order (not executed)

1. Produce reviewed, clean, immutable candidate commits and record their hashes.
2. Obtain approval and provision staging secrets, service/store mapping, and monitoring.
3. Implement and test a server-enforced member-pricing kill switch, default OFF. Confirm regular-price checkout remains correct while it is OFF.
4. Apply Modern Trade migrations `042`–`046`, then deploy the API with member pricing OFF.
5. Verify health, service authentication, real OTP, promotion lifecycle, and org/store scope in staging.
6. Configure Lite's HTTPS pricing URL, shared service token, and store reference; deploy with member pricing OFF.
7. Complete staging browser, mobile, POS, COD, return, suspension, reconciliation, fault-injection, and backup/restore evidence.
8. Enable only in an explicitly approved controlled rollout. Production remains OFF until a separate release approval.

**Current flag finding:** no dedicated member-pricing-off gate is wired to the new member-pricing routes/calculator. `ENABLE_PROMOTION_ENGINE=false` is not an adequate substitute. The required flag is a **BLOCKER**, not a configured rollout control.

### Rollback and recovery plan (not rehearsed)

- After the kill switch is implemented and verified, turn it OFF and stop new member-price quotes/checkouts before application rollback.
- Roll back application versions only after confirming backward compatibility with the already-applied additive schema.
- Do not reverse migrations as an ad hoc rollback. If database recovery is required, restore a verified backup to an isolated database, validate it, and switch over only under an approved recovery procedure.
- Reconcile pending sales, reservations, payments, returns, and inventory movements before reopening checkout.
- No production-like rollback or restore rehearsal has been performed; this plan is not evidence of recoverability.

## Final evidence register

| Evidence | Status |
|---|---|
| Lite full integration suite | **VERIFIED PASS** — 24 files, 130 tests |
| Lite pricing tests | **VERIFIED PASS** — 7 tests |
| Lite typecheck and Prisma validation | **VERIFIED PASS** |
| Modern Trade full Jest suite | **VERIFIED PASS** — 56 suites, 367 tests |
| Modern Trade unit/security subset | **VERIFIED PASS** — 33 suites, 176 tests |
| Modern Trade backend type-check | **VERIFIED PASS** |
| Lite fresh migration chain | **VERIFIED PASS** — 13 migrations |
| Lite restored local-development database copy | **PARTIAL** — restore and migrations verified; historical row-count parity not established |
| Deployment IDs | **NONE** — no staging or production deployment |
| Immutable candidate commit hashes | **NONE** — both worktrees are dirty; HEAD hashes above are base revisions only |
| Browser evidence | **NOT TESTED** |
| Mobile-device evidence | **NOT TESTED** |
| SKU reconciliation report | **NOT TESTED** |
| Cross-channel price parity report | **NOT TESTED** |
| Production-like backup/restore proof | **NOT TESTED** |
| Production release approval | **NOT GRANTED** |

**Formal decision: NO-GO.** Missing production/staging evidence, incomplete historical-data and restore evidence, and the missing enforced OFF switch fail the release gate. Do not enable production member pricing.

Related release references: [Modern Trade production readiness](../../modern-trade-website/PRODUCTION_READINESS.md), [Modern Trade release blockers](../../modern-trade-website/RELEASE_BLOCKERS.md), [Lite acceptance tests](./ACCEPTANCE_TESTS.md).
