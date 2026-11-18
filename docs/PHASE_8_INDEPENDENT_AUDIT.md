# Phase 8 — Independent Membership and Pricing Audit

**Assessment date:** 2026-11-18 | **Scope:** `surkhettimes05-boop/Pasalho-lite` and `surkhettimes05-boop/modern-trade-website`
**Decision:** **NO-GO**

## Repository identity and architecture

| Repository | Branch / HEAD | Actual architecture | Worktree |
|---|---|---|---|
| Pasalho Lite | `main` / `69a38ee2395534697398c7079bb31741ccffbd2b` | Next.js 16.4.6, TypeScript, Prisma, PostgreSQL; Lite stores an external membership identity and pricing snapshots, and calls Modern Trade for authoritative quotes. | Dirty; candidate changes are uncommitted. |
| Modern Trade | `main` / `bf554d21193ba04cba5d9bab3fdb815518280c94` | Fastify/TypeScript/PostgreSQL backend, Next.js 16.4.6 website, Flutter mobile app. The backend owns membership, promotions, and member-pricing quotes. | Dirty; candidate changes are uncommitted. |

These are base HEAD hashes, not immutable candidate release commits. No production or staging deployment, release commit, external database, real OTP provider, or mobile device was available to inspect. This report does not claim those environments were tested.

## A. Executive decision

**NO-GO — critical pricing and release requirements are incomplete or not verified.**

The backend contains substantial membership and product-pricing functionality. Local remediations have since added a default-off member-pricing gate, authoritative COD quote snapshots in Lite, store-scoped membership access, unique quote sale-reference claims, a COD channel, a return-loyalty reversal migration, and a member-pricing administration screen. The newly identified critical Next.js advisory has been patched in both frontends; production dependency audits now pass for Lite and the Modern frontend. Modern backend production dependencies still have seven moderate advisories, and all full audits retain high dev-toolchain findings. Static checks and database-backed migrations pass on fresh disposable PostgreSQL. However, loyalty earning remains active; staging, real cross-repository pricing, browser/mobile, existing-data migration, representative backup/restore, and production evidence remain unavailable. The release decision therefore remains NO-GO.

## B. Requirement traceability

