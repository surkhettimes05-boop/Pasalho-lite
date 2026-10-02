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

### First Owner/Admin bootstrap

The normal seed command is intentionally blocked in production so it cannot reset a live owner password.

After migrations have been applied to a new empty production database, create the first Owner/Admin exactly once:

```bash
APP_ENV=production \
DATABASE_URL="..." \
BOOTSTRAP_OWNER_EMAIL="..." \
BOOTSTRAP_OWNER_PASSWORD="..." \
BOOTSTRAP_OWNER_NAME="Pasalho Owner" \
npm run admin:bootstrap-owner
```

The bootstrap refuses to run if an active Owner/Admin already exists. After bootstrap, manage staff only through **Users / Audit**.

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
