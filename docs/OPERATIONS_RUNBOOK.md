# Pasalho Lite V1 — Production Operations Runbook

## 1. Production shape

Use one Pasalho Lite application deployment and one managed PostgreSQL database.

Required production environment:

- `APP_ENV=production`
- `DATABASE_URL`
- `AUTH_SECRET` — unique random value, minimum 48 characters
- `APP_URL` — HTTPS URL
- `SESSION_TTL_HOURS`

Never commit production secrets.

### First production bootstrap

The normal seed command is intentionally blocked in production so it cannot reset a live owner password.

After migrations have been applied to a new empty production database, bootstrap the locked V1 operating data exactly once. This creates the **Central Warehouse**, **Pasalho Store**, and the first **Owner/Admin** in one transaction:

```bash
APP_ENV=production \
DATABASE_URL="..." \
BOOTSTRAP_OWNER_EMAIL="..." \
BOOTSTRAP_OWNER_PASSWORD="..." \
BOOTSTRAP_OWNER_NAME="Pasalho Owner" \
npm run admin:bootstrap-owner
```

The bootstrap refuses to run if an active Owner/Admin already exists. It creates/repairs only the two locked V1 locations and the initial owner; it does not seed fake products, sales or orders. After bootstrap, manage staff only through **Users / Audit**.

## 2. Release sequence

1. Create a database backup.
2. Restore that backup into a non-production restore/staging database.
3. Run `npm run db:migrate:deploy` against the restored copy.
4. Run application verification against the restored copy.
5. Deploy application code.
6. Run `npm run db:migrate:deploy` against production.
7. Check `/api/health`.
8. Check `/api/ready`.
9. Sign in with Owner/Admin.
10. Verify Products, Inventory, POS, Orders, Daily Close and Reports load.

Do not use `prisma db push` in production.

## 3. Backup

Automated managed-PostgreSQL backups must be enabled at the database provider.

Recommended baseline retention for the pilot:

- daily backups: at least 14 days
- retain a pre-release backup before every production migration
- retain an additional manual backup before risky data corrections

A logical backup can be created with:

```bash
DATABASE_URL="..." BACKUP_DIR="./backups" bash scripts/db-backup.sh
```

Use a `pg_dump` client compatible with the PostgreSQL server version.

Backups contain sensitive business/customer data. Store them encrypted and access-controlled.

## 4. Restore test

Never treat a backup as proven until it restores.

Create a separate empty database, then:

```bash
RESTORE_DATABASE_URL="..." bash scripts/db-restore.sh ./backups/pasalho-YYYYMMDD.dump
```

Verify:

- application migrations deploy successfully
- Owner/Admin, warehouse and store exist
- StockBalance totals match source
- inventory ledger records exist
- Payment totals match source
- loyalty projection exists
- DailyClose history exists
- application health/readiness passes

CI performs a source-vs-restored data comparison on every Phase/main verification.

Never restore a test into the live production database.

## 5. Incident rule

If stock, payment, loyalty or cash correctness is in doubt:

1. stop the affected workflow
2. record exact time, user and operation
3. preserve database/log evidence
4. do not directly overwrite historical rows
5. use supported correction/reversal paths
6. verify ledger/projection reconciliation before resuming

## 6. Daily operations

At minimum each day:

- review low stock
- review open transfers
- review pending/dispatched COD
- record expenses/cash payouts
- complete Daily Close
- investigate non-zero cash variance
- ensure backup system reports healthy

## 7. Monitoring

External uptime monitoring should check:

- `GET /api/health` for database liveness
- `GET /api/ready` for database + required V1 bootstrap data

Alert on repeated 5xx responses or readiness failure.

Application logs are JSON structured where Phase 10 emits security/business-operation logs. Preserve logs with access controls; never add passwords, auth tokens or secrets.

## 8. Rollback

Application rollback:

- redeploy the previous known-good application commit.

Database rollback:

- do not automatically reverse a successful production migration.
- restore only when a migration/data incident is severe and a documented decision has been made.
- prefer forward fixes when data integrity permits.

Always retain the pre-release backup until the release is proven stable.

## 9. Dependency security overrides

Pasalho Lite pins two transitive dependencies through `package.json#overrides` while remaining on the production-supported Prisma 7 line:

- `deepmerge-ts=8.0.0` — patches GHSA-ggr8-5vv4-36mx.
- `mysql2=3.23.1` — patches the MySQL2 advisories reported against versions `<=3.23.0`.

Pasalho uses PostgreSQL, not MySQL. The mysql2 dependency arrives transitively through Prisma tooling, but it is still overridden rather than ignored.

Removal rule:

1. upgrade to a supported Prisma release whose dependency tree no longer contains the affected versions;
2. remove the override;
3. rerun the full high-severity audit, migrations, tests, backup/restore and canonical E2E gate.

Do not run `npm audit fix --force` blindly: the current audit recommendation proposes a breaking Prisma major-line change.

### Development-tool audit findings

The release gate hard-fails on HIGH/CRITICAL findings in production dependencies with:

`npm audit --omit=dev --audit-level=high`

The full dependency audit is still emitted in CI for visibility. As of October 2026, the Next.js ESLint toolchain resolves through `fast-glob -> micromatch -> braces@3.0.3`, and npm reports the unpatched `braces` recursion advisory. Because this chain is development-only lint tooling and no patched `braces` release exists, it is tracked rather than treated as a production-runtime blocker.

Do not suppress or ignore future runtime findings. Revisit this exception when the upstream Next.js/ESLint dependency chain changes or a patched `braces` release is available.