| Requirement ID | Requirement | Repository | Actual implementation file / route | Test file | Test result | Evidence | Status |
|---|---|---|---|---|---|---|---|
| MEM-01 | Verified OTP enrollment, one membership per customer, unique membership number | Modern Trade | [`membershipService.ts`](../../modern-trade-website/backend/src/services/membershipService.ts); [`otpService.ts`](../../modern-trade-website/backend/src/services/otpService.ts); [`membership.ts`](../../modern-trade-website/backend/src/routes/membership.ts); [`042_membership_foundation.sql`](../../modern-trade-website/database/042_membership_foundation.sql) | `backend/src/services/__tests__/membershipService.test.ts`; `backend/src/routes/__tests__/membership.test.ts` | Backend Jest suite passed | Service requires verified active customer identity; OTP is digested, five-minute expiry/three attempts; DB has unique customer/org and org/number constraints. Real SMS delivery was not tested. | PARTIAL |
| MEM-02 | Founding 1,000 limit and concurrent allocation | Modern Trade | [`membershipService.ts`](../../modern-trade-website/backend/src/services/membershipService.ts); [`042_membership_foundation.sql`](../../modern-trade-website/database/042_membership_foundation.sql) | Membership service tests; backend Jest suite | 367/367 passed | Disposable PostgreSQL has 1–1,000 checks, unique allocation constraints, deferred founder-allocation triggers; concurrent-allocation tests ran. | PASS |
| MEM-03 | Duplicate registration, suspension/reactivation, server-assigned tier | Modern Trade | [`membershipService.ts`](../../modern-trade-website/backend/src/services/membershipService.ts); [`membership.ts`](../../modern-trade-website/backend/src/routes/membership.ts) | Membership service/route tests | Backend Jest suite passed | Unique customer/org constraint and audited status transitions; tier is selected server-side. | PASS |
| MEM-04 | Customer ownership; cashier cannot grant tiers or read outside assigned scope | Modern Trade | [`membership.ts`](../../modern-trade-website/backend/src/routes/membership.ts); membership-list service | `backend/src/routes/__tests__/membership.test.ts` | Earlier route suite passed; new scope regression passed in targeted suite | Customer-specific routes enforce identity; store-scoped listing/status operations now constrain records to assigned stores. No live API attack was run. | PASS |
| PROMO-01 | Explicit per-product member price and tier/channel/date/status eligibility | Modern Trade | [`memberPricingService.ts`](../../modern-trade-website/backend/src/services/memberPricingService.ts); [`044_member_pricing_engine.sql`](../../modern-trade-website/database/044_member_pricing_engine.sql) | `backend/src/services/__tests__/memberPricingService.test.ts` | Backend Jest suite passed | SKU-specific price rows and eligibility resolution are present; service tests exercise the rules. No configured production promotion was inspected. | PASS |
| PROMO-02 | Margin floor, conflict rejection, no unintended stacking | Modern Trade | [`memberPricingService.ts`](../../modern-trade-website/backend/src/services/memberPricingService.ts); `044_member_pricing_engine.sql` | Member-pricing service tests | Backend Jest suite passed | Resolver applies a 5% gross-margin floor and fails closed on missing costs; overlap/conflict rules are enforced in the service. | PASS |
| PROMO-03 | Rule versioning, audit history, historical price preservation | Modern Trade + Lite | [`memberPricingService.ts`](../../modern-trade-website/backend/src/services/memberPricingService.ts); [`044_member_pricing_engine.sql`](../../modern-trade-website/database/044_member_pricing_engine.sql); [`046_web_order_member_pricing_snapshots.sql`](../../modern-trade-website/database/046_web_order_member_pricing_snapshots.sql); [`pos.service.ts`](../src/modules/pos/pos.service.ts) | Pricing service tests; Lite POS/return integration tests | Backend and Lite suites passed | Immutable/versioned promotion history and new-sale/order quote snapshots exist. Historical production rows were unavailable, so backfill/data preservation is not proven. | PARTIAL |
| PROMO-04 | Admin promotion creation/activation interface and API | Modern Trade | [`memberPricing.ts`](../../modern-trade-website/backend/src/routes/memberPricing.ts); [`MemberPricingPage.tsx`](../../modern-trade-website/frontend/src/components/admin/MemberPricingPage.tsx) | `backend/src/routes/__tests__/memberPricing.test.ts`; no UI E2E | Backend API tests passed; frontend build passed | Admin can create drafts, preview, activate, pause, and archive with capability-gated controls; the backend remains authoritative. Browser workflow is not verified. | PARTIAL |
| API-01 | Modern Trade is authoritative; quotes are signed and expire | Modern Trade | [`memberPricingQuoteService.ts`](../../modern-trade-website/backend/src/services/memberPricingQuoteService.ts); [`memberPricingService.ts`](../../modern-trade-website/backend/src/services/memberPricingService.ts) | `backend/src/routes/__tests__/memberPricingService.test.ts` | Backend Jest suite passed | HMAC-SHA256 signed quotes, persisted token hashes, five-minute expiry, membership revalidation. | PASS |
| API-02 | Quote binds customer, cart, store, channel and price; rejects tampering/expiry/replay | Modern Trade | [`memberPricingQuoteService.ts`](../../modern-trade-website/backend/src/services/memberPricingQuoteService.ts) | Quote route/service tests | Backend Jest suite passed | Validation checks quote identity, customer, cart, store/channel, current membership and price. Same-quote replay to a different sale reference is tested. | PASS |
| API-03 | Single-use/idempotent quote consumption and authenticated Lite service calls | Both | [`memberPricingQuoteService.ts`](../../modern-trade-website/backend/src/services/memberPricingQuoteService.ts); Lite [`pricing.client.ts`](../src/modules/pricing/pricing.client.ts) | Quote service tests; Lite pricing-client tests | Migration 047/concurrency test passed previously; Lite pricing client 8/8 passed | Migration 047 restores unique non-null sale-reference claims and its concurrent test verifies a single winner. No real inter-service credential journey was run. | PARTIAL |
| LITE-01 | Lite POS uses authoritative quote through finalization, receipt and return | Pasalho Lite | [`pricing.service.ts`](../src/modules/pricing/pricing.service.ts); [`pos.service.ts`](../src/modules/pos/pos.service.ts); [`pos-register.tsx`](../src/components/pos-register.tsx); receipt page | `tests/phase4-pos.integration.test.ts`; `tests/phase7-pos-returns.integration.test.ts` | 130/130 passed | Quote is refreshed/revalidated, snapshots are stored, receipt savings are derived from snapshots, and refund uses original paid line amount. The Modern service was mocked in Lite tests. | PARTIAL |
| LITE-02 | Lite COD order preserves accepted member quote | Pasalho Lite | [`order.service.ts`](../src/modules/orders/order.service.ts); [`pricing.service.ts`](../src/modules/pricing/pricing.service.ts) | `tests/phase6-cod-safeguards.integration.test.ts`; pricing client/schema tests | Pricing client/schema tests 8/8 passed; database-backed COD tests not run | Order creation requests and validates an authoritative COD quote, then persists its accepted price and quote snapshot. Service-failure/idempotency integration cases are added but remain unexecuted. | PARTIAL |
| LITE-03 | No competing Lite promotion engine; SKU/regular-price parity | Pasalho Lite + Modern Trade | Lite [`pricing.service.ts`](../src/modules/pricing/pricing.service.ts) reconciliation; Modern resolver | Pricing reconciliation unit tests | Lite tests passed | Lite does not own promotion rules, but no real SKU reconciliation or regular/member-price parity dataset/report was available. | NOT VERIFIED |
| POS-01 | Member identify/remove, cart recalculation and automatic pricing | Pasalho Lite + Modern Trade | Lite [`pos-register.tsx`](../src/components/pos-register.tsx); Modern [`posService.ts`](../../modern-trade-website/backend/src/services/posService.ts) | Lite POS integration; Modern POS/service tests | Both suites passed | Customer/cart changes trigger authoritative repricing in the implementations; Lite tests use a mock pricing service. | PASS |
| POS-02 | Quote expiry and validation before finalization | Both | Lite [`pos.service.ts`](../src/modules/pos/pos.service.ts); Modern [`posService.ts`](../../modern-trade-website/backend/src/services/posService.ts) | Quote and POS tests | Both suites passed | Expired/invalid quotes are rejected by the tested services. | PASS |
| POS-03 | No manual cashier price/discount or trusted client total | Both | Lite POS schemas/service; Modern [`posService.ts`](../../modern-trade-website/backend/src/services/posService.ts) | Lite `phase4-pos.integration.test.ts`; Modern POS/security tests | Both suites passed | Lite rejects submitted manual price fields; Modern resolves price server-side. No separate live cashier API attack was sent. | PASS |
| POS-04 | Atomic sale/payment/stock changes and idempotent finalization | Pasalho Lite | [`pos.service.ts`](../src/modules/pos/pos.service.ts) | POS/concurrency integration tests | 130/130 passed | Local database integration coverage passes; no production payment/inventory regression was executed. | PASS |
| POS-05 | Receipt savings and returns use actual paid price | Pasalho Lite | Receipt page; [`return.service.ts`](../src/modules/returns/return.service.ts) | POS/return integration tests | 130/130 passed | Snapshot and refund allocation behavior is covered in the isolated Lite database. | PASS |
| POS-06 | POS quote is from the real Modern service, not a mock | Both | Lite pricing client; Modern quote API | No cross-repository integration suite | Not run | The Lite POS integration tests install a fake Modern pricing service; no live local API-to-API sale was run. | PARTIAL |
| WEB-01 | Enrollment/card and guest/member prices in listings and detail pages | Modern Trade | [`CommerceClient.tsx`](../../modern-trade-website/frontend/src/components/CommerceClient.tsx); [`membership/page.tsx`](../../modern-trade-website/frontend/src/app/membership/page.tsx) | No membership-specific browser test | Browser suite failed before page access | Source paths exist, but real UI/browser pricing and card behavior were not demonstrated. | PARTIAL |
| WEB-02 | Cart/checkout refresh, expiry and price-change confirmation | Modern Trade | [`checkout/page.tsx`](../../modern-trade-website/frontend/src/app/checkout/page.tsx); `CommerceClient.tsx` | No membership-specific browser test | Browser suite failed before page access | Source submits signed quotes and handles changed prices; no working browser session/API was available. | PARTIAL |
| WEB-03 | Customer ownership and accepted COD price snapshot | Modern Trade | [`checkoutService.ts`](../../modern-trade-website/backend/src/services/checkoutService.ts); `046_web_order_member_pricing_snapshots.sql` | Checkout/COD service tests | Backend suite passed | Server snapshot logic is tested, but no browser checkout/COD journey was completed. | PARTIAL |
| APP-01 | Mobile membership enrollment/card and eligible product prices | Modern Trade | [`membership_screen.dart`](../../modern-trade-website/modern_trade_flutter/lib/screens/membership_screen.dart); [`member_pricing_repository.dart`](../../modern-trade-website/modern_trade_flutter/lib/repositories/member_pricing_repository.dart) | Flutter tests unavailable | `flutter test` could not start | Flutter/Dart is not installed in the audit environment; implementation was not device-verified. | NOT VERIFIED |
| APP-02 | Mobile cart/checkout refresh and accepted COD quote | Modern Trade | [`checkout_repository.dart`](../../modern-trade-website/modern_trade_flutter/lib/repositories/checkout_repository.dart); checkout screen | Flutter tests unavailable | `flutter test` could not start | Source sends the quote with COD checkout; no mobile test or device run. | NOT VERIFIED |
| APP-03 | App/Web price parity and customer ownership on device | Modern Trade | Website/app pricing repositories | No device or shared pricing dataset | Not run | No real customer/SKU/tier/channel comparison was possible. | NOT VERIFIED |
| ADM-01 | Protected promotion APIs and audit events | Modern Trade | [`memberPricing.ts`](../../modern-trade-website/backend/src/routes/memberPricing.ts); [`memberPricingService.ts`](../../modern-trade-website/backend/src/services/memberPricingService.ts) | `backend/src/routes/__tests__/memberPricing.test.ts` | Backend suite passed | API create/update/activation and service audit/version history are present and tested. | PASS |
| ADM-02 | Promotion management UI | Modern Trade | [`MemberPricingPage.tsx`](../../modern-trade-website/frontend/src/components/admin/MemberPricingPage.tsx); [`AdminWorkspace.tsx`](../../modern-trade-website/frontend/src/components/admin/AdminWorkspace.tsx) | No UI E2E test | Frontend lint/type-check/build passed | The protected administration route now exposes draft creation, preview and status transitions; actual authenticated browser workflow is not verified. | PARTIAL |
| RET-01 | POS returns use paid amount | Pasalho Lite | [`return.service.ts`](../src/modules/returns/return.service.ts) | `tests/phase7-pos-returns.integration.test.ts` | Passed in full Lite suite | Refund is allocated from original sale line amount/discount, not current product price. | PASS |
| RET-02 | New Web/COD orders preserve accepted quote and historical price | Modern Trade | [`checkoutService.ts`](../../modern-trade-website/backend/src/services/checkoutService.ts); migration 046 | Checkout/COD service tests | Backend suite passed | New order snapshots exist and are tested. Historical existing orders were not copied/migrated in this audit. | PASS |
| RET-03 | Web return/refund reverses loyalty correctly; historical records retained | Modern Trade + both | [`049_web_order_loyalty_return_reversal.sql`](../../modern-trade-website/database/049_web_order_loyalty_return_reversal.sql); [`orderLifecycleService.ts`](../../modern-trade-website/backend/src/services/orderLifecycleService.ts) | `backend/src/services/__tests__/loyaltyMvpService.test.ts` | Regression test added; migration/test not run in this continuation | Migration 049 covers the intermediate return statuses and an idempotent ledger reversal. Historical-data preservation and the new trigger test remain unverified. | PARTIAL |
| LOY-01 | New loyalty earning disabled | Both | Lite [`loyalty.service.ts`](../src/modules/loyalty/loyalty.service.ts); Modern `022_nepal_loyalty_mvp.sql` | Loyalty integration/unit tests | Tests pass for current behavior | Lite earning defaults on unless explicitly disabled; Modern DB triggers award points for completed POS sales and delivered Web orders. | FAIL |
| LOY-02 | Redemption disabled | Both | Lite `LOYALTY_REDEMPTION_ENABLED`; Modern loyalty APIs/services | Loyalty tests | Tests passed | Lite redemption defaults off and no redemption flow was found; no Modern redemption flow was found. | PASS |
| LOY-03 | Legacy earning/API cutover, historical ledger preservation, no points UI | Both | Modern `022_nepal_loyalty_mvp.sql`, `/loyalty`; Lite loyalty service/UI | Browser and ledger migration tests unavailable | Not verified | Modern still advertises a loyalty page and has earning triggers; no old-ledger copy/row-parity evidence exists. | FAIL |
| SEC-01 | Authentication/role enforcement for promotion mutation and cashier price controls | Modern + Lite | Protected operations, `memberPricing.ts`, POS services | Modern security/unit tests; Lite POS tests | Executed suites passed | No bypass was demonstrated by the automated suites. No attack was sent to a live/staging service. | PASS |
| SEC-02 | Store/customer scope for membership records | Modern Trade | [`membership.ts`](../../modern-trade-website/backend/src/routes/membership.ts) and membership-list service | `backend/src/routes/__tests__/membership.test.ts` | Store-scope regression passed in targeted suite | List and status mutation now enforce assigned-store ownership in the service query. No live attack was run. | PASS |
| SEC-03 | Quote signature, expiry, cart/channel binding and replay | Modern Trade | [`memberPricingQuoteService.ts`](../../modern-trade-website/backend/src/services/memberPricingQuoteService.ts); migrations 045–047 | Quote service tests; concurrent shared-reference test | Existing tamper/expiry/replay and migration 047 test passed | Signature, cart/channel binding, expiry and quote use are covered; a unique partial claim index prevents distinct quotes from sharing a sale reference. No live service attempt was run. | PASS |
| SEC-04 | Service credential protection and complete audit evidence | Both | Environment validation, server-to-server client, audit services | Config/security tests | Suites passed | No production credentials were available; actual secret-manager handling and live credential misuse remain unverified. | PARTIAL |
| DB-01 | Fresh migrations, ordering, constraints and indexes | Both | Lite Prisma migrations; Modern `migrations.json` and migration runner | Migration deploy and Jest migration setup | Lite 14/14 and Modern 48 applicable manifest entries pass on fresh PostgreSQL; targeted suites pass | Lite COD snapshot migration and Modern 048–049 are verified on fresh disposable databases. Production migration state and applied-migration history remain unavailable. | PASS |
| DB-02 | Existing-data migration, backup/restore, rollback, no applied migration edits | Both | Migration files and runners | No existing-data/restore test available | Not run | No production/staging migration records or historical database copy. Disposable databases were fresh and empty before test seed. | NOT VERIFIED |
| DEP-01 | Real SKU mapping, regular-price parity and same configured price across channels | Both | Lite reconciliation service; Modern resolver/Web/app | No real catalog parity test | Not run | No staging product catalogue or reconciliation report; no configured promotion/customer dataset. | NOT VERIFIED |
| DEP-02 | Default-off member-pricing flag | Modern Trade | [`releaseFeatures.ts`](../../modern-trade-website/backend/src/config/releaseFeatures.ts); [`memberPricingService.ts`](../../modern-trade-website/backend/src/services/memberPricingService.ts); Wrangler config | `backend/src/config/__tests__/releaseFeatures.test.ts`; member-pricing service test | Feature-flag test passed; no production deployment | The authoritative resolver honors `ENABLE_MEMBER_PRICING`, default OFF in templates/config. Staging and production values/behavior remain NOT VERIFIED. | PARTIAL |
| DEP-03 | Environment/secret/service-auth/HTTPS configuration ready for production | Both | Example env files; Lite pricing client; Modern environment validation | Config/security tests | Local tests passed | Templates name required app/database URLs, `MODERN_PRICING_API_URL`, `MODERN_PRICING_SERVICE_TOKEN`, `MODERN_PRICING_STORE_REFERENCE`, `MEMBER_PRICING_SERVICE_TOKEN`, `MEMBER_PRICING_QUOTE_SECRET`, OTP, session/JWT, encryption, proxy, and database-role settings. No real secret-manager values or deployed service were verified. | PARTIAL |
| DEP-04 | Logging, monitoring, backup/restore, rollback and deployment evidence | Both | Deployment templates / runbooks | No staging/production test | Not run | No deployment IDs, live alerts, restore rehearsal, rollback proof, or release approval. | NOT VERIFIED |
| TEST-01 | Lite lint, type-check, Prisma validation, build and fresh migration | Pasalho Lite | Package scripts / Prisma migrations | COD pricing client/schema tests | Lint/type-check and 8 targeted tests passed; new DB migration not run | Earlier full suite passed 130/130; Lite COD migration and newly added COD database tests were not run against PostgreSQL. | PARTIAL |
| TEST-02 | Modern backend lint, type-check, build, migration and full Jest suite | Modern Trade | Backend scripts and migration runner | Feature-flag and migration-runner unit tests | Lint/type-check/build passed; 48 fresh migrations applied; 27 targeted COD/loyalty/pricing tests passed | The COD journey assertion was corrected to require 48 migrations and 048/049 explicitly. Earlier full suite passed 56 suites / 367 tests; browser/cross-system staging remains unexecuted. | PARTIAL |
| TEST-03 | Modern frontend lint, type-check and production build | Modern Trade | Frontend scripts | `npm run lint`, `npm run type-check`, `npm run build` | PASS; lint reports one pre-existing warning | Membership page lint issue was fixed; all commands exit 0. `LiveOrderConsole.tsx` still has one unrelated exhaustive-deps warning. | PASS |
| TEST-04 | Browser E2E, mobile device tests and live cross-repository journey | Both | Playwright config; Flutter test configuration | `npm run test:e2e`; `flutter test` | Browser failed; Flutter unavailable | Browser target did not have a server; QA password missing. Flutter CLI/device was unavailable. No real cross-repository test was run. | NOT VERIFIED |

