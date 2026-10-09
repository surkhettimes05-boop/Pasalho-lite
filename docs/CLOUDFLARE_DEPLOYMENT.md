# Cloudflare Workers Deployment

Pasalho Lite can run on Cloudflare Workers through the OpenNext Cloudflare adapter while keeping the existing Next.js application, Prisma ORM, and PostgreSQL database.

This deployment path does **not** change Pasalho business workflows or data semantics.

## Runtime shape

Browser / POS  
→ Cloudflare Worker  
→ OpenNext-adapted Next.js application  
→ Prisma 7 + `@prisma/adapter-pg`  
→ managed PostgreSQL

## Repository configuration

The Cloudflare deployment uses:

- `wrangler.jsonc`
- `open-next.config.ts`
- `npm run cloudflare:build`
- `npm run cloudflare:preview`
- `npm run cloudflare:deploy`
- Prisma client runtime: `cloudflare`
- Workers compatibility flag: `nodejs_compat`

The normal local Next.js commands remain available:

```bash
npm run dev
npm run build
npm run start
```

## Required Cloudflare variables and secrets

Configure these for the Worker. Do not commit real values.

### Secrets

- `DATABASE_URL`
- `AUTH_SECRET`

### Variables

- `NODE_ENV=production`
- `APP_ENV=production`
- `APP_URL=https://YOUR-WORKER-OR-CUSTOM-DOMAIN`
- `SESSION_TTL_HOURS=12`

`AUTH_SECRET` must satisfy the production rule in `src/lib/env.ts`: unique, random, and at least 48 characters.

`APP_URL` must use HTTPS in production.

## First local verification

Install dependencies:

```bash
npm install
```

Copy the local Cloudflare environment template:

```bash
cp .dev.vars.example .dev.vars
```

Replace all placeholders in `.dev.vars`, then run:

```bash
npm run prisma:generate
npm run prisma:validate
npm run typecheck
npm run lint
npm test
npm run cloudflare:build
npm run cloudflare:preview
```

Check:

- `/api/health`
- `/api/ready`
- Owner/Admin sign-in
- Products
- Inventory
- POS
- Orders
- Daily Close

## Database migrations

Cloudflare Worker deployment must not be used as a substitute for the production migration gate.

Run migrations from a trusted release machine or CI environment against the intended database:

```bash
DATABASE_URL="..." npm run db:migrate:deploy
```

Do not use `prisma db push` in production.

Follow `docs/OPERATIONS_RUNBOOK.md` for backup, restore verification, migration sequencing, and first-owner bootstrap.

## Direct Wrangler deployment

Authenticate Wrangler:

```bash
npx wrangler login
```

Set production secrets:

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put AUTH_SECRET
```

Set the non-secret Worker variables in the Cloudflare dashboard:

```text
NODE_ENV=production
APP_ENV=production
APP_URL=https://<worker-or-custom-domain>
SESSION_TTL_HOURS=12
```

Then deploy:

```bash
npm run cloudflare:deploy
```

## Cloudflare dashboard Git deployment

When connecting this GitHub repository to Cloudflare Workers Builds:

- repository: `surkhettimes05-boop/Pasalho-lite`
- production branch: `main` after this deployment change is merged
- install command: `npm install`
- build command: `npm run cloudflare:build`
- deploy command: `npx wrangler deploy`

Add all required variables/secrets to the build/deployment environment before the first production build. Next.js can evaluate server modules during build, so missing required environment values can fail the build even before the Worker starts.

Do **not** put the production database URL or authentication secret in `wrangler.jsonc`.

## PostgreSQL connectivity

Pasalho Lite already uses `@prisma/adapter-pg` and `pg`. The Worker uses Cloudflare's Node.js compatibility layer for PostgreSQL TCP/TLS connectivity.

The existing database may remain where it is as long as:

- it is reachable from Cloudflare Workers,
- TLS is supported/configured,
- the provider connection limit can handle the application workload.

If connection pressure becomes a real production issue, evaluate Cloudflare Hyperdrive or a provider-side pooled connection string later. Do not add either before measurement shows a need.

## Rollback

Application rollback is deployment-only:

1. select the previous known-good Worker version/deployment,
2. restore traffic to it,
3. do not automatically reverse successful database migrations,
4. follow the database incident rules in `docs/OPERATIONS_RUNBOOK.md`.

## Release gate

A successful Cloudflare build is not sufficient for launch.

The exact deployed commit must still satisfy `docs/PRODUCTION_RELEASE_CHECKLIST.md`, including:

- migrations,
- automated tests,
- production build,
- database backup/restore verification,
- `/api/health`,
- `/api/ready`,
- POS/COD concurrency checks,
- full operational simulation before accepting real customer money.


## Troubleshooting: branch changes and retries

After changing Cloudflare's Production branch, do not retry an older failed deployment created from another branch. A retry can replay the old commit. Trigger a fresh build from a new commit on the configured production branch instead.
