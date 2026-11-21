# Phase 4 Pricing Contract Evidence

This records the service contract used by PASALHO Lite and the current
Modern Trade implementation. It is local and disposable-database evidence;
it does not certify a deployed/staging connection.

## Wire contract

| Item | Lite client | Modern Trade current `main` |
| --- | --- | --- |
| Quote creation | `POST /api/internal/member-pricing/quotes` | Mounted at `/api/internal/member-pricing`; accepts POS/COD quote requests |
| Quote validation | `POST /api/internal/member-pricing/quotes/validate` | Validates the signed quote against its stored record, cart, channel, store, customer, and sale reference |
| Customer verification | `POST /api/internal/member-pricing/customers/verify` | Verifies the published store, customer ID, normalized phone, and organization membership |
| Catalog read | `GET /api/internal/member-pricing/catalog?storeReference=<UUID>` | Returns the authoritative store catalog and pricing eligibility |
| Authentication | `Authorization: Bearer <token>` | Checks `MEMBER_PRICING_SERVICE_TOKEN` using constant-time comparison |
| Store | UUID from `MODERN_PRICING_STORE_REFERENCE` | Must identify a published Modern Trade store with an organization |
| Customer | Modern Trade customer UUID and Lite-normalized phone, supplied together or both null | Customer must be active and verified; phone must match; membership is resolved for the store organization |
| Cart | `channel` (`POS` or `COD`), `storeReference`, nullable customer references, unique SKU/quantity strings | Resolves product and effective store price; returns NPR quote with line amounts, discounts, membership snapshot, rule version, timestamps, and signed token |
| Failure | 5,000 ms `AbortSignal.timeout`; non-2xx, malformed payload, timeout, or transport errors reject the quote | Returns status plus `{ error, code }` for contract errors; common service timeout defaults are 15,000 ms at HTTP request level and 17,000 ms for DB query timeout |

The service-token values must be identical on both systems. The environment
variable names intentionally differ: Lite uses `MODERN_PRICING_SERVICE_TOKEN`,
while current Modern Trade uses `MEMBER_PRICING_SERVICE_TOKEN`. Lite treats
Modern Trade as the sole source of regular price, member price, discount, and
quote validity. It never substitutes its local product selling price after a
service error.

## Evidence run

- Lite pricing-client contract tests use the Modern Trade request paths,
  bearer header, no-store behavior, quote envelope, NPR values, and synthetic
  test token. They cover rejected authentication, invalid-store/product
  responses, timeout, unavailable service, and malformed success data.
- Lite database-backed integration tests exercise POS and COD with a
  deterministic pricing-service mock. POS totals and payment equal the
  validated quote final total. COD persists the quote snapshot; order/payment
  total equals quote final total plus the separately stated delivery charge.
  The unavailable-pricing case creates no order or payment.
- Modern Trade route tests exercise its current authenticated endpoint and
  disposable PostgreSQL pricing data, including missing/wrong credentials,
  unknown store, customer-phone mismatch, signed quote validation, and replay
  rejection.
- Lite clean migrations, upgrade from the prior 16-migration state, and
  restore verification are run against disposable PostgreSQL. CI repeats the
  clean migration, tests, backup/restore, and canonical mock-backed E2E steps.

These checks are not a live Lite-to-staging-service test. Do not interpret the
test mock or local Fastify/PostgreSQL route tests as evidence of staging
credentials, network reachability, or deployed configuration.

## Staging evidence still needed

An integration owner must provide a non-production Modern Trade service URL,
the paired non-production service token, a published staging store UUID, and
synthetic verified membership/customer/product data shared across the two
staging databases. The product owner must confirm the Lite-to-Modern store
reference and SKU mapping. Then run POS and COD quote/validation flows and
fault injection against staging while keeping real customer orders disabled.
No production credential, database, or customer record is required for that
evidence.