## C. Completion percentage

Percentages below are **fully verified checklist groups / total groups** from the traceability rows above. Each group is equally counted; PARTIAL, FAIL and NOT VERIFIED receive no credit. This is an evidence-coverage ratio, not a claim about code volume or a weighted product estimate.

| Area | Fully verified / total | Completion |
|---|---:|---:|
| Backend membership | 3 / 4 | 75% |
| Promotion engine | 2 / 4 | 50% |
| Pricing API | 2 / 3 | 67% |
| Lite integration | 0 / 3 | 0% |
| POS | 5 / 6 | 83% |
| Website | 0 / 3 | 0% |
| Mobile app | 0 / 3 | 0% |
| Admin interface | 1 / 2 | 50% |
| Returns and historical records | 2 / 3 | 67% |
| Loyalty cutover | 1 / 3 | 33% |
| Security | 3 / 4 | 75% |
| Testing | 1 / 4 | 25% |
| Deployment readiness | 0 / 4 | 0% |

## D. Critical and high-priority failures

1. **HIGH — loyalty earning cutover remains unresolved.** Lite earning is still active unless configured otherwise, and Modern's loyalty triggers continue awarding points. The product documentation conflicts with the requested cutover, so no loyalty-disable change was made without approval. **Impact:** V1 still earns/advertises points. **Required correction:** approve a product-compatible cutover, preserve the historical ledger, then disable every earning path and remove points advertising.
2. **MEDIUM — representative existing-data migration and recovery proof remains incomplete.** Lite's 14-migration chain and Modern's 48 applicable manifest entries now apply to fresh disposable PostgreSQL, and 27 targeted Modern COD/loyalty/pricing tests plus Lite's 135-test suite pass. Backup/restore was also proved for Lite. **Impact:** fresh-schema behavior is verified, but a copy of historical data and Modern recovery evidence are not. **Required correction:** run existing-data-copy migrations and Modern backup/restore/rollback rehearsals.
3. **HIGH — no real cross-repository price parity evidence.** Lite COD now requests Modern's authoritative COD quote, but the service journey, production SKU map, regular-price parity, and accepted-price parity across POS/Web/App/COD remain untested. **Impact:** an integration mismatch could still affect charged prices. **Required correction:** run the authenticated end-to-end staging journey and publish SKU/price reconciliation.
4. **HIGH — deployment and data recovery evidence is absent.** No production/staging deployment, live secret configuration, monitoring proof, backup/restore rehearsal, existing-data migration, or rollback was available. **Impact:** safe operational rollout cannot be established. **Required correction:** complete the staged release checklist and record verifiable deployment/recovery evidence.
5. **MEDIUM — promotion admin browser workflow is unverified.** The authorized member-pricing UI now supports draft creation, preview and status transitions; only lint/type/build validation ran. **Impact:** the required workflow may still fail for an authenticated approver. **Required correction:** run browser tests against the configured QA backend.
6. **MEDIUM — browser/mobile release coverage remains unavailable.** The prior Playwright run had no server/QA password; Flutter tooling/device tests are unavailable. **Impact:** Web/App parity, checkout refresh, price-change confirmation, and device ownership behavior remain unverified. **Required correction:** run the configured browser and mobile suites.
7. **MEDIUM — Modern backend production dependencies still have unresolved advisories.** The latest production audit reports seven moderate findings in OpenTelemetry HTTP instrumentation and the `glob`/`minimatch` chain. The compatible audit fix did not remove them; updating OpenTelemetry requires aligning its SDK/API peer versions. **Impact:** runtime dependency exposure remains. **Required correction:** update and test the compatible dependency groups, then require a clean production audit before release.
8. **HIGH — development toolchains retain a picomatch ReDoS advisory.** Full audits report vulnerable `picomatch` versions (≤4.0.7) in dev-only dependency trees: Lite 16 high advisories, Modern frontend 14, and Modern backend 50 total findings (40 high, 10 moderate). **Impact:** build/test tooling remains exposed to crafted glob patterns; this did not appear in the production-only audits for Lite or the Modern frontend. **Required correction:** update the affected toolchain dependencies without unverified major downgrades, or document and approve the residual risk.

