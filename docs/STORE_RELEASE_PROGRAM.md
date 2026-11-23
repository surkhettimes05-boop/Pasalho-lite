# First store release evidence — 2026-11-23

This is an engineering status record for the Surkhet store, not deployment
approval. The Modern Trade checkout inspected locally was
`codex/website-launch-completion`; its untracked migration and ownership files
were preserved. Pasalho Lite PR #31 remains a draft. The financial settlement
branch is stacked on that PR.

## Requirements matrix

| Requirement | Status | Concrete evidence and remaining proof |
| --- | --- | --- |
| Ordinary online POS sale, stock and cash | VERIFIED IMPLEMENTED | `src/modules/pos/pos.service.ts`, `tests/phase4-pos.integration.test.ts`; isolated Lite suite passed. Store hardware still untested. |
| Offline cash sale, replay and local restart | PARTIALLY IMPLEMENTED | `public/offline-pos.js`, `src/modules/offline-pos/offline-pos.service.ts`, `e2e/offline-pos.spec.ts`, `tests/offline-pos.integration.test.ts`; browser-only IndexedDB cannot survive device loss. |
| Conflict and cash settlement | IMPLEMENTED BUT UNVERIFIED | `src/modules/offline-pos/offline-pos.service.ts`, `src/app/api/offline/reviews/route.ts`, `tests/offline-pos.integration.test.ts`; synthetic database tests pass; real cash/stock operator drill remains. |
| Installed Windows local ledger and backup/restore | MISSING | No Electron/SQLite runtime, installer, fsynced log or second-medium recovery exists. Browser persistence is insufficient for device-loss recovery. |
| Scanner and receipt printer | BLOCKED | Store hardware and Windows drivers must be supplied and exercised. Browser print dialog is the only current receipt path. |
| Modern Trade verified registration and enrollment | IMPLEMENTED BUT UNVERIFIED | `backend/src/routes/membership.ts`, `backend/src/services/membershipService.ts`, `backend/src/services/__tests__/membershipService.test.ts`; no combined website/Flutter/POS journey was run. |
| Unique member number, tier and status | IMPLEMENTED BUT UNVERIFIED | Modern Trade membership service and `database/042_membership_foundation.sql`, `database/043_membership_integrity.sql`; migration and live service proof pending. |
| Signed member quotes and Lite identity mapping | PARTIALLY IMPLEMENTED | Modern Trade `backend/src/services/memberPricingQuoteService.ts`; Lite `src/modules/pricing/pricing.service.ts`, `tests/phase4-pos.integration.test.ts`; local mock tests pass, real cross-repository quote journey pending. |
| Lite cumulative loyalty and returns | VERIFIED IMPLEMENTED | `src/modules/loyalty/loyalty.service.ts`, `src/modules/returns/return.service.ts`, `tests/phase5-loyalty.integration.test.ts`, `tests/phase7-pos-returns.integration.test.ts`; isolated Lite suite passed. |
| Website membership and member pricing | IMPLEMENTED BUT UNVERIFIED | Modern Trade `frontend/src/app/membership/page.tsx`, `frontend/src/components/CommerceClient.tsx`, `frontend/src/app/checkout/page.tsx`; live signed pricing journey pending. |
| Flutter membership and member pricing | PARTIALLY IMPLEMENTED | Modern Trade `modern_trade_flutter/lib/screens/membership_screen.dart`, `modern_trade_flutter/lib/repositories/member_pricing_repository.dart`, `modern_trade_flutter/lib/screens/product_screen.dart`; no membership and price consistency acceptance test found. |
| Creator admin, referral, QR and acquisition | IMPLEMENTED BUT UNVERIFIED | Modern Trade `backend/src/routes/creatorManagement.ts`, `backend/src/routes/creatorAttribution.ts`, `frontend/src/components/admin/CreatorManualPayouts.tsx`; referral and verified registration journey pending. |
| Creator online and POS 1% reward ledger | PARTIALLY IMPLEMENTED | Modern Trade `backend/src/routes/creatorAttribution.ts`, `database/042_creator_attribution_rewards.sql`; Lite `src/modules/creator-attribution/outbox.service.ts` and POS/return services. Cross-repository signed replay, hold, reversal and rounding test pending. |
| Creator payout control | BLOCKED | Modern Trade already exposes manual payout route and UI. Business instruction prohibits activation without a separately approved payout procedure; authorization and production flag state need release review. |
| Production dependency safety | VERIFIED IMPLEMENTED | This branch overrides Prisma's vulnerable `effect` transitive version with `3.22.1`; `npm audit --omit=dev --audit-level=high` reports zero vulnerabilities and the full Lite suite/build pass. Reassess on the final merged lockfile. |
| Required CI | BLOCKED | Lite PR #31 `verify` called a missing `cloudflare:build`. This branch removes that stale step, matching the host-neutral correction proposed in PR #28; a fresh run is pending. External Workers build still fails. Vercel preview passes. |
| Store data backup and restore | PARTIALLY IMPLEMENTED | Lite scripts and CI restore step exist; local fresh migration test passed. Store device/local ledger restoration is absent. |

## Architecture and rule conflicts

1. Lite's `AGENTS.md` specifies one PostgreSQL database and no second database.
   A Windows SQLite offline ledger would be a local device storage component,
   but needs an explicit product architecture amendment before adoption.
2. `docs/LOYALTY_MVP.md` in Modern Trade describes a separate 1 point per
   NPR 100 and redemption pilot. Lite's locked V1 rule is cumulative 1 point
   per NPR 500 with no redemption. Do not equate these ledgers or activate
   cross-system redemption without a new approved rule.
3. `docs/platform-contracts.md` still describes an India-first contract while
   the Nepal pilot and creator contract require NPR. Deployment configuration
   and accepted market values need a release review.
4. Creator referral and payout work spans many unmerged Modern Trade PRs,
   including draft PR #82. Existing code in a local branch is not evidence
   that production has the same migrations and flags.
5. PR #31's offline mode is deliberately anonymous. It cannot earn membership
   prices, loyalty or creator rewards without a separately approved policy.

## Merge order and external gates

Coordinate the overlapping host-neutral Lite CI fix in PR #28 before merging.
Review this financial settlement branch on top of PR #31; keep both draft until the
Windows recovery and hardware requirements are met. Audit and consolidate
Modern Trade's creator/membership PR chain against a verified base before
cross-repository acceptance. No production database, live order or payout
setting should change as part of this review.

Overall release classification: **NOT READY**. The installed Windows ledger,
hardware validation, cross-repository journeys, and required CI remain
outstanding.
