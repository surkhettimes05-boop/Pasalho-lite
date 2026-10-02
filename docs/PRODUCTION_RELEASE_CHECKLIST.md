# Pasalho Lite V1 — Production Release Checklist

Use this checklist for the actual launch environment. Automated evidence and physical/deployment evidence must not be mixed.

## Automated software gate

Required on the exact commit being deployed:

- [ ] dependency audit has no unresolved critical vulnerability
- [ ] Prisma schema validates
- [ ] all migrations apply from an empty PostgreSQL database
- [ ] seed works in test/development
- [ ] production seed is blocked
- [ ] typecheck passes
- [ ] lint passes
- [ ] complete automated test suite passes
- [ ] POS concurrency test passes
- [ ] COD reservation/dispatch concurrency test passes
- [ ] backup is created
- [ ] backup restores into a separate database
- [ ] source/restored critical data snapshots match
- [ ] migration deploy succeeds against restored clone
- [ ] canonical end-to-end release flow passes
- [ ] production build succeeds
- [ ] /api/health succeeds
- [ ] /api/ready succeeds

## Production environment gate

Verify on the actual deployment:

- [ ] APP_ENV=production
- [ ] APP_URL is HTTPS
- [ ] AUTH_SECRET is unique, random and not committed
- [ ] managed PostgreSQL is not publicly exposed except through an explicitly required restricted path
- [ ] database TLS/provider security settings are enabled
- [ ] automated database backups are enabled
- [ ] backup retention is at least the chosen pilot policy
- [ ] application logs are retained and access-controlled
- [ ] Owner/Admin account was bootstrapped once
- [ ] non-owner staff accounts were created through Users / Audit
- [ ] health/readiness monitoring is configured

## Physical store gate

Verify with the actual launch devices:

- [ ] barcode scanner validation from HARDWARE_VALIDATION.md is VERIFIED PASS
- [ ] receipt printer validation from HARDWARE_VALIDATION.md is VERIFIED PASS
- [ ] actual store browser/PC can sign in and use POS
- [ ] real barcode search is fast enough at launch SKU count
- [ ] one realistic sample sale prints correctly
- [ ] one realistic COD order lifecycle is completed
- [ ] one realistic return is completed
- [ ] one realistic daily close is completed

## Full-day simulation

Before accepting real customer money:

- [ ] opening cash recorded
- [ ] warehouse receipt tested
- [ ] warehouse-to-store transfer tested
- [ ] cash POS tested
- [ ] QR/non-cash POS tested
- [ ] identified-customer loyalty tested
- [ ] COD confirm/reserve/pack/dispatch/deliver tested
- [ ] return/refund tested
- [ ] expense/payout tested
- [ ] daily close completed
- [ ] stock ledger reconciled
- [ ] loyalty ledger reconciled
- [ ] cash variance reviewed
- [ ] backup confirmed after the simulation

## Release decision

Only mark the deployment **LAUNCH READY** when every required automated item passes and all applicable production/physical checks are VERIFIED PASS.

If any item is FAILED, BLOCKED or NOT TESTED, record it explicitly rather than treating the release as complete.