## E. Test evidence

Commands were run on isolated local resources unless stated. A first npm attempt failed because C: had zero free space; reruns redirected npm/temp caches to D:. No production/staging data was used.

| Exact command | Repository / environment | Result | Failures / skips / relevant output |
|---|---|---|---|
| `npm run lint` | Lite | PASS | Exit 0. |
| `npm run typecheck` | Lite | PASS | Exit 0. |
| `npm run prisma:validate` | Lite | PASS | “The schema … is valid.” |
| `npm run db:migrate:deploy` | Lite, fresh disposable PostgreSQL on 55435 | PASS | Applied 13/13 migrations, including all three membership/pricing migrations. |
| `npm run db:seed` | Lite, same disposable DB | PASS | Seeded one warehouse, one store, and test owner/admin. |
| `npm test` (initial, without seed variables) | Lite, disposable DB | FAIL — setup | 3 failed, 16 passed, 111 skipped; setup could not find `SEED_OWNER_EMAIL`/seeded data. This was rerun correctly. |
| `npm test` (seeded) | Lite, disposable PostgreSQL | PASS | 24 files, 135 passed, 0 skipped. Deprecation warnings from `pg` about concurrent `client.query()` calls. |
| `npm run db:migrate:deploy`; `npm run db:seed` | Lite, fresh disposable PostgreSQL on 127.0.0.1:55435 | PASS | 14 migrations applied in order and seed created 1 owner, 1 store, 1 warehouse, 20 products, 57 inventory movements. |
| `pg_dump ... --format=custom`; `pg_restore --clean --if-exists` | Lite, disposable PostgreSQL | PASS | 165129-byte backup restored; restored database has 14 migrations, 1 user, 2 locations, 20 products, 57 inventory movements, and both append-only triggers enabled. |
| `npm run build` | Lite | PASS | Next.js 16.4.6 production build completed after dependency remediation. |
| `npm run release:e2e` | Lite | NOT RUN after remediation | The missing package was added and the script now enables Node's `react-server` condition. End-to-end execution was withheld because it mutates database records and no dedicated disposable database was available. |
| `npm run lint` | Modern Trade backend | PASS | Exit 0. |
| `npm run type-check` | Modern Trade backend | PASS | Exit 0. |
| `npm run build` | Modern Trade backend | PASS | `tsc` exit 0. |
| `npm run db:migrate --prefix D:\brand\modern-trade-website\backend` | Modern Trade, fresh disposable PostgreSQL | PASS | Applied manifest entries 001–018 and 020–046. Migration 019 is absent from the manifest. |
| `npm run test:ci --prefix D:\brand\modern-trade-website\backend` | Modern Trade, dedicated isolated DB on 127.0.0.1:55433 named `storesync_jest_test` | PASS | 56 suites passed; 367 tests passed; 0 skipped. Runtime 601.514 s. An initial run against the wrong database target was safely rejected by the harness. |
| `npm run lint` (initial) | Modern Trade frontend | FAIL — baseline | One membership-page `react-hooks/set-state-in-effect` error and one unrelated `LiveOrderConsole.tsx:188` warning. The error was fixed in the current worktree. |
| `npm run type-check` | Modern Trade frontend | PASS | Exit 0. |
| `npm run build` | Modern Trade frontend | PASS | Next.js 16.4.6 production build completed after dependency remediation. |
| `npm run test:e2e` | Modern Trade frontend, default config | FAIL | 164 total: 159 failed, 5 skipped. Errors included `net::ERR_CONNECTION_REFUSED`/`ECONNREFUSED 127.0.0.1:3032` and missing `QA_BOOTSTRAP_ADMIN_PASSWORD`. The config does not start a web server; no membership-specific browser parity was demonstrated. |
| `flutter test` | Modern Trade Flutter app | NOT RUN | `flutter` is not installed (`CommandNotFoundException`). |
| `npm test -- src/modules/pricing/pricing.client.test.ts src/modules/pricing/pricing.schemas.test.ts` | Lite | PASS | 2 files; 8 tests passed; 0 skipped. |
| `npm run lint`; `npm run typecheck` | Lite, after COD changes | PASS | Both exit 0. |
| `node --conditions=react-server --import tsx -e "import('server-only')..."` | Lite | PASS | Confirms the server-only marker resolves under the release runner's Node condition; this is not an E2E result. |
| `npm run lint`; `npm run type-check`; `npm run build` | Modern Trade backend | PASS | All exit 0 after the local remediations. |
| `npm test -- --runInBand src/config/__tests__/releaseFeatures.test.ts src/database/__tests__/migrationRunner.test.ts` | Modern Trade backend | PASS | 2 suites; 4 tests passed; 0 skipped. |
| `npm run db:migrate` | Modern Trade, fresh disposable PostgreSQL on 127.0.0.1:55433 | PASS | Applied all 48 applicable manifest entries, including migrations 048 and 049. |
| `npm test -- --runInBand [COD/loyalty/pricing suites]` | Modern Trade, clean dedicated `storesync_jest_test` database | PASS | 4 suites, 27 tests passed, 0 skipped. The migration assertion was updated to require 48 entries and explicitly verify 048/049. |
| `npm run lint`; `npm run type-check`; `npm run build` | Modern Trade frontend | PASS | All exit 0. Lint reports one pre-existing warning in `LiveOrderConsole.tsx:188`. |
| `npm test -- src/modules/pricing/pricing.client.test.ts src/modules/pricing/pricing.schemas.test.ts` | Lite, after dependency remediation | PASS | 2 files; 8 tests passed; 0 skipped. |
| `npm run lint`; `npm run typecheck`; `npm run build` | Lite, after dependency remediation | PASS | All exit 0; production build used Next.js 16.4.6. |
| `npm run lint`; `npm run type-check`; `npm run build` | Modern Trade frontend, after dependency remediation | PASS | All exit 0; production build used Next.js 16.4.6. One pre-existing lint warning remains. |
| `npm run lint`; `npm run type-check`; `npm run build` | Modern Trade backend, after compatible dependency updates | PASS | All exit 0. |
| `npm run test:ci -- src/config/__tests__/releaseFeatures.test.ts src/database/__tests__/migrationRunner.test.ts` | Modern Trade backend, after compatible dependency updates | PASS | 2 suites; 4 tests passed; 0 skipped. |
| `npm audit --omit=dev` | Lite | PASS | 0 production vulnerabilities after updating Next.js, Zod, and compatible transitive dependencies. |
| `npm audit --omit=dev` | Modern Trade frontend | PASS | 0 production vulnerabilities after updating Next.js and compatible transitive dependencies. |
| `npm audit --omit=dev` | Modern Trade backend | FAIL — advisories remain | 7 moderate findings: OpenTelemetry HTTP instrumentation and `glob`/`minimatch` dependency paths. |
| `npm audit` | Lite / Modern frontend / Modern backend | FAIL — development dependency advisories remain | 16 high / 14 high / 50 total (40 high, 10 moderate), respectively; `picomatch` ≤4.0.7 is the common high-severity advisory. |
| `git -C 'D:\brand\modern-trade-website' diff --check` | Modern Trade worktree | FAIL — whitespace check | Reports trailing whitespace on every added line of the already-modified `frontend/src/app/cart/page.tsx`; preserved without unrelated edits. |
- **Database status:** PostgreSQL 18 disposable clusters were started successfully on ports 55435 (Lite) and 55433 (Modern). Lite applied 14 migrations and Modern applied all 48 applicable manifest entries. Lite 135/135 tests and Modern 27 targeted COD/loyalty/pricing tests pass.

