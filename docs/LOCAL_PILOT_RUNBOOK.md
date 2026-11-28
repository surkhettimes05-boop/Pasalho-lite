# Local Windows pilot runbook

This runbook starts the PASALHO Lite development app against the isolated
acceptance database only. It does not start or configure production services.

## One-time local secret setup

Create `.env.pilot.local` from `.env.pilot.local.example`. Put the existing
local `AUTH_SECRET` in that ignored file. Keep database and account credentials
out of version control. The local pilot PostgreSQL listener uses loopback
trust authentication and the launcher refuses a database URL with a password.

## Start and stop

From the repository root, run:

```powershell
.\scripts\start-pasalho-pilot.ps1
```

The launcher fixes `APP_ENV=test`, the PostgreSQL URL to
`127.0.0.1:55432/pasalho_pilot_acceptance?schema=public`, and the web address to
`http://127.0.0.1:3000`. It checks for a conflicting inherited database URL,
checks that port 3000 is free, and runs a read-only PostgreSQL identity probe
before starting Next.js. It makes no database changes. Press Ctrl+C to stop it.

If the launcher reports that port 3000 is occupied, identify the process before
stopping anything. Do not point the launcher at another database to work around
that guard.

Use the existing local pilot account credentials supplied separately to
authorized testers. Do not store passwords in this repository or in this
runbook.

## Baseline to preserve

Before any operational test, verify the pilot snapshot:

- 3 POS sale rows; gross NPR 142.50
- refunds NPR 95.00; net NPR 47.50
- Daily close for 2026-11-28: CLOSED
- expected cash NPR 47.50; actual cash NPR 47.50; variance NPR 0.00
- Known records: `PILOT-DEMO-036`, `POS-20261128-4934FFD3`,
  `RET-20261128-CED7BDCB`, `RET-20261128-5ABE62BA`

Page verification should use authenticated GET requests and must not submit
business forms. Use `npm run test:isolated` for automated tests; it creates a
separate ephemeral database from migrations and drops only that test database.
Do not run the data-generating pilot helper scripts against the acceptance
database.

## PostgreSQL query warning implementation

The daily-close snapshot queries execute sequentially on their interactive
transaction client, preserving the transaction scope. The preview selects
only the close ID it needs. `prisma/schema.prisma` also enables Prisma's
Preview `relationJoins` feature so relation-bearing queries use a database join
instead of overlapping queries on a transaction-bound `pg` client.

Preview risks include Prisma API/query-plan changes on upgrade and different
database workload from application-side relation loading. The stable
replacement is to hydrate relation-rich results after commit through the pooled
Prisma client, or explicitly serialize relation reads within each transaction.
That broader replacement is not complete. Keep the Preview flag until the
stable alternative is implemented and the full traced regression suite and
authenticated pilot pages pass without the warning.