## F. Data integrity report

- **Migrations:** Lite applied 14/14 migration directories on PostgreSQL 18, including the COD authoritative-pricing snapshot migration. Modern applied 48 applicable manifest entries on PostgreSQL 18, including migrations 048 and 049. Prisma migration checksums and the Modern `schema_migrations` rows are recorded in the disposable runs. No old migration SQL file was edited. Production applied-migration history remains unavailable.
- **Constraints:** Earlier Modern disposable PostgreSQL checks confirmed membership uniqueness/ranges, promotion/product/tier/channel keys, and related foreign keys/checks. Migration 047 restores a unique partial quote sale-reference claim index and its concurrent test passed. The COD channel constraint (048), loyalty reversal trigger (049), and Lite snapshot/immutability migration remain unverified against PostgreSQL. Lite has no local membership/promotion tables; it stores `Customer.membershipIdentityId` and sale/order price snapshots.
- **Historical data:** both migration chains were applied to empty databases. No copy of existing data was migrated in this audit; historical row preservation, backfill, and legacy ledger continuity are **NOT VERIFIED**.
- **SKU mapping / price parity:** no SKU reconciliation report or real customer/SKU/tier/channel price comparison was available. **NOT VERIFIED.**
- **Membership allocation:** database uniqueness/range constraints and concurrent-allocation tests passed in Modern Trade's disposable suite. No live campaign allocation was run.
- **Quote consumption:** signature/expiry/replay tests passed; migration 047 and its concurrent two-quote/same-reference test passed previously. No live inter-service claim or duplicate completed sale was exercised.
- **Sale/payment/stock:** Lite isolated POS/inventory/refund integration tests passed before the COD snapshot change. New COD price/failure/idempotency tests are present but not run. Modern checkout/POS service tests passed previously. No production provider or cross-repository finalization was exercised.
- **Backup/restore and rollback:** Lite custom-format backup/restore passed. The 165129-byte dump restored 14 migrations, 1 user, 2 locations, 20 products, 57 inventory movements, and enabled append-only triggers. Representative historical-data migration, Modern backup/restore, and production rollback proof remain NOT TESTED.

## G. Security report

Security review was source/test and dependency-audit based. No production or staging endpoint was attacked and no real credential was available. Findings are listed below; the two-quote claim case did not demonstrate a second sale.

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| 1 | 🟡 MEDIUM | `backend/src/routes/membership.ts` | 195-200, 264-273 | Original store-scoped `membership.read` could list memberships across the organization. Current list/status routes pass store scope to the service; regression tests pass, but no live retest was performed. | 8/10 |
| 2 | ⚪ LOW | `database/046_web_order_member_pricing_snapshots.sql` | 1-5 | Non-unique claimed-sale-reference index permits two distinct quote IDs to be claimed against the same sale reference; migration 047 restores uniqueness, but no live retest was performed. | 9/10 |
| 3 | 🔴 CRITICAL | Lite `package.json`; Modern frontend `package.json` | 33; 24 | Next.js 16.3.8 was in a critical advisory range, including unauthenticated RCE/DoS cases. Both worktrees now pin 16.4.6 and production-only audits report zero findings; deployment is not verified. | 9/10 |
| 4 | 🟠 HIGH | Lite `package.json`; Modern backend `package-lock.json` | 39; 11016 | Zod versions were vulnerable to memory exhaustion on oversized constrained collections. Lite now pins 4.6.7 and the Modern backend lockfile no longer resolves a vulnerable Zod version. | 9/10 |
| 5 | 🟡 MEDIUM | Modern backend `package-lock.json` | 3442 | OpenTelemetry HTTP instrumentation below 0.222.0 can expose sensitive information in logs. The current 0.221.0 stack remains; an upgrade requires an aligned SDK/API peer update. | 9/10 |
| 6 | 🟡 MEDIUM | Modern backend `package-lock.json` | 7429, 8903 | Runtime `glob`/`minimatch` dependency paths remain affected by cancellation-bypass and glob-parts denial-of-service advisories after compatible audit updates. | 8/10 |
| 7 | 🟠 HIGH | Lite, Modern frontend and Modern backend lockfiles | 6940; 5668; 9354 | Dev-only `picomatch` ≤4.0.7 is vulnerable to ReDoS through repeated extglobs. Production-only audits are clean for Lite and the Modern frontend; full audits still report this toolchain advisory. | 9/10 |

The first two are the original pre-remediation findings. The current source fixes both: membership list/status operations are store-scoped, and migration 047 plus its concurrency regression test restores unique sale-reference claims. The Next.js and Zod dependency upgrades are local only. The Modern backend runtime and dev-toolchain advisories remain unresolved; no live attack/retest was performed.

| Attack class | Outcome |
|---|---|
| Unauthenticated promotion creation | No bypass found in protected route/source tests; no live HTTP attempt. |
| Cashier promotion activation | No cashier activation bypass demonstrated by route tests; no live HTTP attempt. |
| Cashier manual price override / discount injection | POS services price server-side; Lite rejects manual price fields in executed tests. No live cashier API attempt. |
| Customer membership ID substitution | Customer-scoped routes use authenticated identity; no successful cross-customer substitution demonstrated. Cross-store admin list leak remains as finding 1. |
| Fake tier submission | Tier is selected server-side from membership state; no arbitrary-tier API path demonstrated. |
| Quote signature tampering | HMAC validation tests passed; no live service request. |
| Quote expiry bypass | Expiry tests passed; no live service request. |
| Quote replay | Same quote replay to a different sale reference is rejected in tests. Two separate quote IDs can share one reference (finding 2); no second sale demonstrated. |
| Channel substitution / cart substitution | Quote validation binds channel/cart; automated tests passed. No live cross-system attempt. |
| Cross-organization access | No successful cross-organization access found in the executed suite; external access was not tested. |
| Cross-store membership list access | Original source was vulnerable (finding 1); the current store-scope regression passes. No live API retest was performed. |
| Service credential misuse / secret exposure | **NOT VERIFIED** without deployed secret store or live service credentials. No secret value is included in this report. |
| Audit events | Promotion and membership service audit/version paths are present and service tests passed; production audit delivery/retention is **NOT VERIFIED**. |

### Local remediation follow-up

After the audit, the user selected **Fix all issues** for the reported security findings. The current worktrees contain these local remediations:

- Store-scoped membership list and status-change queries now filter through the customer's current `home_store_id`; a regression test checks both read disclosure and out-of-scope status mutation.
- Migration `047_unique_member_pricing_quote_sale_reference` restores a unique partial index on non-null claimed sale references. A concurrent two-quote test verifies that only one distinct quote can claim a shared sale reference; migration 047 is also the health-check version.
- Modern member pricing now has a server-enforced `ENABLE_MEMBER_PRICING` gate that defaults OFF; release-feature tests pass.
- Lite COD order creation requests and validates a COD-channel Modern quote, persists the accepted price and immutable quote snapshot, and has fail-safe/idempotency regression cases. Client/schema tests pass; the database-backed cases remain unrun.
- Modern pricing accepts an explicit COD eligibility channel. Migration 048 and COD quote integration tests remain unrun.
- Migration 049 and a regression case cover loyalty reversal after intermediate return statuses; neither has been database-tested in this continuation.
- The Modern admin now has a capability-gated member-pricing page for draft creation, preview and status transitions. Production build passes; no authenticated browser test was run.
- Lite's release runner now declares `server-only` and executes with Node's `react-server` condition. The marker import probe passes; the mutating E2E script was not run without an isolated database.
- Dependency follow-up upgraded both frontends to Next.js/eslint-config-next 16.4.6 and Lite Zod to 4.6.7. Compatible `npm audit fix` updates also removed the initial Lite/Modern frontend production advisories and high Modern backend production advisories. Production-only audits now report zero findings for Lite and the Modern frontend; Modern backend still has seven moderate findings. Full audits retain high dev-only `picomatch` findings and require further dependency maintenance.

**Latest validation:** Lite fresh migration/seed, 135/135 database-backed tests, and custom-format backup/restore pass on PostgreSQL 18. Modern fresh migration, 048/049, and 27 targeted COD/loyalty/pricing tests pass on PostgreSQL 18. Modern frontend lint/type-check/build pass; Modern backend lint/type-check/build pass; Lite lint/type-check/build pass on Next.js 16.4.6. Browser/app tests, existing-data migration, representative Modern recovery, and staging/production deployment remain unverified. Dependency advisories noted above also remain. These are disposable/local source/test results only; the overall launch decision remains **NO-GO**.

## H. Final launch checklist

### Configuration and secrets

The Lite example lists `APP_ENV`, `DATABASE_URL`, `AUTH_SECRET`, `APP_URL`, and the three `MODERN_PRICING_*` service settings. Modern Trade's production example/config validates database/runtime/migration roles, HTTPS app/CORS origins, JWT/cookie/encryption/signature secrets, separate member-pricing service and quote secrets, OTP hashing, payment encryption, proxy auth, and production OTP-provider settings. Provision unique values in a secret manager; do not copy any values from example files into production. No live secret manager or deployed configuration was inspected. `ENABLE_MEMBER_PRICING=false` is now defined as the default-off gate, but deployment configuration is NOT VERIFIED.

### Locally addressed; deployment/test proof still required

- [x] Add the Modern server-side member-pricing gate, default OFF; staging regular-price behavior remains untested.
- [x] Route Lite COD order pricing through an authoritative COD quote and persist the accepted price/snapshot; Lite's database-backed suite passes 135/135.
- [x] Enforce store-level scope for membership reads/status changes and restore quote claim uniqueness with migration 047.
- [x] Add migration 049 for intermediate return-status loyalty reversal; it applies and the targeted COD/loyalty/pricing suite passes 27/27.
- [x] Add the capability-gated member-pricing administration UI; authenticated browser workflow remains untested.
- [x] Fix the Modern membership-page lint error and declare/configure Lite `server-only` for the release runner; E2E remains unrun.

### Remaining launch blockers

- [ ] Resolve the loyalty-earning cutover against locked product decisions; preserve existing ledger rows and remove/replace points advertising only after approval.
- [x] Apply/test Lite's COD snapshot migration and Modern migrations 048–049 on fresh disposable databases.
- [ ] Repeat the migration rehearsal against copies of representative existing data and prove Modern backup/restore/rollback.
- [ ] Run the remaining database-backed cross-system quote-replay and real payment/inventory regression suites.
- [ ] Run real authenticated cross-repository OTP, enrollment, promotion, POS, Web, app, COD, return, suspension, quote-failure and parity journeys.
- [ ] Reconcile actual SKUs/prices; verify same regular and eligible prices across channels.
- [ ] Run browser E2E against a disposable configured QA stack; install/use Flutter tooling and execute mobile tests.
- [ ] Prove backup/restore, rollback/recovery, migration order and no-edit history against a representative data copy.
- [ ] Record clean candidate commits, deployment IDs, migration IDs, monitoring/alerts, and explicit release approval.
- [ ] Resolve the seven remaining Modern backend production dependency advisories and the high dev-only `picomatch` advisories, or document and approve residual risk after compatibility testing.

### Non-blocking observations

- Modern migration manifest has no `019` entry; the runner applied the declared order successfully.
- `backend/MIGRATIONS.md` documents test port 55432, while the current test harness/CI uses 55433.
- The Lite membership-number migration ID `20261118100000_membership_number_snapshot` is dated one day after the assessment date; confirm the timestamp before release.

## I. Final decision and ordered fixes

**NO-GO.** No production deployment is verified or approved.

Before re-audit, fix in this order:

1. Resolve the product decision for disabling legacy loyalty earning; preserve the ledger and remove points messaging only after approval.
2. Resolve the remaining Modern backend runtime and dev-toolchain dependency advisories without unverified forced downgrades; rerun production and full audits.
3. Run Lite's COD snapshot migration and Modern migrations 048–049 on fresh and representative existing-data databases; execute the new COD/loyalty regressions.
4. Run real cross-repository pricing integration and SKU/regular-price parity checks across POS, Web, App and COD.
5. Execute the promotion administration browser flow and the Web/mobile checkout, quote-refresh and return journeys in a configured QA environment.
6. Prove backup/restore, rollback/recovery, production configuration, monitoring and staged migration order.
7. Obtain release approval, deploy with member pricing disabled, verify health and reconciliation, and enable pricing only after explicit approval.
